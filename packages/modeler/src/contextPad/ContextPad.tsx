/**
 * The per-shape context pad: the floating box beside the selection, with append, change, delete, style, connect and
 * the choreography task's `choreography.swap-initiator`.
 *
 * `contextPad/entries.ts` decides what is offered (pure, unit-tested), and `contextPad/actions.ts` runs it, for the pad
 * and for the command palette's Selection group alike. This file positions the box, previews, and keeps the pad's own
 * `connect`, dragged out of it.
 *
 * An entry that appends one known element previews it on hover: a ghost of the shape at its auto-place position,
 * with the connection that would reach it (`canvas.previewAppend`). Nothing is committed. The ghost and the click
 * place the shape the same way, so the click lands where the hover showed it.
 *
 * The canvas places the pad (`canvas.anchor`): beside the selection's outline as the camera and the edits move it,
 * out of the way of a gesture.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { contextPadEntries, type ContextPadAppend, type ContextPadEntry } from '@modeler/contextPad/entries';
import { PAD_ICONS, actionableSelection, padContext, applyPadEntry } from '@modeler/contextPad/actions';
import { newShape } from '@modeler/palette/newShape';
import { contextPad as s } from '@modeler/contextPad/styles';
import { useIsSimulating } from '@modeler/simulation/useIsSimulating';
import { InlineInspector } from '@modeler/inspector/InlineInspector';
import { useInspectorShown } from '@modeler/inspector/visibility';
import { t } from '@modeler/i18n';
import type { ElementRecord } from '@canvas/index.ts';

/** Where a tooltip sits relative to the pointer: the offsets a native `title` bubble uses. */
const TOOLTIP_GAP = 4;
const TOOLTIP_DROP = 18;

/**
 * How long the pointer must rest on an entry before its tooltip appears: a native `title`
 * bubble's beat, which also keeps the caption off the hover ghost that goes up in the same
 * instant (see `armTooltip`).
 */
const TOOLTIP_DELAY = 700;

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
  const records = useMemo<ElementRecord[]>(() => actionableSelection(modeler, ids), [modeler, ids]);
  const element = records.length === 1 ? records[0] : undefined;
  const visible = !isSimulating && records.length > 0;
  // With the inspector closed, one shape's pad holds the inline inspector, under the shape rather than beside the next step.
  const inline = !useInspectorShown() && element?.kind === 'node';

  /** Drop the ghost and the tooltip whenever the pad goes away or the selection moves. */
  const clearPreview = useCallback(() => {
    modeler.canvas.clearAppendPreview();
    clearTimeout(tooltipTimer.current);
    setTooltip(null);
  }, [modeler]);

  /**
   * Arms the tooltip for the entry the pointer just entered. It appears after a delay, at the pointer, as a native
   * `title` bubble does. The same hover puts up an append ghost right of the pad, where an immediate caption would
   * cover it, so the ghost shows first and the caption only if the pointer stays.
   */
  const armTooltip = useCallback((text: string, x: number, y: number) => {
    clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => setTooltip({ text, x, y }), TOOLTIP_DELAY);
  }, []);

  useEffect(() => () => clearTimeout(tooltipTimer.current), []);

  useEffect(() => clearPreview, [clearPreview, ids]);


  const entries = useMemo<ContextPadEntry[]>(
    () => (visible ? contextPadEntries(padContext(modeler, records)) : []),
    [modeler, visible, records],
  );

  /* The canvas keeps the pad beside the selection (with the inline inspector, under it) and out of the way of a gesture; anchored afresh
     whenever its size changes, so a pad or a card of another size is kept inside the view. */
  useEffect(() => {
    const node = ref.current;
    if (!visible || !node) return;
    const place = () => modeler.canvas.anchor(node, ids, inline ? 'below' : 'right');
    place();
    const resized = new ResizeObserver(place);
    resized.observe(node);
    return () => {
      resized.disconnect();
      modeler.canvas.anchor(node, null);
    };
  }, [modeler, visible, ids, entries, inline]);

  /** Show the transient ghost of what this entry would append. */
  const preview = useCallback((append: ContextPadAppend | undefined) => {
    // An entry that appends nothing still ends the previous ghost. `mouseleave` normally does that before the
    // neighbour's `mouseenter`; this covers a pointer that jumps between entries without crossing the gap between them.
    if (!append || !element || element.kind === 'label') {
      modeler.canvas.clearAppendPreview();
      return;
    }
    modeler.canvas.previewAppend(element.id, newShape(append.bpmnType, append.extensionType));
  }, [modeler, element]);

  const run = useCallback((entry: ContextPadEntry) => {
    clearPreview();
    // A menu opens right of the pad, level with its top.
    const rect = ref.current?.getBoundingClientRect();
    applyPadEntry(modeler, entry, records, rect && { x: Math.round(rect.right + 6), y: Math.round(rect.top) });
  }, [modeler, records, clearPreview]);

  /** The connect entry is dragged out of the pad, so it acts on press, not on click. */
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
        className={inline ? s.inline : s.root}
        style={{ visibility: 'hidden' }}
        data-testid="context-pad"
        {...(inline ? {} : { role: 'toolbar', 'aria-label': 'Selected element actions' })}
        onMouseLeave={clearPreview}
      >
        <div className={inline ? s.inlineActions : 'contents'} {...(inline ? { role: 'toolbar', 'aria-label': 'Selected element actions' } : {})}>
        {entries.map((entry) => {
          /* `entries.ts` stays a pure table of English keys, which its unit spec pins, so the locale is
             applied here, at render time, as for the rest of the chrome. */
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
              <span className={`${PAD_ICONS[entry.icon]} ${s.entryIcon}`} aria-hidden="true" />
            </button>
          );
        })}
        </div>
        {inline && <InlineInspector id={element.id} />}
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
