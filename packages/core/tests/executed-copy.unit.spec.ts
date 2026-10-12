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
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  name: Steps
  documentation: >-
    A description folded where its author broke it,
    not where the writer would.
  flowElements:
    Start:
      type: StartEvent
      name: Begin  # a comment on its line
    Work:
      type: ServiceTask
      name: Work
      documentation: Runs once.
      implementation: python://builtins.dict
      additionalArguments: {arm: standard, n: 2}
    Sub:
      type: SubProcess
      flowElements:
        - id: Sub_Start
          type: StartEvent
        - id: Sub_End
          type: EndEvent
        - id: Sub_Flow
          sourceRef: Sub_Start
          targetRef: Sub_End
    Done:
      type: EndEvent
    F1: Start -> Work
    F2: Work -> Sub
    F3: Sub -> Done
`;

type Stamp = Record<string, string>;

/** `text` read as a run reads it, then left as the local runtime leaves it: `state`, and on each element `stamps`
 * names a record, after taking out its records of the same action when `replace`. */
function ran(text: string, state: Record<string, unknown>, stamps: Record<string, Stamp>, replace = false): StudyModel {
  const model = studyModel(text);
  model.study.state = state;
  for (const [id, stamp] of Object.entries(stamps)) {
    const element = model.get(id)!;
    const entries = (Array.isArray(element.extensionElements) ? element.extensionElements : []) as Element[];
    element.extensionElements = [...entries.filter((entry) => !(replace && entry.type === 'prov:Activity' && entry.action === stamp.action)), { type: 'prov:Activity', run: 'r1', ...stamp }];
  }
  return model;
}

/** A record as the file writes it, `indent` spaces in, under its own `extensionElements` key when `keyed`. */
function record(indent: number, { action, when, what, commit }: Stamp, keyed = true): string {
  const lines = [
    ...(keyed ? ['extensionElements:'] : []),
    `${keyed ? '  ' : ''}- type: prov:Activity`, `  action: ${action}`, `  when: "${when}"`, ...(what ? [`  what: "${what}"`] : []), '  run: r1', ...(commit ? [`  commit: ${commit}`] : []),
  ];
  return lines.map((line, i) => `${' '.repeat(indent + (keyed && i > 1 ? 2 : 0))}${line}\n`).join('');
}

/** `text` with `inserted` after the first `anchor`. */
const after = (text: string, anchor: string, inserted: string): string => text.replace(anchor, () => `${anchor}${inserted}`);

/** The lines of `before` a line diff to `after` removes: none when `after` only adds lines. */
function removed(before: string, after: string): string[] {
  const lines = after.split('\n');
  let at = 0;
  return before.split('\n').filter((line) => {
    while (at < lines.length && lines[at] !== line) at += 1;
    return at++ >= lines.length;
  });
}

/** The studies `a` and `b` are, read back. */
const sameStudy = (a: string, b: string, model: StudyModel): void => {
  expect(readStudy(a, model.metamodel, () => {})).toEqual(readStudy(b, model.metamodel, () => {}));
};

const FIRST: Record<string, Stamp> = {
  Start: { action: 'executed', when: '2026-10-12T10:00:01.000+02:00', commit: 'c1' },
  Work: { action: 'executed', when: '2026-10-12T10:00:02.000+02:00', commit: 'c2' },
  Sub: { action: 'executed', when: '2026-10-12T10:00:04.000+02:00', commit: 'c3' },
  Sub_Start: { action: 'executed', when: '2026-10-12T10:00:03.000+02:00', commit: 'c3' },
};
const RUN_1 = { action: 'executed', when: '2026-10-12T10:00:00.000+02:00', run: 'r1', seed: 7 };
const RUN_2 = { ...RUN_1, when: '2026-10-12T11:00:00.000+02:00' };
const FIRST_STATE = { _meta: { prov: [RUN_1], reached: { Start: 1, Work: 1 } } };
/** The state as the file writes it, after the runs `when` names. */
const stateText = (...when: string[]): string => `state:
  _meta:
    prov:
${when.map((moment) => `      - action: executed\n        when: "${moment}"\n        run: r1\n        seed: 7\n`).join('')}    reached:
      Start: 1
      Work: 1
`;
const FIRST_STATE_TEXT = stateText(RUN_1.when);

/** What the first run leaves: each record after the keys its element leads with (its type, name and documentation),
 * in either spelling of a list, and the state at the end. */
const EXECUTED = [
  ['      name: Begin  # a comment on its line\n', record(6, FIRST.Start)],
  ['      documentation: Runs once.\n', record(6, FIRST.Work)],
  ['      type: SubProcess\n', record(6, FIRST.Sub)],
  ['        - id: Sub_Start\n          type: StartEvent\n', record(10, FIRST.Sub_Start)],
].reduce((text, [anchor, inserted]) => after(text, anchor, inserted), REGISTERED) + FIRST_STATE_TEXT;

test('a run\'s records go after the keys each element leads with and its state at the end, and every line of the file stays', async () => {
  const executed = ran(REGISTERED, FIRST_STATE, FIRST);
  const text = executedText(REGISTERED, executed);
  expect(text).toBe(EXECUTED);
  expect(removed(REGISTERED, text!)).toEqual([]);
  // Read back, the copy is the study the writer's own spelling of it is, and the protocol it registered.
  sameStudy(text!, studyText(executed.study, executed.metamodel), executed);
  expect(await protocolDigest(studyModel(text!))).toBe(await protocolDigest(studyModel(REGISTERED)));
});

test('a re-run of an executed copy replaces the records it replaces and the state, and adds the rest', () => {
  const again = {
    Start: { action: 'executed', when: '2026-10-12T11:00:01.000+02:00', commit: 'c4' },
    Work: { action: 'reused', when: '2026-10-12T11:00:02.000+02:00', what: '2026-10-12T10:00:02.000+02:00' },
  };
  const executed = ran(EXECUTED, { _meta: { ...FIRST_STATE._meta, prov: [RUN_1, RUN_2] } }, again, true);
  const text = executedText(EXECUTED, executed);
  expect(text).toBe(after(EXECUTED.replace(record(6, FIRST.Start), record(6, again.Start)), record(6, FIRST.Work), record(8, again.Work, false))
    .replace(FIRST_STATE_TEXT, stateText(RUN_1.when, RUN_2.when)));
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
  const executed = ran(braced, FIRST_STATE, stamps);
  const text = executedText(braced, executed);
  expect(text).toBe(braced
    .replace('        - {id: Sub_End, type: EndEvent}\n', `        - id: Sub_End\n          type: EndEvent\n${record(10, stamps.Sub_End)}`)
    .replace('    Done: { type: EndEvent }\n', `    Done:\n      type: EndEvent\n${record(6, stamps.Done)}`) + FIRST_STATE_TEXT);
  sameStudy(text!, studyText(executed.study, executed.metamodel), executed);
});

test('a change no run makes, or a record on an element the text does not write as a mapping, leaves the copy to the writer', () => {
  const cases: [string, StudyModel][] = [
    ['an edit to the protocol', (() => {
      const model = ran(REGISTERED, FIRST_STATE, { Start: FIRST.Start });
      model.get('Work')!.name = 'Rework';
      return model;
    })()],
    ['a record on a flow written as an arrow', ran(REGISTERED, FIRST_STATE, { F1: FIRST.Start })],
  ];
  for (const [what, executed] of cases) expect(executedText(REGISTERED, executed), what).toBeUndefined();
});
