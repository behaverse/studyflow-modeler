import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { getExtensionType } from '@core/element';
import { eventDefinitionTypeOf } from '@canvas/model/moddle.ts';
import { isBpmnSubtypeOf } from '@core/notation/bpmn';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { registerPopupMenu, type PopupOptions, type PopupPosition } from '@modeler/editor/popupMenus';
import { ELEMENT_COLORS, DEFAULT_FILL, DEFAULT_STROKE } from '@modeler/shape/colors';
import { buildElementEntries } from '@modeler/popup/entries';
import { mustDragToAppend, type AppendMenuAnchor } from '@modeler/popup/commands';
import { PopupMenu, type PopupMenuModel, type PopupMenuItem } from '@modeler/popup/PopupMenu';
import { t } from '@modeler/i18n';
import type { EditorElement } from '@modeler/editor/port';

export const CREATE_MENU = 'bpmn-create';
export const APPEND_MENU = 'bpmn-append';
export const REPLACE_MENU = 'bpmn-replace';
export const COLOR_MENU = 'color-picker';

type OpenMenu = {
  providerId: string;
  position: PopupPosition;
  options?: PopupOptions;
  /** Snapshotted when the menu opened: what append/colour act on. */
  elements: EditorElement[];
};

/**
 * A mouse event the editor's create gesture can read coordinates off. Keyboard
 * selection inside the menu produces no pointer position, so the anchor's own
 * cursor stands in — the drag then starts where the menu was opened from.
 */
function pointerEventFor(event: ReactMouseEvent, anchor: PopupPosition): MouseEvent {
  const native = (event as unknown as { nativeEvent?: MouseEvent })?.nativeEvent ?? (event as unknown as MouseEvent);
  if (typeof native?.clientX === 'number' && (native.clientX !== 0 || native.clientY !== 0)) return native;
  return new MouseEvent('mousemove', {
    clientX: anchor.cursor.x,
    clientY: anchor.cursor.y,
    bubbles: true,
  });
}

