import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  contextPadEntries,
  END_EVENT_APPEND,
  TEXT_ANNOTATION_APPEND,
  type ContextPadAction,
  type ContextPadContext,
} from '@modeler/contextPad/entries';

/**
 * WHAT the per-shape context pad offers, as a table (parity spec addenda 4+5,
 * ux-spec §4). The pad's other half — where the box floats, what a click dispatches —
 * needs a browser and lives in `tests/modeler.contextpad.spec.ts`; this one pins the
 * decision that can be made without a DOM, which is the one that goes silently wrong:
 * an entry offered for a selection whose rules refuse it is a button that throws, and
 * an entry order that drifts re-flows the 72px box into different rows.
 */

const SRC = join(process.cwd(), 'packages/modeler/src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

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

test('a task offers all seven entries of ux-spec §4, in row order', () => {
  // The order IS the layout: a 72px box with 22x22 entries wraps three to a row, so
  // this list is what puts append/annotation/append-anything on the first row, the
  // wrench and the two edit actions on the second, and `connect` alone on a third
  // (`edge-videos/preview/frame_05`, `edgemake/frame_05` for the wrench).
  expect(actionsOf(context({ canAppend: true, canAnnotate: true, canReplace: true }))).toEqual([
    'append.end-event',
    'append.text-annotation',
    'append',
    'replace',
    'delete',
    'set-color',
    'connect',
  ]);
});

test('the wrench is gated on its own rule, not on the append one', () => {
  // A container with contents, a pool and a boundary event are all appendable but not
  // replaceable (`Rules.canReplace`), so the two gates cannot stand in for each other.
  expect(actionsOf(context({ canAppend: true, canAnnotate: true }))).not.toContain('replace');
  // …and an END EVENT — nothing may follow it — is still replaceable.
  expect(actionsOf(context({ canAnnotate: true, canReplace: true }))).toEqual([
    'append.text-annotation',
    'replace',
    'delete',
    'set-color',
  ]);
});

test('a data shape gets connect (a data input association may start there) but no append', () => {
  expect(actionsOf(context({ canAppend: false, canConnect: true }))).toEqual([
    'delete',
    'set-color',
    'connect',
  ]);
});

test('an end event keeps the annotation but loses every flow-successor entry', () => {
  // Nothing may follow an end event, so `shape.append` refuses — but an association
  // to a text annotation still hangs off one, which is why the two gates are asked
  // separately rather than one standing in for the other.
  expect(actionsOf(context({ canAppend: false, canAnnotate: true }))).toEqual([
    'append.text-annotation',
    'delete',
    'set-color',
  ]);
});

test('a multi-selection keeps only the actions that mean something for a set', () => {
  expect(actionsOf(context({ count: 2, canAppend: true, canAnnotate: true }))).toEqual([
    'delete',
    'set-color',
  ]);
});

test('a selected connection gets three: a note may hang off the flow itself', () => {
  // ux-spec §4 verbatim — "For a connection (3 entries): `append.text-annotation`,
  // `delete`, `set-color`". A `bpmn:Association`'s `sourceRef` is a `BaseElement`,
  // so a sequence flow can carry one; what a connection cannot offer is the two
  // entries that need a shape to flow OUT of.
  // `canReplace` is asked and true here on purpose: a connection is not a shape, so
  // the wrench is withheld by the shape test rather than by the rule.
  expect(actionsOf(context({ isShape: false, isConnection: true, canAnnotate: true, canReplace: true }))).toEqual([
    'append.text-annotation',
    'delete',
    'set-color',
  ]);
  // …and when the rules refuse the annotation, the pad drops to the shared pair
  // rather than offering a button that would do nothing.
  expect(actionsOf(context({ isShape: false, isConnection: true }))).toEqual([
    'delete',
    'set-color',
  ]);
});

test('a choreography task adds the app\'s swap-initiator entry, last', () => {
  const actions = actionsOf(context({ canAppend: true, canAnnotate: true, canReplace: true, isChoreographyTask: true }));

  expect(actions.at(-1)).toBe('choreography.swap-initiator');
  // It joins the pad rather than replacing it: the stock entries all survive.
  expect(actions).toContain('delete');
  expect(actions).toContain('append.end-event');
});

test('an expandable container adds the toggle and the drill-down, last and together', () => {
  // The canvas has exactly two container gestures — a double click that toggles and a
  // 20-unit badge that opens — and neither is discoverable or keyboard-reachable. The
  // pad names both. They are gated on ONE flag, so no expandable subclass can end up
  // with the toggle and not the trip, which is the split the report was about.
  const actions = actionsOf(context({
    canAppend: true, canAnnotate: true, canReplace: true, isExpandable: true,
  }));

  expect(actions.slice(-2)).toEqual(['expand.toggle', 'drilldown.enter']);
  // The reference's own six keep the two rows they wrap into.
  expect(actions.slice(0, 6)).toEqual([
    'append.end-event', 'append.text-annotation', 'append', 'replace', 'delete', 'set-color',
  ]);

  // A plain task offers neither.
  expect(actionsOf(context({ canAppend: true }))).not.toContain('expand.toggle');
  expect(actionsOf(context({ canAppend: true }))).not.toContain('drilldown.enter');
  // Nor does a multi-selection: both act on one element.
  expect(actionsOf(context({ count: 2, isExpandable: true }))).not.toContain('expand.toggle');
});

test('the toggle entry says which way it will go', () => {
  const titleOf = (ctx: ContextPadContext): string | undefined =>
    contextPadEntries(ctx).find((entry) => entry.action === 'expand.toggle')?.title;

  expect(titleOf(context({ isExpandable: true, isExpanded: false }))).toBe('Expand');
  expect(titleOf(context({ isExpandable: true, isExpanded: true }))).toBe('Collapse');
});

test('a multi-selection of choreography tasks offers no swap, because the swap acts on one', () => {
  expect(actionsOf(context({ count: 3, isChoreographyTask: true }))).not.toContain(
    'choreography.swap-initiator',
  );
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

test('every entry carries a tooltip title and an icon class', () => {
  for (const entry of contextPadEntries(context({ canAppend: true, canAnnotate: true, canReplace: true, isChoreographyTask: true }))) {
    expect(entry.title, `${entry.action} has a tooltip (addendum 5 §2)`).toBeTruthy();
    expect(entry.icon, `${entry.action} has an icon`).toContain('iconify');
  }
});

test('the entry table is locale-free and the pad translates at render time', () => {
  // The assertions above compare English strings verbatim, which is only safe while
  // `entries.ts` itself never translates. The pair has to hold together.
  expect(read('contextPad/entries.ts'), 'the table imports no translator')
    .not.toMatch(/from '@modeler\/i18n'/);
  expect(read('contextPad/ContextPad.tsx'), 'the renderer puts each title through `t()`')
    .toMatch(/const title = t\(entry\.title\)/);
});

test('a selected CAPTION gets the trash and the brush, and nothing that needs a shape', () => {
  // `edge-videos/labels/frame_08` — the frame addendum 3 §4 was written from — shows
  // exactly two affordances beside a selected label. A caption reaches this table as
  // neither a shape NOR a connection, which is what separates it from a flow: a note
  // hangs off the flow it annotates, but a caption is not an element of the document
  // for anything to hang off at all.
  expect(actionsOf(context({ isShape: false }))).toEqual(['delete', 'set-color']);
  // …and asking for the append gates anyway changes nothing, because they are only
  // consulted for a shape or a connection.
  expect(actionsOf(context({ isShape: false, canAppend: true, canAnnotate: true })))
    .toEqual(['delete', 'set-color']);
});
