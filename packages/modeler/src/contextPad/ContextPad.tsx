/**
 * The per-shape context pad.
 *
 * The floating box beside the selection: append-anything, the colour picker, the
 * wrench, the trash, connect, and studyflow's own `choreography.swap-initiator`.
 *
 * `contextPad/entries.ts` decides what is offered (pure, unit-tested); this file positions
 * the box and wires each `action` to a command on the bus, or to `openPopupMenu` for the
 * three menus its entries open. Its gates are the study's rules, asked by id (`study.can`).
 *
 * **Hover preview**: an entry that appends one known element previews it, a ghost of the
 * shape at its auto-place position with the connection that would reach it
 * (`canvas.previewAppend`). Nothing is committed, and the ghost and the click place the
 * shape the same way, so what the hover shows is where the click lands.
 *
 * Positioning runs on an animation frame rather than an event, for the reason the
 * toolbar did: the canvas publishes no viewbox topic, and a pan, a zoom and a drag
 * of the selected shape all have to move the pad. One bbox read per frame, only
 * while something is selected.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { APPEND_MENU, COLOR_MENU, REPLACE_MENU, openPopupMenu } from '@modeler/editor/popupMenus';
import { contextPadEntries, type ContextPadAppend, type ContextPadEntry, type ContextPadIcon } from '@modeler/contextPad/entries';
import { ICONS } from '@modeler/icons';
import { newShape } from '@modeler/palette/newShape';
import { contextPad as s } from '@modeler/contextPad/styles';
import { useIsSimulating } from '@modeler/simulation/useIsSimulating';
import { isBpmnSubtypeOf } from '@core/notation/bpmn';
import { t } from '@modeler/i18n';
import { isExpandable, type Bounds, type ElementRecord } from '@canvas/index.ts';
import type { Editor } from '@modeler/editor/port';

/** Gap between the selection outline's right edge and the pad. */
const OFFSET = 8;

/**
 * How far the selection outline sits outside the element it wraps: the canvas's
 * `OUTLINE_OFFSET`, in diagram units, so it scales with the zoom. The pad anchors on
 * the outline, not on the shape.
 */
const OUTLINE_OFFSET = 5;

/** Where a tooltip sits relative to the pointer: the offsets a native `title` bubble uses. */
const TOOLTIP_GAP = 4;
const TOOLTIP_DROP = 18;

/**
 * How long the pointer must rest on an entry before its tooltip appears: a native `title`
 * bubble's beat, which also keeps the caption off the hover ghost that goes up in the same
 * instant (see `armTooltip`).
 */
const TOOLTIP_DELAY = 700;

/**
 * The entry table (`entries.ts`) names its icons symbolically, so it stays a pure table the
 * unit spec pins; this maps each key to an Iconify class at render time, the way the titles
 * go through `t()`.
 */
const ICON_CLASSES: Record<ContextPadIcon, string> = {
  'end-event': ICONS.bpmnEndEvent,
  annotation: ICONS.note,
  connect: ICONS.arrowUpRight,
  append: ICONS.threeDots,
  wrench: ICONS.arrowRepeat,
  trash: ICONS.trash,
  palette: ICONS.paintBrush,
  'default-flow': ICONS.slash,
  swap: ICONS.swapVertical,
  subprocess: ICONS.expand,
  open: ICONS.drilldown,
};

/** Heading each pad entry that opens a popup gives the menu it opens. */
const MENU_TITLES: Record<string, string> = {
  [APPEND_MENU]: 'Append element',
  [REPLACE_MENU]: 'Change element',
  [COLOR_MENU]: 'Style',
};