export function PopupMenus() {
  const modeler = useRequiredModeler();
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {

    const opener = (providerId: string) => (position: PopupPosition, options?: PopupOptions) => {
      // Snapshot the selection: the menu is chrome outside the diagram, and what it
      // acts on must not drift while it is open.
      setOpen({ providerId, position, options, elements: modeler.selection.get() });
    };

    const detach = [CREATE_MENU, APPEND_MENU, REPLACE_MENU, COLOR_MENU]
      .map((id) => registerPopupMenu(id, opener(id)));

    // The canvas's `a` key requests `OpenAppendMenu`; the menu opens where it resolved.
    const onCommandDone = (done: { command: { type: string }; result?: AppendMenuAnchor }): void => {
      if (done.command.type !== 'OpenAppendMenu' || !done.result) return;
      const { element, position } = done.result;
      setOpen({ providerId: APPEND_MENU, position, options: { title: t('Append element') }, elements: [element] });
    };
    modeler.events.on('CommandDone', onCommandDone);

    return () => {
      detach.forEach((off) => off());
      modeler.events.off('CommandDone', onCommandDone);
    };
  }, [modeler]);

  // Any document replacement invalidates the snapshotted selection.
  useEffect(() => {
    modeler.events.on('RootSet', close);
    modeler.events.on('ImportDone', close);
    return () => {
      modeler.events.off('RootSet', close);
      modeler.events.off('ImportDone', close);
    };
  }, [modeler, close]);

  const menu = useMemo<PopupMenuModel | null>(() => {
    if (!open) return null;
    const { providerId, position, options, elements } = open;

    if (providerId === COLOR_MENU) {
      return {
        title: options?.title ?? t('Set color'),
        width: options?.width ?? 220,
        variant: 'swatches',
        emptyText: 'Select an element first',
        sections: [{
          id: 'colors',
          items: elements.length === 0 ? [] : ELEMENT_COLORS.map((color): PopupMenuItem => ({
            id: `${color.label.toLowerCase()}-color`,
            label: color.label,
            swatch: { fill: color.fill ?? DEFAULT_FILL, stroke: color.stroke ?? DEFAULT_STROKE },
            onSelect: () => {
              // The colour swatches are the app's only route to `SetColor`; the
              // handler reaches the diagram through the `Editor` facade like every other.
              executeCommand(modeler, { type: 'SetColor', elements, color });
            },
          })),
        }],
      };
    }

    const isAppend = providerId === APPEND_MENU;
    const isReplace = providerId === REPLACE_MENU;
    const source = elements[0];
    if ((isAppend || isReplace) && !source) {
      return {
        title: options?.title ?? t(isReplace ? 'Change element' : 'Append element'),
        width: options?.width ?? 260,
        sections: [],
        emptyText: 'Select an element first',
      };
    }

    if (isReplace) {
      // The same catalog the create/append menus offer, trimmed to what the editor
      // would actually accept in this element's place — and with the element's own
      // type dropped, because "change it to what it already is" is not a choice.
      // Offered within the element's own family only (a task becomes another task,
      // a gateway another gateway): a cross-family retype rewires semantics the
      // in-place swap cannot carry, so the menu keeps it to siblings.
      const currentBpmn = (source as { type?: string })?.type;
      const currentExtension = getExtensionType(source);
      const currentDefinition = eventDefinitionTypeOf((source as { businessObject?: any }).businessObject);
      const families = ['bpmn:Activity', 'bpmn:ChoreographyActivity', 'bpmn:Event', 'bpmn:Gateway', 'bpmn:Artifact'];
      const familyOf = (type?: string): string | undefined => (
        type ? families.find((family) => isBpmnSubtypeOf(type, family)) : undefined
      );
      const currentFamily = familyOf(currentBpmn);
      const sections = buildElementEntries()
        .map((group) => ({
          id: group.id,
          name: group.name,
          items: group.entries
            .filter((entry) => (
              !(entry.bpmnType === currentBpmn && entry.extensionType === currentExtension
                && eventDefinitionTypeOf(entry.attributes as never) === currentDefinition)
              && familyOf(entry.bpmnType) === currentFamily
              && modeler.canvas.getRules().canReplace(source, entry.bpmnType)
            ))
            .map((entry): PopupMenuItem => ({
              id: entry.id,
              label: entry.label,
              icon: entry.icon,
              keywords: entry.keywords,
              title: `Change to ${entry.label}`,
              onSelect: () => {
                executeCommand(modeler, {
                  type: 'ReplaceElement',
                  element: source,
                  bpmnType: entry.bpmnType,
                  extensionType: entry.extensionType,
                  attributes: entry.attributes,
                });
              },
            })),
        }))
        .filter((group) => group.items.length > 0);
      return {
        title: options?.title ?? t('Change element'),
        width: options?.width ?? 260,
        search: options?.search,
        sections,
        emptyText: 'Nothing can replace this element',
      };
    }

    return {
      title: options?.title ?? (isAppend ? t('Append element') : t('Create BPMN element')),
      width: options?.width ?? 260,
      search: options?.search,
      sections: buildElementEntries().map((group) => ({
        id: group.id,
        name: group.name,
        items: group.entries.map((entry): PopupMenuItem => {
          const startDrag = (event: ReactMouseEvent) => {
            const native = pointerEventFor(event, position);
            if (isAppend) {
              executeCommand(modeler, {
                type: 'StartAppendElement',
                source,
                bpmnType: entry.bpmnType,
                extensionType: entry.extensionType,
                attributes: entry.attributes,
                event: native,
              });
            } else {
              executeCommand(modeler, {
                type: 'PaletteStartCreate',
                bpmnType: entry.bpmnType,
                event: native,
                attributes: entry.attributes ?? {},
                extensionType: entry.extensionType,
              });
            }
          };

          return {
            id: entry.id,
            label: entry.label,
            icon: entry.icon,
            keywords: entry.keywords,
            title: isAppend ? `Append ${entry.label}` : `Create ${entry.label}`,
            onDragStart: startDrag,
            onSelect: (event) => {
              // Click-append places the shape outright; a boundary event needs a
              // host, so it falls back to the drag the bpmn plugin also uses.
              if (isAppend && !mustDragToAppend(entry.bpmnType)) {
                executeCommand(modeler, {
                  type: 'AppendElement',
                  source,
                  bpmnType: entry.bpmnType,
                  extensionType: entry.extensionType,
                  attributes: entry.attributes,
                });
                return;
              }
              startDrag(event);
            },
          };
        }),
      })),
    };
  }, [open, modeler]);

  if (!open || !menu) return null;
  return <PopupMenu anchor={open.position} menu={menu} onClose={close} />;
}
