import { expect, test } from '@playwright/test';

import { checkWrites } from '@core/checks/writes';
import { studyModel } from '@tests/schemas';

/** Two steps on paths that run at once, writing one property or data element: the one that finishes last sets it. */

/** `step`'s data output association into `target`, or none. */
const writes = (step: string, target: string): string => (target ? `\n      dataOutputAssociations: { Out_${step}: { targetRef: ${target} } }` : '');

/** Start, then `split` (of its type) to A and B, which `join` gathers before C and the end; A, B and C each write
 * what they are given: `First` and `Second` are references to one data object, `x` a property of the study. */
const study = (split: string, a: string, b: string, c = '', join = split === 'Task' ? 'ParallelGateway' : split): string => `id: writes
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  properties:
    x: { name: x }
  flowElements:
    Start: { type: StartEvent }
    Split: { type: ${split}, name: Split }
    A:
      type: Task
      name: A${writes('A', a)}
    B:
      type: Task
      name: B${writes('B', b)}
    Join: { type: ${join} }
    C:
      type: Task
      name: C${writes('C', c)}
    End: { type: EndEvent }
    Table: { type: DataObject, name: Table }
    First: { type: DataObjectReference, dataObjectRef: Table }
    Second: { type: DataObjectReference, dataObjectRef: Table }
    F0: Start -> Split
    F_A: Split -> A
    F_B: Split -> B
    F_A2: A -> Join
    F_B2: B -> Join
    F_C: Join -> C
    F_End: C -> End
`;

test('steps that can run at once and write one value are reported, steps that cannot are left alone', () => {
  const race = (data: string): string[] => [`warning B: "A" and "B" both write "${data}" on paths that run at once from "Split", so the one that finishes last sets it`];
  // [label, the study, what the check says as `<severity> <element id>: <message>`]
  const CASES: [string, string, string[]][] = [
    ['a parallel split, one property', study('ParallelGateway', 'x', 'x'), race('x')],
    ['a parallel split, two references to one data object', study('ParallelGateway', 'First', 'Second'), race('Table')],
    ['an inclusive split', study('InclusiveGateway', 'x', 'x'), race('x')],
    ['a task with two flows out', study('Task', 'x', 'x'), race('x')],
    ['an exclusive split: one path only', study('ExclusiveGateway', 'x', 'x'), []],
    ['a step after the paths meet', study('ParallelGateway', 'x', '', 'x'), []],
    ['different values', study('ParallelGateway', 'x', 'First'), []],
  ];
  for (const [label, text, issues] of CASES) {
    expect(checkWrites(studyModel(text)).map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`), label).toEqual(issues);
  }
});

test('a sub-process writes what the steps inside it write', () => {
  const text = study('ParallelGateway', '', 'x').replace(`    A:
      type: Task
      name: A
`, `    A:
      type: SubProcess
      name: A
      flowElements:
        A0: { type: StartEvent }
        Inner:
          type: Task
          name: Inner
          dataOutputAssociations: { Out_Inner: { targetRef: x } }
        A1: { type: EndEvent }
        AF0: A0 -> Inner
        AF1: Inner -> A1
`);
  expect(checkWrites(studyModel(text)).map((issue) => issue.message)).toEqual([
    '"A" and "B" both write "x" on paths that run at once from "Split", so the one that finishes last sets it',
  ]);
});