/** The union bbox of the elements `ids` names, in screen coordinates, skipping what the view does not draw. */
function selectionBBox(editor: Editor, ids: readonly string[]): Bounds | undefined {
  let box: Bounds | undefined;
  for (const id of ids) {
    const next = editor.canvas.screenBox(id);
    if (!next) continue;
    if (!box) {
      box = { ...next };
      continue;
    }
    const right = Math.max(box.x + box.width, next.x + next.width);
    const bottom = Math.max(box.y + box.height, next.y + next.height);
    box.x = Math.min(box.x, next.x);
    box.y = Math.min(box.y, next.y);
    box.width = right - box.x;
    box.height = bottom - box.y;
  }
  return box;
}

export function ContextPad() {
  const modeler = useModeler();
  const isSimulating = useIsSimulating(modeler);
  const [ids, setIds] = useState<readonly string[]>([]);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // A fresh array every sync: a mutation that keeps the selection (toggling a
    // flow's default) must still recompute the entries.
    const sync = (): void => setIds([...modeler.canvas.selection]);
    sync();
    modeler.events.on('SelectionChanged', sync);
    modeler.events.on('ElementsChanged', sync);
    modeler.events.on('RootSet', sync);
    modeler.events.on('ImportDone', sync);
    return () => {
      modeler.events.off('SelectionChanged', sync);
      modeler.events.off('ElementsChanged', sync);
      modeler.events.off('RootSet', sync);
      modeler.events.off('ImportDone', sync);
    };
  }, [modeler]);

  /** The selection as the study holds it, read afresh on every sync. */
  const records = useMemo<ElementRecord[]>(() => ids.flatMap((id) => modeler.study.get(id) ?? []), [modeler, ids]);
  const element = records.length === 1 ? records[0] : undefined;
  /** A single selected caption: it gets a two-entry pad of its own (trash, brush). */
  const label = element?.kind === 'label' ? element : undefined;
  const visible = !isSimulating
    && records.length > 0
    // A caption gets the pad only on its OWN: mixed with real elements there is no
    // one meaning for "delete" to have.
    && (!records.some((record) => record.kind === 'label') || !!label);

  /** Drop the ghost and the tooltip whenever the pad goes away or the selection moves. */
  const clearPreview = useCallback(() => {
    modeler.canvas.clearAppendPreview();
    clearTimeout(tooltipTimer.current);
    setTooltip(null);
  }, [modeler]);

  /**
   * Arm the tooltip for the entry the pointer just entered: after a beat, at the pointer, as a
   * native `title` bubble does. The delay matters: the same hover puts up an append ghost right
   * of the pad, where a caption at the cursor would land, so the ghost shows first and the words
   * only if the pointer stays.
   */
  const armTooltip = useCallback((text: string, x: number, y: number) => {
    clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => setTooltip({ text, x, y }), TOOLTIP_DELAY);
  }, []);

  useEffect(() => () => clearTimeout(tooltipTimer.current), []);

  useEffect(() => clearPreview, [clearPreview, ids]);

  /* Written straight to the node: a pan is 60 position changes a second, and none
     of them is a React state change. */
  useEffect(() => {
    if (!visible) return;
    // The canvas publishes the gesture in flight on its root as `data-gesture`; the pad goes
    // away for the duration of one, or it would sit on the ghost being aimed and put its
    // trash under the cursor at the drop.
    const diagram = modeler.canvas.getContainer().querySelector('svg.sf-canvas');
    let frame = 0;
    let last = '';
    // Tracked separately from `last`, because the two answer different questions:
    // `last` skips a redundant transform, `shown` guarantees the pad is revealed on
    // the first frame it has an anchor for. Folding them into one check would let a
    // re-mount that lands on the same coordinates leave the node `visibility:hidden`
    // forever — it renders hidden and only the tick ever clears that.
    let shown = false;

    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      const node = ref.current;
      if (!node) return;
      const box = diagram?.hasAttribute('data-gesture') ? undefined : selectionBBox(modeler, ids);
      if (!box) {
        if (shown) {
          node.style.visibility = 'hidden';
          shown = false;
          // Whatever the pointer was hovering when the gesture began goes with it —
          // a tooltip left floating beside a pad that is no longer there, or a hover
          // ghost of an append nobody is going to make, is worse than nothing.
          clearPreview();
        }
        return;
      }
      const outline = OUTLINE_OFFSET * modeler.canvas.viewbox.scale;
      const left = Math.round(Math.max(4, Math.min(
        box.x + box.width + outline + OFFSET,
        window.innerWidth - node.offsetWidth - 4,
      )));
      const top = Math.round(Math.max(4, Math.min(
        box.y - outline,
        window.innerHeight - node.offsetHeight - 4,
      )));
      const next = `${left},${top}`;
      if (next !== last) {
        last = next;
        node.style.transform = `translate(${left}px, ${top}px)`;
      }
      if (!shown) {
        node.style.visibility = 'visible';
        shown = true;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [modeler, visible, ids, clearPreview]);

  const entries = useMemo<ContextPadEntry[]>(() => {
    if (!visible) return [];
    const { study } = modeler;
    const single = element;
    // A container that can be expanded: both container entries are gated on the one
    // answer, so no subclass can get the toggle without the drill-down or the other way round.
    const expandable = single?.kind === 'node' && isExpandable(single.type) ? single : undefined;
    // A sequence flow leaving a source that takes a `default` (the exclusive
    // gateway family, or an activity) gets the toggle-default entry.
    const flow = single?.kind === 'edge' && single.type === 'bpmn:SequenceFlow' ? single : undefined;
    const flowSource = flow?.source === undefined ? undefined : study.get(flow.source);
    const canToggleDefault = !!flowSource && (
      ['bpmn:ExclusiveGateway', 'bpmn:InclusiveGateway', 'bpmn:ComplexGateway'].includes(flowSource.type)
      || isBpmnSubtypeOf(flowSource.type, 'bpmn:Activity')
    );
    const isDefault = canToggleDefault && !!flow && !!flowSource
      && (study.businessObject(flowSource.id) as { default?: unknown } | undefined)?.default === study.businessObject(flow.id);
    // What the rules let the one selected element take part in.
    const can = (tool: 'append' | 'connect' | 'replace', args: Record<string, unknown>): boolean => !!single && study.can(tool, args).ok;
    return contextPadEntries({
      count: records.length,
      isShape: single?.kind === 'node',
      isConnection: single?.kind === 'edge',
      isLabel: single?.kind === 'label',
      canAppend: can('append', { from: single?.id }),
      canConnect: can('connect', { from: single?.id }),
      canAnnotate: can('append', { from: single?.id, type: 'bpmn:TextAnnotation' }),
      canReplace: can('replace', { id: single?.id }),
      canToggleDefault,
      isDefault,
      isChoreographyTask: single?.type === 'bpmn:ChoreographyTask',
      isExpandable: !!expandable,
      isExpanded: !!expandable && expandable.expanded !== false,
    });
  }, [modeler, visible, element, records]);

  const openMenu = useCallback((providerId: string) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const anchor = { x: Math.round(rect.right + 6), y: Math.round(rect.top) };
    openPopupMenu(
      providerId,
      { ...anchor, cursor: { ...anchor } },
      { title: t(MENU_TITLES[providerId] ?? 'Style'), width: 260 },
    );
  }, []);

  /** Show the transient ghost of what this entry would append. */
  const preview = useCallback((append: ContextPadAppend | undefined) => {
    // An entry that appends nothing still ENDS the previous ghost. `mouseleave`
    // already fires before the neighbour's `mouseenter`, so this is belt-and-braces
    // — but it is the belt that survives a pointer jumping between entries without
    // ever crossing the gap between them.
    if (!append || !element || element.kind === 'label') {
      modeler.canvas.clearAppendPreview();
      return;
    }
    modeler.canvas.previewAppend(element.id, newShape(append.bpmnType, append.extensionType));
  }, [modeler, element]);

  const run = useCallback((entry: ContextPadEntry) => {
    clearPreview();
    switch (entry.action) {
      case 'append.end-event':
      case 'append.text-annotation':
        if (element && entry.append) {
          void executeCommand(modeler, {
            type: 'AppendElement',
            from: element.id,
            bpmnType: entry.append.bpmnType,
            extensionType: entry.append.extensionType,
          });
        }
        return;
      case 'append':
        openMenu(APPEND_MENU);
        return;
      case 'replace':
        openMenu(REPLACE_MENU);
        return;
      case 'set-color':
        openMenu(COLOR_MENU);
        return;
      case 'delete':
        // A caption is not an element of the document, so there is nothing to
        // remove: the trash beside a selected label means "take this text away", and
        // the text is the owner's `name`. Clearing it is one undo step and round-trips as the
        // absence of the attribute, where deleting the label element would either be
        // a silent no-op or take the whole shape with it.
        if (label) {
          void executeCommand(modeler, {
            type: 'UpdateAttribute',
            element: modeler.study.businessObject(label.owner!),
            attributeName: 'name',
            value: '',
          });
          return;
        }
        void executeCommand(modeler, { type: 'DeleteElements', ids: [...ids] });
        return;
      case 'flow.toggle-default':
        if (element) void executeCommand(modeler, { type: 'ToggleDefaultFlow', id: element.id });
        return;
      case 'choreography.swap-initiator':
        if (element) void executeCommand(modeler, { type: 'SwapChoreographyInitiator', id: element.id });
        return;
      case 'expand.toggle':
        if (element) void executeCommand(modeler, { type: 'ToggleExpanded', id: element.id });
        return;
      case 'drilldown':
        if (element) void executeCommand(modeler, { type: 'DrillDown', id: element.id });
        return;
      default:
        return;
    }
  }, [modeler, element, ids, label, openMenu, clearPreview]);

  /** The connect entry is DRAGGED out of the pad, so it acts on press, not on click. */
  const startConnect = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    clearPreview();
    if (!element) return;
    const native = (event as unknown as { nativeEvent?: MouseEvent }).nativeEvent
      ?? (event as unknown as MouseEvent);
    void executeCommand(modeler, { type: 'StartConnect', from: element.id, event: native });
  }, [modeler, element, clearPreview]);

  if (!visible || entries.length === 0) return null;

  return (
    <>
      <div
        ref={ref}
        className={s.root}
        style={{ visibility: 'hidden' }}
        data-testid="context-pad"
        role="toolbar"
        aria-label="Selected element actions"
        onMouseLeave={clearPreview}
      >
        {entries.map((entry) => {
          /* `entries.ts` stays a pure table of English keys — it is unit-tested
             against exactly those strings — so the locale is applied HERE, at render
             time, the way every other piece of chrome does it. */
          const title = t(entry.title);
          return (
            <button
              key={entry.action}
              type="button"
              className={`${s.entry}${entry.action === 'connect' ? ` ${s.entryDraggable}` : ''}${entry.action === 'delete' ? ` ${s.entryDanger}` : ''}`}
              aria-label={title}
              data-action={entry.action}
              data-testid={`context-pad-${entry.action}`}
              onMouseEnter={(event) => {
                /* Down-and-right of the pointer, as a native `title` bubble sits. Anchored to
                   the entry instead, the label would land in the band the hover ghost occupies. */
                armTooltip(
                  title,
                  Math.round(event.clientX + TOOLTIP_GAP),
                  Math.round(event.clientY + TOOLTIP_DROP),
                );
                preview(entry.append);
              }}
              onMouseLeave={clearPreview}
              {...(entry.action === 'connect'
                ? { onPointerDown: startConnect }
                : { onClick: () => run(entry) })}
            >
              <span className={`${ICON_CLASSES[entry.icon]} ${s.entryIcon}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {tooltip && (
        <div
          className={s.tooltip}
          style={{ left: tooltip.x, top: tooltip.y }}
          role="tooltip"
          data-testid="context-pad-tooltip"
        >
          {tooltip.text}
        </div>
      )}
    </>
  );
}
