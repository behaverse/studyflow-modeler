/**
 * The per-shape context pad (parity spec addendum 4 + 5, ux-spec §4).
 *
 * The floating box beside the selection: append-anything, the colour picker, the
 * wrench, the trash, connect, and studyflow's own `choreography.swap-initiator`.
 *
 * The split is the usual one: `contextPad/entries.ts` decides WHAT is offered (pure,
 * unit-tested), this file positions the box and wires each `action` to a command on
 * the bus. It reaches the editor only through the facade — `Editor.rules` for
 * its gates, `Editor.canvas.getAbsoluteBBox` for its anchor and
 * `Editor.gestures` for the two gestures it starts — and app chrome's own
 * `openPopupMenu` for the three menus its entries open.
 *
 * **Hover preview** (addendum 5): an entry that appends ONE known element previews
 * it — the editor draws a blue ghost of the shape at its auto-place position, with
 * the connection that would reach it, into its own overlay layer. Nothing is
 * committed, and because both the ghost and the click go through the same
 * `appendPosition`, what the hover shows is where the click lands.
 *
 * Positioning runs on an animation frame rather than an event, for the reason the
 * toolbar did: the canvas publishes no viewbox topic, and a pan, a zoom and a drag
 * of the selected shape all have to move the pad. One bbox read per frame, only
 * while something is selected.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { openPopupMenu } from '@modeler/editor/popupMenus';
import { contextPadEntries, type ContextPadAppend, type ContextPadEntry } from '@modeler/contextPad/entries';
import { contextPad as s } from '@modeler/contextPad/styles';
import { APPEND_MENU, COLOR_MENU, REPLACE_MENU } from '@modeler/popup/PopupMenus';
import { useIsSimulating } from '@modeler/simulation/useIsSimulating';
import { t } from '@modeler/i18n';
import { is, type EditorElement, type Editor, type Rect } from '@modeler/editor/port';

/** Gap between the selection OUTLINE's right edge and the pad (ux-spec §4). */
const OFFSET = 8;

/**
 * How far the selection outline sits outside the element it wraps — the canvas's
 * `OUTLINE_OFFSET`, in diagram units, so it scales with the zoom. The pad anchors on
 * the outline, not on the shape (measured in the reference: a task spanning
 * x 170→280 puts its pad at x 288, i.e. 275 + 5 + 8).
 */
const OUTLINE_OFFSET = 5;

/**
 * Where a tooltip sits relative to the POINTER (`preview/frame_04`, `frame_05`,
 * `frame_08` — measured off the frames at 2x, so ~3px right and ~16px down in CSS
 * pixels, rounded to the offsets a native `title` bubble uses).
 */
const TOOLTIP_GAP = 4;
const TOOLTIP_DROP = 18;

/**
 * How long the pointer must rest on an entry before its tooltip appears — a
 * native `title` bubble's beat, which is also what keeps the caption off the hover
 * ghost that goes up in the same instant (see `armTooltip`).
 */
const TOOLTIP_DELAY = 700;

/** Heading each pad entry that opens a popup gives the menu it opens. */
const MENU_TITLES: Record<string, string> = {
  [APPEND_MENU]: 'Append element',
  [REPLACE_MENU]: 'Change element',
  [COLOR_MENU]: 'Set color',
};

/** Whether `element` is a shape the full pad applies to (not a connection, not a caption). */
function isShapeElement(element: EditorElement): boolean {
  if (!element) return false;
  if (element.labelTarget) return false;
  if (element.kind) return element.kind === 'node';
  return !element.waypoints;
}

/**
 * Whether `element` is a CONNECTION — a flow or an association, which gets the
 * 3-entry pad of ux-spec §4 (annotate, delete, colour). A caption is excluded here
 * as it is from {@link isShapeElement}: it is neither, and gets two entries.
 */
function isConnectionElement(element: EditorElement): boolean {
  if (!element || element.labelTarget) return false;
  if (element.kind) return element.kind === 'edge';
  return !!element.waypoints;
}

/**
 * Whether `element` is an external LABEL — a caption, drawn beside the element it
 * names. It gets a pad of its own, but a two-entry one: `edge-videos/labels/frame_08`
 * shows a trash and a brush beside a selected caption and nothing else, because
 * every other entry needs a shape to hang off (parity spec addendum 3 §4).
 */
