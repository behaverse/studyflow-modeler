/**
 * What the per-shape context pad offers — the entry list, as data.
 *
 * The pad is the box that floats beside a selection (parity spec addendum 4;
 * ux-spec §4 measures the geometry and lists the entries in DOM order, and the
 * reference frames named below are the source). This module is the half that can be
 * decided without a DOM: given what is selected and what the rules allow, WHICH
 * entries appear and in what order. `ContextPad.tsx` renders them and wires each
 * `action` to a command.
 *
 * Order matters — it is what makes the 72px box wrap into rows of three the way the
 * reference does. For a task that is ux-spec §4's table verbatim: append end-event /
 * annotation / append-anything on the first row, wrench / trash / brush on the
 * second, connect alone on the third (`edge-videos/edgemake/frame_05`, `v1/frame_03`
 * and `preview/frame_08` all show the wrench between the append group and the
 * trash).
 *
 * One stock group the reference pad has is deliberately absent: `append.*` for
 * gateways/tasks/intermediate events. The app removed those from the stock pad while
 * bpmn-js was the editor (ux-spec §4, "the app **removes** three stock entries"), and
 * `append` covers them through the searchable menu.
 */

import { BPMN } from '@core/constants';
import { ICONS } from '@modeler/icons';

/** `data-action` of a pad entry — diagram-js's own names, so the two pads compare. */
export type ContextPadAction =
  | 'append.end-event'
  | 'append.text-annotation'
  | 'append'
  | 'replace'
  | 'connect'
  | 'delete'
  | 'set-color'
  | 'choreography.swap-initiator';

/** A fixed successor a pad entry appends, which is also what its hover ghost draws. */
export type ContextPadAppend = {
  bpmnType: string;
  extensionType?: string;
};

export type ContextPadEntry = {
  action: ContextPadAction;
  /**
   * Tooltip text (parity spec addendum 5 §2 — every entry has one), as an English
   * TRANSLATION KEY. This module stays pure and locale-free so its table can be
   * asserted verbatim; `ContextPad.tsx` puts each title through `t()` when it
   * renders, which is where the rest of the app's chrome translates too.
   */
  title: string;
  /** Iconify class, rendered by `palette/PaletteIcon`-style `<span>`. */
  icon: string;
  /**
   * Present when the entry appends one KNOWN element: the pad previews it on hover
   * and commits exactly it on click (addendum 5 §3 — ghost and commit must agree).
   */
  append?: ContextPadAppend;
};

/** What the pad needs to know about the current selection to decide its entries. */
export type ContextPadContext = {
  /** How many elements are selected. */
  count: number;
  /** Whether the single selection is a shape (not a connection, not a label). */
  isShape: boolean;
  /**
   * Whether the single selection is a CONNECTION. A caption is neither this nor a
   * shape, which is what keeps its pad at two entries (`labels/frame_08`) while a
   * flow's is three (ux-spec §4).
   */
  isConnection?: boolean;
  /** `rules.allowed('shape.append')` — may a flow successor follow this element? */
  canAppend: boolean;
  /** …and the same question for a text annotation, which an end event still takes. */
  canAnnotate: boolean;
  /**
   * `rules.allowed('shape.replace')` — may this element be retyped in place at all?
   * False for a pool, a lane, a container with contents and a boundary event, which
   * is why the wrench is a gated entry rather than a fixture of every pad.
   */
  canReplace: boolean;
  /** Whether the single selection is a `bpmn:ChoreographyTask`. */
  isChoreographyTask: boolean;
};

/** The end event the pad's first entry appends — the palette's End tile, verbatim. */
export const END_EVENT_APPEND: ContextPadAppend = {
  bpmnType: BPMN.EndEvent,
  extensionType: 'studyflow:EndEvent',
};

/** The annotation the pad's second entry appends. */
export const TEXT_ANNOTATION_APPEND: ContextPadAppend = {
  bpmnType: BPMN.TextAnnotation,
};

/**
 * The entries the pad shows for `context`, in DOM (and therefore layout) order.
 *
 * A MULTI-selection keeps only the two actions that mean something for a set —
 * which is also what the reference offers: everything else needs one element to act
 * on. A CONNECTION keeps those two plus the annotate entry, which is the 3-entry
 * pad ux-spec §4 records: an association may leave a sequence flow, so a note can
 * hang off the flow itself rather than off one of its ends. Its append-successor
 * and connect entries stay out — those need a shape to flow from.
 */
export function contextPadEntries(context: ContextPadContext): ContextPadEntry[] {
  const entries: ContextPadEntry[] = [];
  const single = context.count === 1;

  if (single && context.isShape && context.canAppend) {
    entries.push({
      action: 'append.end-event',
      title: 'Append end event',
      icon: ICONS.bpmnEndEvent,
      append: END_EVENT_APPEND,
    });
  }
  if (single && (context.isShape || context.isConnection) && context.canAnnotate) {
    entries.push({
      action: 'append.text-annotation',
      title: 'Add text annotation',
      icon: ICONS.bpmnTextAnnotation,
      append: TEXT_ANNOTATION_APPEND,
    });
  }

  if (single && context.isShape && context.canAppend) {
    entries.push({ action: 'append', title: 'Append element', icon: ICONS.threeDots });
  }
  if (single && context.isShape && context.canReplace) {
    entries.push({ action: 'replace', title: 'Change element', icon: ICONS.bpmnScrewWrench });
  }

  entries.push({ action: 'delete', title: 'Delete', icon: ICONS.bpmnTrash });
  entries.push({ action: 'set-color', title: 'Set color', icon: ICONS.palette });

  // Last, which is where ux-spec §4's table puts it: the first six wrap into two
  // rows of three inside the 72px box and `connect` starts a third on its own.
  if (single && context.isShape && context.canAppend) {
    entries.push({
      action: 'connect',
      title: 'Connect to other element',
      icon: ICONS.bpmnConnection,
    });
  }

  // The app's own entry, contributed to the stock pad while bpmn-js was the editor
  // (ux-spec §4). It goes after everything the stock pad has, so the six entries the
  // reference shows keep the two rows the reference shows them in.
  if (single && context.isChoreographyTask) {
    entries.push({
      action: 'choreography.swap-initiator',
      title: 'Switch initiating participant',
      icon: ICONS.swapVertical,
    });
  }

  return entries;
}
