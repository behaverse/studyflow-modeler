/**
 * App chrome for the three editor popup menus (P6b §3A, §3B).
 *
 * `EditorPort.popup.open(providerId, position, options)` names a menu; the canvas
 * backend forwards it straight into `editor/popupMenus.ts`, which is what this
 * host registers against. The editor supplies the anchor geometry and nothing
 * else, so "open the append menu" is one call that knows no React and no editor.
 *
 * Three ids:
 *
 * | id             | renders                                              | opened by |
 * |----------------|------------------------------------------------------|-----------|
 * | `bpmn-create`  | every creatable element; drag or click to place       | the palette's "More BPMN elements..." button |
 * | `bpmn-append`  | the same list, wired to append from the selection     | the selection toolbar's append button, and the canvas's `a` key |
 * | `color-picker` | the six studyflow colours                             | the selection toolbar's colour button |
 */

import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { getEditorPort } from '@modeler/editor/registry';
import { registerPopupMenu, type PopupOptions, type PopupPosition } from '@modeler/editor/popupMenus';
import { ELEMENT_COLORS, DEFAULT_FILL, DEFAULT_STROKE } from '@modeler/shape/colors';
import { buildElementEntries } from '@modeler/popup/entries';
import { mustDragToAppend } from '@modeler/popup/commands';
import { PopupMenu, type PopupMenuModel, type PopupMenuItem } from '@modeler/popup/PopupMenu';
import { t } from '@modeler/i18n';
import type { EditorElement } from '@modeler/editor/port';

export const CREATE_MENU = 'bpmn-create';
export const APPEND_MENU = 'bpmn-append';
export const COLOR_MENU = 'color-picker';

/** The canvas's `a` shortcut names the selection and leaves the menu to the app. */
const KEYBOARD_APPEND_EVENT = 'keyboard.append';

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
    const editor = getEditorPort(modeler);

    const opener = (providerId: string) => (position: PopupPosition, options?: PopupOptions) => {
      // Snapshot the selection: the menu is chrome outside the diagram, and what it
      // acts on must not drift while it is open.
      setOpen({ providerId, position, options, elements: editor.selection.get() });
    };

    const detach = [CREATE_MENU, APPEND_MENU, COLOR_MENU].map((id) => registerPopupMenu(id, opener(id)));

    // The canvas fires this for `a`; bpmn-js binds its own append shortcut, so this
    // topic simply never arrives there.
    const onKeyboardAppend = (event: { elements?: EditorElement[] }): void => {
      const element = event?.elements?.[0];
      if (!element) return;
      const box = editor.view.getAbsoluteBBox(element);
      setOpen({
        providerId: APPEND_MENU,
        position: {
          x: box.x + box.width + 12,
          y: box.y,
          cursor: { x: box.x + box.width + 12, y: box.y + box.height / 2 },
        },
        options: { title: t('Append element') },
        elements: [element],
      });
    };
    editor.events.on(KEYBOARD_APPEND_EVENT, onKeyboardAppend);

    return () => {
      detach.forEach((off) => off());
      editor.events.off(KEYBOARD_APPEND_EVENT, onKeyboardAppend);
    };
  }, [modeler]);

  // Any document replacement invalidates the snapshotted selection.
  useEffect(() => {
    const editor = getEditorPort(modeler);
    editor.events.on('root.set', close);
    editor.events.on('import.done', close);
    return () => {
      editor.events.off('root.set', close);
      editor.events.off('import.done', close);
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
              // handler reaches the editor through `getEditorPort` like every other.
              executeCommand(modeler, { type: 'SetColor', elements, color });
            },
          })),
        }],
      };
    }

    const isAppend = providerId === APPEND_MENU;
    const source = elements[0];
    if (isAppend && !source) {
      return { title: options?.title ?? t('Append element'), width: options?.width ?? 260, sections: [], emptyText: 'Select an element first' };
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
                event: native,
              });
            } else {
              executeCommand(modeler, {
                type: 'PaletteStartCreate',
                bpmnType: entry.bpmnType,
                event: native,
                attributes: {},
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
