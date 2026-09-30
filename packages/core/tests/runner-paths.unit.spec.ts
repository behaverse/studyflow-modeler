import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { checkRunnerPaths } from '@core/checks/runner-paths';
import { freshModdle } from '@tests/schemas';

/** The splits the walk does not take: it walks one path per pool. */

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

test('a pool walks one path: a parallel split stops a run, an activity or event follows only its first flow, an inclusive or a complex gateway stops it too, a waiting join is passed', () => {
  // Each issue as `<severity> <element id>: <message>`.
  const CASES: [type: string, issues: string[]][] = [
    // The split stops a run; the join, two flows in and one out, is walked, and warned about.
    ['ParallelGateway', [
      'error Split: "Split here" splits into 2 parallel paths; a pool walks one path, so the walk stops here',
      'warning Join: "Join" joins 2 paths, which BPMN waits for; a pool walks one path, so the walk passes it as it arrives (an exclusive gateway merges without waiting)',
    ]],
    ['Task', ['error Split: "Split here" has 2 outgoing sequence flows; a pool walks one path, so the walk follows only the first, "first"']],
    ['IntermediateThrowEvent', ['error Split: "Split here" has 2 outgoing sequence flows; a pool walks one path, so the walk follows only the first, "first"']],
    ['InclusiveGateway', ['error Split: "Split here" is an inclusive gateway with 2 outgoing flows; a pool walks one path, so the walk stops here rather than take only the first whose condition holds']],
    ['ComplexGateway', ['error Split: "Split here" is a complex gateway with 2 outgoing flows; the walk reads no activation rule, so it stops here rather than take it as an exclusive gateway']],
    ['ExclusiveGateway', []],
    ['EventBasedGateway', []],
  ];
  for (const [type, issues] of CASES) {
    const found = checkRunnerPaths(studyflowToDefinitions(split(type), freshModdle()));
    expect(found.map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`), type).toEqual(issues);
  }
});

test('a scope walks from its first start event, and a second is warned about', () => {
  const study = split('ExclusiveGateway').replace('    End:\n', '    Later:\n      type: StartEvent\n    End:\n').replace('    F_End: Join -> End\n', '    F_End: Join -> End\n    F_Later: Later -> A\n');
  expect(checkRunnerPaths(studyflowToDefinitions(study, freshModdle())).map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`)).toEqual([
    'warning Later: "Study" has 2 start events; a pool walks one path, from the first, "Start", so a path from "Later" never runs',
  ]);
});
