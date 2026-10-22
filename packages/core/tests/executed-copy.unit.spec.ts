import { expect, test } from '@playwright/test';

import { protocolDigest } from '@core/document';
import { executedText } from '@core/model/executed';
import type { Element, StudyModel } from '@core/model/index';
import { readStudy, studyText } from '@core/model/yaml';
import { studyModel } from '@tests/schemas';

/** The executed copy of a `.studyflow.yaml` file (packages/core/src/model/executed.ts): the text the run was given,
 * every line of it, with the run's records and its state spliced in. */

const REGISTERED = `# The registered plan. Its comments, its folds and its short forms stay as they are written.
id: spliced
schemas:
  studyflow: http://behaverse.org/schemas/studyflow/v1

P:
  type: Process
  name: Steps
  studyflow:Study: {}
  documentation: >-
    A description folded where its author broke it,
    not where the writer would.
  elements:
    Start:
      type: StartEvent
      name: Begin  # a comment on its line

    Work:
      type: ServiceTask
      name: Work
      implementation: python://builtins.dict
      additionalArguments: {arm: standard, n: 2}
      documentation: Runs once.

    Sub:
      type: SubProcess
      elements:
        - id: Sub_Start
          type: StartEvent
        - id: Sub_End
          type: EndEvent
        - id: Sub_Flow
          source: $Sub_Start
          target: $Sub_End

    Done:
      type: EndEvent

    F1: Start -> Work
    F2: Work -> Sub
    F3: Sub -> Done
`;

type Stamp = Record<string, string | number>;

/** `text` read as a run reads it, then left as the local runtime leaves it: `state`, and on each element `stamps`
 * names a record, after taking out its records of the same action on the elements `replaced` names. */
function ran(text: string, state: Record<string, unknown>, stamps: Record<string, Stamp>, replaced: string[] = []): StudyModel {
  const model = studyModel(text);
  model.study.state = state;
  for (const [id, stamp] of Object.entries(stamps)) {
    const element = model.get(id)!;
    const entries = (Array.isArray(element.extensionElements) ? element.extensionElements : []) as Element[];
    const kept = entries.filter((entry) => !(replaced.includes(id) && entry.type === 'prov:Activity' && entry.action === stamp.action));
    element.extensionElements = [...kept, { type: 'prov:Activity', run: 'r1', ...stamp }];
  }
  return model;
}

/** A record as the file writes it, on one line `indent` spaces in, under its own `prov:Activity` key when `keyed`. */
function record(indent: number, { action, when, what, seed, commit }: Stamp, keyed = true): string {
  const fields = [`action: ${action}`, `when: "${when}"`, ...(what ? [`what: "${what}"`] : []), 'run: r1', ...(seed ? [`seed: ${seed}`] : []), ...(commit ? [`commit: ${commit}`] : [])];
  const line = `${' '.repeat(keyed ? indent + 2 : indent)}- {${fields.join(', ')}}\n`;
  return keyed ? `${' '.repeat(indent)}prov:Activity:\n${line}` : line;
}

/** `text` with `inserted` after the first `anchor`. */
const after = (text: string, anchor: string, inserted: string): string => text.replace(anchor, () => `${anchor}${inserted}`);
/** `text` with `inserted` before the first `anchor`. */
const before = (text: string, anchor: string, inserted: string): string => text.replace(anchor, () => `${inserted}${anchor}`);

/** The lines of `before` a line diff to `after` removes: none when `after` only adds lines. */
function removed(earlier: string, later: string): string[] {
  const lines = later.split('\n');
  let at = 0;
  return earlier.split('\n').filter((line) => {
    while (at < lines.length && lines[at] !== line) at += 1;
    return at++ >= lines.length;
  });
}

/** The studies `a` and `b` are, read back. */
const sameStudy = (a: string, b: string, model: StudyModel): void => {
  expect(readStudy(a, model.metamodel, () => {})).toEqual(readStudy(b, model.metamodel, () => {}));
};

const RUN_1: Stamp = { action: 'executed', when: '2026-10-12T10:00:00.000+02:00', seed: 7 };
const RUN_2: Stamp = { ...RUN_1, when: '2026-10-12T11:00:00.000+02:00' };
const FIRST: Record<string, Stamp> = {
  P: RUN_1,
  Start: { action: 'executed', when: '2026-10-12T10:00:01.000+02:00', commit: 'c1' },
  Work: { action: 'executed', when: '2026-10-12T10:00:02.000+02:00', commit: 'c2' },
  Sub: { action: 'executed', when: '2026-10-12T10:00:04.000+02:00', commit: 'c3' },
  Sub_Start: { action: 'executed', when: '2026-10-12T10:00:03.000+02:00', commit: 'c3' },
};
/** The state a run leaves, `work` the times it reached Work, and the file's text of it, after a blank line at its end. */
const stateOf = (work: number): Record<string, unknown> => ({ _meta: { reached: { Start: 1, Work: work } } });
const stateText = (work: number): string => `\nstate:\n  _meta:\n    reached:\n      Start: 1\n      Work: ${work}\n`;

