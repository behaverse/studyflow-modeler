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

test('a pool walks one path: a parallel split stops a run, an activity or event follows only its first flow, an inclusive gateway stops it too', () => {
  // Each issue as `<severity> <element id>: <message>`.
  const CASES: [type: string, issues: string[]][] = [
    // Only the split: the parallel join, two flows in and one out, is walked.
    ['ParallelGateway', ['error Split: "Split here" splits into 2 parallel paths; a pool walks one path, so the walk stops here']],
    ['Task', ['error Split: "Split here" has 2 outgoing sequence flows; a pool walks one path, so the walk follows only the first, "first"']],
    ['IntermediateThrowEvent', ['error Split: "Split here" has 2 outgoing sequence flows; a pool walks one path, so the walk follows only the first, "first"']],
    ['InclusiveGateway', ['error Split: "Split here" is an inclusive gateway with 2 outgoing flows; a pool walks one path, so the walk stops here rather than take only the first whose condition holds']],
    ['ExclusiveGateway', []],
    ['EventBasedGateway', []],
  ];
  for (const [type, issues] of CASES) {
    const found = checkRunnerPaths(studyflowToDefinitions(split(type), freshModdle()));
    expect(found.map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`), type).toEqual(issues);
  }
});
