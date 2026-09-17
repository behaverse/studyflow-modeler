import { test, expect } from '@playwright/test';

import {
  contextPadEntries,
  END_EVENT_APPEND,
  TEXT_ANNOTATION_APPEND,
  type ContextPadAction,
  type ContextPadContext,
} from '@modeler/contextPad/entries';

/**
 * WHAT the per-shape context pad offers, as a table. The pad's other half, where the
 * box floats and what a click does, needs a browser and lives in
 * `tests/modeler.contextpad.spec.ts`; this pins the decision that can be made without
 * a DOM, which is the one that goes silently wrong: an entry offered for a selection
 * whose rules refuse it is a button that does nothing, and an entry order that drifts
 * re-flows the 98px box into different rows.
 */

/** A selection description with everything refused, to be widened per case. */
function context(overrides: Partial<ContextPadContext> = {}): ContextPadContext {
  return {
    count: 1,
    isShape: true,
    canAppend: false,
    // Connect follows append unless a case pulls them apart (a data shape can
    // start an edge but take no successor).
    canConnect: overrides.canAppend ?? false,
    canAnnotate: false,
    canReplace: false,
    isChoreographyTask: false,
    ...overrides,
  };
}

const actionsOf = (ctx: ContextPadContext): ContextPadAction[] =>
  contextPadEntries(ctx).map((entry) => entry.action);

test('the entries a selection gets, in the order they wrap into rows', () => {
  // The order IS the layout: the 98px box wraps its 22px entries three to a row, so a
  // task's first row is the two fixed successors and append-anything, the second the
  // wrench and the two edits, the third `connect` alone.
  const task: ContextPadAction[] = ['append.end-event', 'append.text-annotation', 'append', 'replace', 'delete', 'set-color', 'connect'];
  const CASES: [label: string, ctx: ContextPadContext, actions: ContextPadAction[]][] = [
    ['a task', context({ canAppend: true, canAnnotate: true, canReplace: true }), task],
    // A container with contents or a pool appends but is not replaceable; the two gates are apart.
    ['something that appends but cannot be retyped', context({ canAppend: true, canAnnotate: true }),
      ['append.end-event', 'append.text-annotation', 'append', 'delete', 'set-color', 'connect']],
    // Nothing may follow an end event, but a note hangs off it and it can be retyped.
    ['an end event', context({ canAnnotate: true, canReplace: true }), ['append.text-annotation', 'replace', 'delete', 'set-color']],
    ['an end event that cannot be retyped', context({ canAnnotate: true }), ['append.text-annotation', 'delete', 'set-color']],
    // A data input association may start at a data shape, so it gets connect but no successor.
    ['a data shape', context({ canConnect: true }), ['delete', 'set-color', 'connect']],
    ['a multi-selection: only what means something for a set', context({ count: 2, canAppend: true, canAnnotate: true }), ['delete', 'set-color']],
    // A note may hang off a flow; the entries that need a shape to flow OUT of stay away,
    // and the wrench is withheld by the shape test even when the rule would allow it.
    ['a connection', context({ isShape: false, isConnection: true, canAnnotate: true, canReplace: true }), ['append.text-annotation', 'delete', 'set-color']],
    ['a connection the rules give no note', context({ isShape: false, isConnection: true }), ['delete', 'set-color']],
    ['a flow whose source takes a default', context({ isShape: false, isConnection: true, canToggleDefault: true }), ['delete', 'set-color', 'flow.toggle-default']],
    ['a choreography task: the swap, last', context({ canAppend: true, canAnnotate: true, canReplace: true, isChoreographyTask: true }), [...task, 'choreography.swap-initiator']],
    ['several choreography tasks: no swap, which acts on one', context({ count: 3, isChoreographyTask: true }), ['delete', 'set-color']],
    ['an expandable container: the toggle and the trip in, last', context({ canAppend: true, canAnnotate: true, canReplace: true, isExpandable: true }), [...task, 'expand.toggle', 'drilldown']],
    ['a plain task: no toggle', context({ canAppend: true }), ['append.end-event', 'append', 'delete', 'set-color', 'connect']],
    ['several containers: no toggle', context({ count: 2, isExpandable: true }), ['delete', 'set-color']],
    // A caption is neither a shape nor a connection: nothing can hang off it, so the append
    // gates are not even asked.
    ['a caption', context({ isShape: false }), ['delete', 'set-color']],
    ['a caption, whatever the append gates say', context({ isShape: false, canAppend: true, canAnnotate: true }), ['delete', 'set-color']],
  ];
  for (const [label, ctx, actions] of CASES) expect(actionsOf(ctx), label).toEqual(actions);
});

test('the two toggles say which way they will go', () => {
  const titleOf = (ctx: ContextPadContext, action: ContextPadAction): string | undefined =>
    contextPadEntries(ctx).find((entry) => entry.action === action)?.title;
  const flow = { isShape: false, isConnection: true, canToggleDefault: true };
  // The wording is the UI's; what is pinned is that each state's title names the way it goes, and the two differ.
  const CASES: [label: string, title: string | undefined, expected: RegExp][] = [
    ['a flow that is not the default', titleOf(context(flow), 'flow.toggle-default'), /^(?!un)set.*default/i],
    ['the default flow', titleOf(context({ ...flow, isDefault: true }), 'flow.toggle-default'), /unset.*default/i],
    ['a collapsed container', titleOf(context({ isExpandable: true, isExpanded: false }), 'expand.toggle'), /expand/i],
    ['an expanded container', titleOf(context({ isExpandable: true, isExpanded: true }), 'expand.toggle'), /collapse/i],
  ];
  for (const [label, title, expected] of CASES) expect(title, label).toMatch(expected);
});

test('exactly the two fixed-successor entries carry an append, and it is the one they commit', () => {
  const entries = contextPadEntries(context({ canAppend: true, canAnnotate: true }));
  const withAppend = entries.filter((entry) => entry.append);

  // `append` (the searchable menu) must NOT carry one: it has no single successor to
  // ghost, and a ghost that disagrees with the commit is the bug addendum 5 §3 names.
  expect(withAppend.map((entry) => entry.action)).toEqual([
    'append.end-event',
    'append.text-annotation',
  ]);
  expect(withAppend[0].append).toEqual(END_EVENT_APPEND);
  expect(withAppend[1].append).toEqual(TEXT_ANNOTATION_APPEND);
});
