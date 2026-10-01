import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { FontPatch, TextAlign } from '@canvas/index.ts';
import { eventDefinitionTypeOf } from '@core/element';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { APPEND_MENU, COLOR_MENU, CREATE_MENU, REPLACE_MENU, registerPopupMenu, type PopupOptions, type PopupPosition } from '@modeler/editor/popupMenus';
import { ICONS } from '@modeler/icons';
import { ELEMENT_COLORS, DEFAULT_FILL, DEFAULT_STROKE } from '@modeler/shape/colors';
import { buildElementEntries } from '@modeler/popup/entries';
import { mustDragToAppend } from '@modeler/popup/commands';
import { PopupMenu, type PopupMenuModel, type PopupMenuItem } from '@modeler/popup/PopupMenu';
import { t } from '@modeler/i18n';


const ALIGNMENTS: { align: TextAlign; glyph: string; label: string }[] = [
  { align: 'left', glyph: ICONS.alignLeft, label: 'Align left' },
  { align: 'center', glyph: ICONS.alignCenter, label: 'Align center' },
  { align: 'right', glyph: ICONS.alignRight, label: 'Align right' },
];

/** A caption's ink: the element palette's own strokes, plus the stock ink to clear back to. */
const INKS: { label: string; color: string | undefined }[] = [
  { label: 'Default', color: undefined },
  ...ELEMENT_COLORS.flatMap((color) => (color.stroke ? [{ label: color.label, color: color.stroke }] : [])),
];

type OpenMenu = {
  providerId: string;
  position: PopupPosition;
  options?: PopupOptions;
  /** Snapshotted when the menu opened: the ids append, replace and colour act on. */
  ids: readonly string[];
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
  const modeler = useModeler();
  const [open, setOpen] = useState<OpenMenu | null>(null);
  /** Bumped on every edit: the style menu stays open, so its toggles must re-read the font. */
  const [revision, setRevision] = useState(0);
  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    const bump = (): void => setRevision((n) => n + 1);
    modeler.events.on('ElementsChanged', bump);
    return () => modeler.events.off('ElementsChanged', bump);
  }, [modeler]);

  useEffect(() => {

    const opener = (providerId: string) => (position: PopupPosition, options?: PopupOptions) => {
      // Snapshot the selection: the menu is chrome outside the diagram, and what it
      // acts on must not drift while it is open.
      setOpen({ providerId, position, options, ids: [...modeler.canvas.selection] });
    };

    const detach = [CREATE_MENU, APPEND_MENU, REPLACE_MENU, COLOR_MENU]
      .map((id) => registerPopupMenu(id, opener(id)));

    return () => detach.forEach((off) => off());
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
    const { providerId, position, options, ids } = open;
    const { study } = modeler;

    if (providerId === COLOR_MENU) {
      // A caption is styled through the element it names, which is what `SetFont`
      // and `SetColor` both resolve a label to; read the state back the same way.
      const first = ids[0] === undefined ? undefined : study.get(ids[0]);
      const styled = first?.kind === 'label' && first.owner !== undefined ? study.get(first.owner) : first;
      const font = styled?.font;
      const setFont = (patch: FontPatch): void => {
        executeCommand(modeler, { type: 'SetFont', ids: [...ids], font: patch });
      };
      const empty = ids.length === 0;
      // A connection carries only a stroke, so that is the half of a swatch it is set to.
      const painted = styled?.kind === 'edge' ? styled?.stroke : styled?.fill;
      const paintOf = (color: { fill?: string; stroke?: string }): string | undefined =>
        (styled?.kind === 'edge' ? color.stroke : color.fill)?.toLowerCase();
      return {
        title: options?.title ?? t('Style'),
        width: options?.width ?? 220,
        variant: 'swatches',
        emptyText: 'Select an element first',
        sections: empty ? [] : [
          {
            id: 'element-colors',
            name: t('Element'),
            items: ELEMENT_COLORS.map((color): PopupMenuItem => ({
              id: `${color.label.toLowerCase()}-color`,
              label: color.label,
              swatch: { fill: color.fill ?? DEFAULT_FILL, stroke: color.stroke ?? DEFAULT_STROKE },
              pressed: (painted ?? undefined) === paintOf(color),
              keepOpen: true,
              onSelect: () => {
                // The swatches are the app's only route to `SetColor`; the handler
                // reaches the diagram through the `Editor` facade like every other.
                executeCommand(modeler, { type: 'SetColor', ids: [...ids], color });
              },
            })),
          },
          {
            id: 'text-style',
            name: t('Text'),
            items: [
              ...ALIGNMENTS.map(({ align, glyph, label }): PopupMenuItem => ({
                id: `align-${align}`,
                label: t(label),
                glyph,
                pressed: font?.align === align,
                keepOpen: true,
                // Picking the alignment it already has puts it back to the element's own default.
                onSelect: () => setFont({ align: font?.align === align ? null : align }),
              })),
              {
                id: 'bold',
                label: t('Bold'),
                glyph: ICONS.textBold,
                pressed: !!font?.bold,
                keepOpen: true,
                onSelect: () => setFont({ bold: !font?.bold }),
              },
              {
                id: 'italic',
                label: t('Italic'),
                glyph: ICONS.textItalic,
                pressed: !!font?.italic,
                keepOpen: true,
                onSelect: () => setFont({ italic: !font?.italic }),
              },
            ],
          },
          {
            id: 'text-colors',
            name: t('Text color'),
            items: INKS.map(({ label, color }): PopupMenuItem => ({
              id: `${label.toLowerCase()}-text-color`,
              label,
              swatch: { fill: color ?? 'var(--sf-ink-text)', stroke: color ?? 'var(--sf-ink-text)' },
              pressed: (font?.color ?? undefined) === color?.toLowerCase(),
              keepOpen: true,
              onSelect: () => setFont({ color: color ?? null }),
            })),
          },
        ],
      };
    }

    const isAppend = providerId === APPEND_MENU;
    const isReplace = providerId === REPLACE_MENU;
    const source = ids[0] === undefined ? undefined : study.get(ids[0]);
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
      const currentBpmn = source?.type;
      const currentExtension = source?.extension;
      const currentDefinition = eventDefinitionTypeOf(source && study.businessObject(source.id));
      const sections = buildElementEntries()
        .map((group) => ({
          id: group.id,
          name: group.name,
          items: group.entries
            .filter((entry) => (
              !(entry.bpmnType === currentBpmn && entry.extensionType === currentExtension
                && eventDefinitionTypeOf(entry.attributes as never) === currentDefinition)
              && !!source && study.can('replace', { id: source.id, type: entry.bpmnType }).ok
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
                  id: source!.id,
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
                  from: source!.id,
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
    // `revision` is read for its dependency alone: it re-runs the build so the style
    // menu's toggles show the font the last click wrote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modeler, revision]);

  if (!open || !menu) return null;
  return <PopupMenu anchor={open.position} menu={menu} onClose={close} />;
}
