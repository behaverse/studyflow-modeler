import { expect, test } from '@playwright/test';

import { checkRunnerPaths } from '@core/checks/runner-paths';
import { studyModel } from '@tests/schemas';

/** What the walk reads otherwise than BPMN: a complex gateway, a second start event. */

/** Start, then `node` (of `type`) splitting to A and B, which meet again at an end. */
const split = (type: string): string => `id: paths
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Split:
      type: ${type}
      name: Split here
    A:
      type: Task
    B:
      type: Task
    Join:
      type: ${type === 'ParallelGateway' ? type : 'ExclusiveGateway'}
    End:
      type: EndEvent
    F0: Start -> Split
    F_A:
      name: first
      sourceRef: Split
      targetRef: A
    F_B: Split -> B
    F_A2: A -> Join
    F_B2: B -> Join
    F_End: Join -> End
`;

test('a split and a join are walked as BPMN says, but for a complex gateway, whose activation rule the walk does not read', () => {
  // Each issue as `<severity> <element id>: <message>`.
  const CASES: [type: string, issues: string[]][] = [
    ['ParallelGateway', []],
    ['InclusiveGateway', []],
    ['Task', []],
    ['IntermediateThrowEvent', []],
    ['ExclusiveGateway', []],
    ['EventBasedGateway', []],
    ['ComplexGateway', ['error Split: "Split here" is a complex gateway with 2 outgoing flows; the walk reads no activation rule, so it stops here rather than take it as another kind of gateway']],
  ];
  for (const [type, issues] of CASES) {
    const found = checkRunnerPaths(studyModel(split(type)));
    expect(found.map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`), type).toEqual(issues);
  }
});

test('a scope walks from its first start event, and a second is warned about', () => {
  const study = split('ExclusiveGateway').replace('    End:\n', '    Later:\n      type: StartEvent\n    End:\n').replace('    F_End: Join -> End\n', '    F_End: Join -> End\n    F_Later: Later -> A\n');
  expect(checkRunnerPaths(studyModel(study)).map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`)).toEqual([
    'warning Later: "Study" has 2 start events; the walk starts it at the first, "Start", so a path from "Later" never runs',
  ]);
});