function isLabelElement(element: EditorElement): boolean {
  return !!element?.labelTarget || element?.type === 'label';
}

/** The element a caption names — itself, for anything that is not one. */
function ownerOf(element: EditorElement): EditorElement {
  return element?.labelTarget ?? element;
}

/** The union bbox of `elements` in screen coordinates, skipping off-plane ones. */
function selectionBBox(editor: Editor, elements: EditorElement[]): Rect | undefined {
  let box: Rect | undefined;
  for (const element of elements) {
    let next: Rect;
    try {
      next = editor.canvas.getAbsoluteBBox(element);
    } catch {
      // Off-plane elements throw rather than answer; skip them.
      continue;
    }
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) continue;
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
  const modeler = useRequiredModeler();
  const isSimulating = useIsSimulating(modeler);
  const [elements, setElements] = useState<EditorElement[]>([]);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const sync = (): void => setElements(modeler.selection.get());
    sync();
    modeler.events.on('selection.changed', sync);
    modeler.events.on('root.set', sync);
    modeler.events.on('import.done', sync);
    return () => {
      modeler.events.off('selection.changed', sync);
      modeler.events.off('root.set', sync);
      modeler.events.off('import.done', sync);
    };
  }, [modeler]);

  const element = elements.length === 1 ? elements[0] : undefined;
  /** A single selected caption — the two-entry pad of `labels/frame_08`. */
  const label = element && isLabelElement(element) ? element : undefined;
  const visible = !isSimulating
    && elements.length > 0
    // A caption gets the pad only on its OWN: mixed with real elements there is no
    // one meaning for "delete" to have.
    && (!elements.some(isLabelElement) || !!label);

  /** Drop the ghost and the tooltip whenever the pad goes away or the selection moves. */
  const clearPreview = useCallback(() => {
    modeler.canvas.clearAppendPreview();
    clearTimeout(tooltipTimer.current);
    setTooltip(null);
  }, [modeler]);

  /**
   * Arm the tooltip for the entry the pointer just entered — after a beat, and at
   * the pointer, which is what a native `title` bubble does and what the reference's
   * tooltips ARE (`preview/frame_04`, `frame_05`, `frame_08` show the browser's own
   * dark bubble hanging off the cursor).
   *
   * The delay is the half that matters. The same hover puts up an append GHOST, and
   * the ghost lands in the band immediately right of the pad — exactly where a
   * caption at the cursor goes. Showing both at once buries the one thing the hover
   * exists to show under its own label; showing the ghost first and the words only
   * if the pointer stays is how the reference reads, and it costs the tooltip
   * nothing (nobody hovers an icon for its caption and leaves within the beat).
   */
  const armTooltip = useCallback((text: string, x: number, y: number) => {
    clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => setTooltip({ text, x, y }), TOOLTIP_DELAY);
  }, []);

  useEffect(() => () => clearTimeout(tooltipTimer.current), []);

  useEffect(() => clearPreview, [clearPreview, elements]);

  /* Written straight to the node: a pan is 60 position changes a second, and none
     of them is a React state change. */
  useEffect(() => {
    if (!visible) return;
    // The editor publishes the gesture in flight on its root as `data-gesture`; the
    // pad goes away for the duration of one. `edge-videos/dnd/frame_01` and
    // `frame_05` show a shape being dragged with NO pad riding along — which is the
    // point: the pad would sit on top of the very ghost the user is aiming, and its
    // trash would be under the cursor at the moment of the drop.
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
      const box = diagram?.hasAttribute('data-gesture') ? undefined : selectionBBox(modeler, elements);
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
      const outline = OUTLINE_OFFSET * modeler.canvas.getViewport().zoom();
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
  }, [modeler, visible, elements, clearPreview]);

  const entries = useMemo<ContextPadEntry[]>(() => {
    if (!visible) return [];
    const single = elements.length === 1 ? elements[0] : undefined;
    const askAppend = (targetType?: string): boolean => (
      !!single && modeler.rules.allowed('shape.append', {
        element: single,
        source: single,
        ...(targetType ? { targetType } : {}),
      })
    );
    return contextPadEntries({
      count: elements.length,
      isShape: !!single && isShapeElement(single),
      isConnection: !!single && isConnectionElement(single),
      canAppend: askAppend(),
      canAnnotate: askAppend('bpmn:TextAnnotation'),
      canReplace: !!single && modeler.rules.allowed('shape.replace', { element: single }),
      isChoreographyTask: !!single && is(single, 'bpmn:ChoreographyTask'),
    });
  }, [modeler, visible, elements]);

  const openMenu = useCallback((providerId: string) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const anchor = { x: Math.round(rect.right + 6), y: Math.round(rect.top) };
    openPopupMenu(
      providerId,
      { ...anchor, cursor: { ...anchor } },
      { title: t(MENU_TITLES[providerId] ?? 'Set color'), width: 260 },
    );
  }, []);

  /** Show the transient ghost of what this entry would append (addendum 5). */
  const preview = useCallback((append: ContextPadAppend | undefined) => {
    // An entry that appends nothing still ENDS the previous ghost. `mouseleave`
    // already fires before the neighbour's `mouseenter`, so this is belt-and-braces
    // — but it is the belt that survives a pointer jumping between entries without
    // ever crossing the gap between them.
    if (!append || !element) {
      modeler.canvas.clearAppendPreview();
      return;
    }
    // No business object: a ghost is a picture, and minting one would claim an id
    // for an element that is never created. The type carries the footprint, the
    // silhouette and the rules verdict, which is everything the preview needs.
    const shape = modeler.canvas.createShape({ type: append.bpmnType });
    const source = modeler.canvas.resolveElement(element);
    if (source) modeler.canvas.previewAppend(source, shape);
  }, [modeler, element]);

  const run = useCallback((entry: ContextPadEntry) => {
    clearPreview();
    if (!modeler) return;
    switch (entry.action) {
      case 'append.end-event':
      case 'append.text-annotation':
        if (element && entry.append) {
          void executeCommand(modeler, {
            type: 'AppendElement',
            source: element,
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
        // remove: what the trash means beside a selected label
        // (`edge-videos/labels/frame_08`) is "take this text away", and the text is
        // the OWNER's `name`. Clearing it is one undo step and round-trips as the
        // absence of the attribute, where deleting the label element would either be
        // a silent no-op or take the whole shape with it.
        if (label) {
          void executeCommand(modeler, {
            type: 'UpdateAttribute',
            element: ownerOf(label),
            attributeName: 'name',
            value: '',
          });
          return;
        }
        void executeCommand(modeler, { type: 'DeleteElements', elements });
        return;
      case 'choreography.swap-initiator':
        if (element) void executeCommand(modeler, { type: 'SwapChoreographyInitiator', element });
        return;
      default:
        return;
    }
  }, [modeler, element, elements, label, openMenu, clearPreview]);

  /** The connect entry is DRAGGED out of the pad, so it acts on press, not on click. */
  const startConnect = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    clearPreview();
    if (!element) return;
    const native = (event as unknown as { nativeEvent?: MouseEvent }).nativeEvent
      ?? (event as unknown as MouseEvent);
    void executeCommand(modeler, { type: 'StartConnect', source: element, event: native });
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
              className={`${s.entry}${entry.action === 'connect' ? ` ${s.entryDraggable}` : ''}`}
              title={title}
              aria-label={title}
              data-action={entry.action}
              data-testid={`context-pad-${entry.action}`}
              onMouseEnter={(event) => {
                /* Down-and-right of the POINTER, the way a native `title` bubble
                   sits — which is exactly what the reference's tooltips are, and
                   why `preview/frame_04`, `frame_05` and `frame_08` each put the
                   label at the cursor rather than squared to the entry it names.
                   Anchoring to the entry's bottom edge instead lands the label in
                   the band the hover GHOST occupies (`frame_02` draws the appended
                   end event immediately right of the pad's second row), so the one
                   thing the hover exists to show ends up underneath its own
                   caption. One pointer offset fixes both. */
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
              <span className={`${entry.icon} ${s.entryIcon}`} aria-hidden="true" />
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
