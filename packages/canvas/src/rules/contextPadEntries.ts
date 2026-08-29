/**
 * What the per-shape context pad offers — the entry list, as data.
 *
 * The pad is the box that floats beside a selection (parity spec addendum 4;
 * ux-spec §4 measures the geometry and lists the entries in DOM order, and the
 * reference frames named below are the source). This module is the half that can be
 * decided without a DOM: given what is selected and what the rules allow, WHICH
 * entries appear and in what order. The host's `ContextPad.tsx` renders them and
 * wires each `action` to a command.
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

import { BPMN } from '@core/constants.ts';

/** `data-action` of a pad entry — diagram-js's own names, so the two pads compare. */
export type ContextPadAction =
  | 'append.end-event'
  | 'append.text-annotation'
  | 'append'
  | 'replace'
  | 'connect'
  | 'delete'
  | 'set-color'
  | 'flow.toggle-default'
  | 'choreography.swap-initiator'
  | 'expand.toggle'
  | 'drilldown.enter';

/**
 * Symbolic name of an entry's icon. Icon ART is host chrome (Iconify classes, SVG,
 * whatever the host draws with), so this table names the picture and the host's
 * renderer maps each key to its own asset.
 */
export type ContextPadIcon =
  | 'end-event'
  | 'annotation'
  | 'append'
  | 'wrench'
  | 'trash'
  | 'palette'
  | 'connect'
  | 'default-flow'
  | 'swap'
  | 'subprocess'
  | 'drilldown';

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
   * asserted verbatim; the host's `ContextPad.tsx` puts each title through `t()`
   * when it renders, which is where the rest of the app's chrome translates too.
   */
  title: string;
  /** Symbolic icon key — the host maps it to its own asset at render time. */
  icon: ContextPadIcon;
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
  /**
   * `rules.allowed('connection.start')` — may ANY edge start here? Wider than
   * `canAppend`: a data object/store takes no successor but can source a data
   * input association.
   */
  canConnect: boolean;
  /** …and the same question for a text annotation, which an end event still takes. */
  canAnnotate: boolean;
  /**
   * `rules.allowed('shape.replace')` — may this element be retyped in place at all?
   * False for a pool, a lane, a container with contents and a boundary event, which
   * is why the wrench is a gated entry rather than a fixture of every pad.
   */
  canReplace: boolean;
  /**
   * Whether the single selection is a sequence flow whose SOURCE takes a default
   * flow (an exclusive/inclusive/complex gateway, or an activity) — the gate on
   * the `flow.toggle-default` entry.
   */
  canToggleDefault?: boolean;
  /** Whether that flow currently IS its source's default — the toggle's wording. */
  isDefault?: boolean;
  /** Whether the single selection is a `bpmn:ChoreographyTask`. */
  isChoreographyTask: boolean;
  /**
   * Whether the single selection is an expandable CONTAINER (`Canvas.canExpand` —
   * the sub-process family plus the choreography containers). Both container entries
   * hang off this one flag, so every subclass gets both or neither.
   */
  isExpandable?: boolean;
  /** Whether that container is currently drawn expanded — the toggle's wording. */
  isExpanded?: boolean;
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
      icon: 'end-event',
      append: END_EVENT_APPEND,
    });
  }
  if (single && (context.isShape || context.isConnection) && context.canAnnotate) {
    entries.push({
      action: 'append.text-annotation',
      title: 'Add text annotation',
      icon: 'annotation',
      append: TEXT_ANNOTATION_APPEND,
    });
  }

  if (single && context.isShape && context.canAppend) {
    entries.push({ action: 'append', title: 'Append element', icon: 'append' });
  }
  if (single && context.isShape && context.canReplace) {
    entries.push({ action: 'replace', title: 'Change element', icon: 'wrench' });
  }

  entries.push({ action: 'delete', title: 'Delete', icon: 'trash' });
  entries.push({ action: 'set-color', title: 'Set color', icon: 'palette' });

  // A sequence flow leaving a gateway/activity that takes a default: toggle it.
  if (single && context.isConnection && context.canToggleDefault) {
    entries.push({
      action: 'flow.toggle-default',
      title: context.isDefault ? 'Unset default flow' : 'Set as default flow',
      icon: 'default-flow',
    });
  }

  // Last, which is where ux-spec §4's table puts it: the first six wrap into two
  // rows of three inside the 72px box and `connect` starts a third on its own.
  if (single && context.isShape && context.canConnect) {
    entries.push({
      action: 'connect',
      title: 'Connect to other element',
      icon: 'connect',
    });
  }

  // The app's own entry, contributed to the stock pad while bpmn-js was the editor
  // (ux-spec §4). It goes after everything the stock pad has, so the six entries the
  // reference shows keep the two rows the reference shows them in.
  if (single && context.isChoreographyTask) {
    entries.push({
      action: 'choreography.swap-initiator',
      title: 'Switch initiating participant',
      icon: 'swap',
    });
  }

  // The two CONTAINER entries, also app-contributed, also after the reference's six
  // so its two rows stay the two rows it draws.
  //
  // They exist because the canvas has exactly two gestures for a container — a double
  // click that toggles it and a 20-unit badge that opens it — and neither is
  // discoverable or keyboard-reachable. The pad is: it names both actions, it says
  // which way the toggle will go, and it is the non-destructive route for a user who
  // wants to look inside without rewriting `isExpanded`.
  if (single && context.isShape && context.isExpandable) {
    entries.push({
      action: 'expand.toggle',
      title: context.isExpanded ? 'Collapse' : 'Expand',
      icon: 'subprocess',
    });
    entries.push({
      action: 'drilldown.enter',
      title: 'Open contents',
      icon: 'drilldown',
    });
  }

  return entries;
}
