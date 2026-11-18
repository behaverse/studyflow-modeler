import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { FontPatch, TextAlign } from '@canvas/index.ts';
import { eventDefinitionTypeOf } from '@core/element';
import { humanizeLabel } from '@core/notation';
import { ModeContext } from '@modeler/app/contexts';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { ADD_HERE_MENU, APPEND_MENU, COLOR_MENU, INSERT_MENU, REPLACE_MENU, registerPopupMenu, type PopupOptions, type PopupPosition } from '@modeler/editor/popupMenus';
import { ICONS } from '@modeler/icons';
import { addEntries, byKind } from '@modeler/palette/catalog';
import { usePinned } from '@modeler/palette/pins';
import { BLACK_TEXT, ELEMENT_COLORS, DEFAULT_FILL, DEFAULT_STROKE } from '@modeler/shape/colors';
import { addMenu } from '@modeler/popup/addMenu';
import { PopupMenu, type PopupMenuModel, type PopupMenuItem } from '@modeler/popup/PopupMenu';
import { t } from '@modeler/i18n';


const ALIGNMENTS: { align: TextAlign; glyph: string; label: string }[] = [
  { align: 'left', glyph: ICONS.alignLeft, label: 'Align left' },
  { align: 'center', glyph: ICONS.alignCenter, label: 'Align center' },
  { align: 'right', glyph: ICONS.alignRight, label: 'Align right' },
];

/** A caption's ink: black and the element palette's own strokes. With none picked, text takes the element's stroke. */
const INKS: { label: string; color: string }[] = [
  { label: 'Black', color: BLACK_TEXT },
  ...ELEMENT_COLORS.flatMap((color) => (color.stroke ? [{ label: color.label, color: color.stroke }] : [])),
];

/** The Add panel's openers in place. It adds only where the tools show: not while a simulation, a replay or a review holds the study. */
const ADDS: readonly string[] = [ADD_HERE_MENU, APPEND_MENU, INSERT_MENU];

type OpenMenu = {
  providerId: string;
  position: PopupPosition;
  options?: PopupOptions;
  /** Snapshotted when the menu opened: the ids append, replace and colour act on. */
  ids: readonly string[];
};

export function PopupMenus() {
  const modeler = useModeler();
  const [open, setOpen] = useState<OpenMenu | null>(null);
  /** Followed so the Add panel's pins show a click at once. */
  const pinned = usePinned();
  const { mode } = useContext(ModeContext);
  const editing = useRef(mode === 'edit');
  useEffect(() => {
    editing.current = mode === 'edit';
    if (!editing.current) setOpen((current) => (current && ADDS.includes(current.providerId) ? null : current));
  }, [mode]);
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
      if (ADDS.includes(providerId) && !editing.current) return;
      // Snapshot the selection: the menu is chrome outside the diagram, and what it
      // acts on must not drift while it is open.
      setOpen({ providerId, position, options, ids: [...modeler.canvas.selection] });
    };

    const detach = [ADD_HERE_MENU, APPEND_MENU, INSERT_MENU, REPLACE_MENU, COLOR_MENU]
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
              swatch: { fill: color, stroke: color },
              pressed: font?.color === color.toLowerCase(),
              keepOpen: true,
              // Picking the ink it already has puts it back to the element's stroke.
              onSelect: () => setFont({ color: font?.color === color.toLowerCase() ? null : color }),
            })),
          },
        ],
      };
    }

    if (providerId === ADD_HERE_MENU) return addMenu(modeler, { kind: 'point', at: position.cursor }, pinned, position);
    if (providerId === INSERT_MENU) {
      const flow = options?.subject === undefined ? undefined : study.get(options.subject);
      if (flow?.kind !== 'edge' || flow.source === undefined || flow.target === undefined) return null;
      const nameOf = (id: string): string => {
        const record = study.get(id);
        return record?.name?.trim() || humanizeLabel((record?.extension ?? record?.type ?? id).split(':').pop()!);
      };
      return addMenu(modeler, { kind: 'flow', id: flow.id, from: flow.source, between: [nameOf(flow.source), nameOf(flow.target)] }, pinned, position);
    }

    const isReplace = providerId === REPLACE_MENU;
    const source = ids[0] === undefined ? undefined : study.get(ids[0]);
    if (!source) {
      return {
        title: options?.title ?? t(isReplace ? 'Change element' : 'Append element'),
        width: options?.width ?? 260,
        sections: [],
        emptyText: 'Select an element first',
      };
    }

    if (!isReplace) {
      const name = source.name?.trim() || humanizeLabel((source.extension ?? source.type).split(':').pop()!);
      return addMenu(modeler, { kind: 'element', id: source.id, name }, pinned, position);
    }

    // The Add panel's elements, filed the same way, trimmed to what the editor accepts in this element's place, and
    // without the element's own type, which would change nothing.
    const currentDefinition = eventDefinitionTypeOf(study.element(source.id));
    const offered = addEntries().filter((entry) => (
      !entry.template
      && !(entry.bpmnType === source.type && entry.extensionType === source.extension
        && eventDefinitionTypeOf(entry.attributes as never) === currentDefinition)
      && study.can('replace', { id: source.id, type: entry.bpmnType }).ok
    ));
    return {
      title: options?.title ?? t('Change element'),
      width: options?.width ?? 260,
      search: options?.search,
      sections: byKind(offered).map(({ kind, entries }) => ({
        id: kind,
        name: kind,
        items: entries.map((entry): PopupMenuItem => ({
          id: entry.id,
          label: entry.label,
          icon: entry.icon,
          keywords: entry.keywords,
          ...(entry.skill ? { tag: entry.skill.name } : {}),
          title: `Change to ${entry.label}`,
          onSelect: () => {
            executeCommand(modeler, {
              type: 'ReplaceElement',
              id: source.id,
              bpmnType: entry.bpmnType,
              extensionType: entry.extensionType,
              attributes: entry.attributes,
            });
          },
        })),
      })),
      emptyText: 'Nothing can replace this element',
    };
    // `revision` is read for its dependency alone: it re-runs the build so the style
    // menu's toggles show the font the last click wrote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modeler, revision, pinned]);

  if (!open || !menu) return null;
  return <PopupMenu anchor={open.position} menu={menu} onClose={close} />;
}