/** What the first run leaves: each element's records after its other keys, before its documentation and the elements
 * it holds, in either spelling of a list; the run's own on the study's root; and the state at the end. */
const EXECUTED = ([
  [before, '  documentation: >-\n', record(2, FIRST.P)],
  [after, '      name: Begin  # a comment on its line\n', record(6, FIRST.Start)],
  [before, '      documentation: Runs once.\n', record(6, FIRST.Work)],
  [before, '      elements:\n', record(6, FIRST.Sub)],
  [after, '        - id: Sub_Start\n          type: StartEvent\n', record(10, FIRST.Sub_Start)],
] as const).reduce((text, [place, anchor, inserted]) => place(text, anchor, inserted), REGISTERED) + stateText(1);

test('a run\'s records go on the elements they are about and its state at the end, and every line of the file stays', async () => {
  const executed = ran(REGISTERED, stateOf(1), FIRST);
  const text = executedText(REGISTERED, executed);
  expect(text).toBe(EXECUTED);
  expect(removed(REGISTERED, text!)).toEqual([]);
  // Read back, the copy is the study the writer's own spelling of it is, and the protocol it registered.
  sameStudy(text!, studyText(executed.study, executed.metamodel), executed);
  expect(await protocolDigest(studyModel(text!))).toBe(await protocolDigest(studyModel(REGISTERED)));
});

test('a re-run of an executed copy replaces the records it replaces and the state, and adds the rest', () => {
  const again: Record<string, Stamp> = {
    P: RUN_2,
    Start: { action: 'executed', when: '2026-10-12T11:00:01.000+02:00', commit: 'c4' },
    Work: { action: 'reused', when: '2026-10-12T11:00:02.000+02:00', what: '2026-10-12T10:00:02.000+02:00' },
  };
  const executed = ran(EXECUTED, stateOf(2), again, ['Start']);
  const text = executedText(EXECUTED, executed);
  const added = after(after(EXECUTED, record(2, FIRST.P), record(4, again.P, false)), record(6, FIRST.Work), record(8, again.Work, false));
  expect(text).toBe(added.replace(record(6, FIRST.Start), record(6, again.Start)).replace(stateText(1), stateText(2)));
  // What the run added is all it takes out: every line registered is still there.
  expect(removed(REGISTERED, text!)).toEqual([]);
  sameStudy(text!, studyText(executed.study, executed.metamodel), executed);
});

test('an element written in braces is written as a block to take its record, keyed by its id or in a plain list', () => {
  const braced = REGISTERED
    .replace('        - id: Sub_End\n          type: EndEvent\n', '        - {id: Sub_End, type: EndEvent}\n')
    .replace('    Done:\n      type: EndEvent\n', '    Done: { type: EndEvent }\n');
  const stamps = {
    Sub_End: { action: 'executed', when: '2026-10-12T10:00:05.000+02:00', commit: 'c5' },
    Done: { action: 'executed', when: '2026-10-12T10:00:06.000+02:00', commit: 'c6' },
  };
  const executed = ran(braced, stateOf(1), stamps);
  const text = executedText(braced, executed);
  expect(text).toBe(braced
    .replace('        - {id: Sub_End, type: EndEvent}\n', `        - id: Sub_End\n          type: EndEvent\n${record(10, stamps.Sub_End)}`)
    .replace('    Done: { type: EndEvent }\n', `    Done:\n      type: EndEvent\n${record(6, stamps.Done)}`) + stateText(1));
  sameStudy(text!, studyText(executed.study, executed.metamodel), executed);
});

test('a change no run makes, or a record on an element the text does not write as a mapping, leaves the copy to the writer', () => {
  const cases: [string, StudyModel][] = [
    ['an edit to the protocol', (() => {
      const model = ran(REGISTERED, stateOf(1), { Start: FIRST.Start });
      model.get('Work')!.name = 'Rework';
      return model;
    })()],
    ['a record on a flow written as an arrow', ran(REGISTERED, stateOf(1), { F1: FIRST.Start })],
  ];
  for (const [what, executed] of cases) expect(executedText(REGISTERED, executed), what).toBeUndefined();
});
