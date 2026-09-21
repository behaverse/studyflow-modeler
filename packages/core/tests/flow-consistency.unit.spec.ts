import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { YAML_DUMP_OPTIONS, studyflowToDefinitions } from '@core/document';
import { checkFlowConsistency } from '@core/checks/flow-consistency';
import { freshModdle } from '@tests/schemas';

/** Flow consistency: at every node, the tokens that came in are the tokens that went on plus those that left by its exits. */

const PLAN = `id: flows
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Gate:
      type: ExclusiveGateway
      name: Eligible?
      default: F_No
    Excluded:
      type: EndEvent
      name: Excluded
    Play:
      type: Task
      name: Play the task
    Failed:
      type: BoundaryEvent
      name: Failed
      attachedToRef: Play
      eventDefinitions:
        Error: { type: ErrorEventDefinition }
    Stopped:
      type: EndEvent
    Done:
      type: EndEvent
    F1: Start -> Gate
    F_Yes:
      sourceRef: Gate
      targetRef: Play
      conditionExpression: consented
    F_No: Gate -> Excluded
    F_Played: Play -> Done
    F_Failed: Failed -> Stopped
`;

/** Ten tokens: two excluded, one failed, seven done. */
const REACHED = {
  Start: 10, F1: 10, Gate: 10, F_Yes: 8, F_No: 2, Excluded: 2,
  Play: 8, F_Played: 7, Done: 7, Failed: 1, F_Failed: 1, Stopped: 1,
};

const run = (reached: Record<string, number>): string => PLAN + yaml.dump({ state: { _meta: { reached } } }, YAML_DUMP_OPTIONS);

test('the counts balance at every node, or the check says where they do not', () => {
  // Each issue as `<element id>: <message>`.
  const CASES: [label: string, reached: Record<string, number>, issues: string[]][] = [
    ['counts that balance', REACHED, []],
    ['an exit count changed after the run', { ...REACHED, Excluded: 1 }, ['Excluded: flow consistency at "Excluded": reached 1 != inflow 2 (1 unaccounted)']],
    // A boundary event is the attrition of the activity it sits on, and starts its own path.
    ['an exit through a boundary event dropped', { ...REACHED, Failed: 0 }, [
      'Play: flow consistency at "Play the task": inflow 8 != outflow 7 + attrition 0 (1 unaccounted)',
      'Failed: flow consistency at "Failed": inflow 0 != outflow 1 + attrition 0 (1 unaccounted)',
    ]],
    ['a run from before flows were counted', { Start: 10, Gate: 10, Excluded: 9, Play: 8, Done: 7 }, []],
  ];
  for (const [label, reached, issues] of CASES) {
    const found = checkFlowConsistency(studyflowToDefinitions(run(reached), freshModdle()));
    expect(found.map((issue) => `${issue.elementId}: ${issue.message}`), label).toEqual(issues);
    expect(found.every((issue) => issue.severity === 'error'), label).toBe(true);
  }
  expect(checkFlowConsistency(studyflowToDefinitions(PLAN, freshModdle())), 'a file no run has stamped').toEqual([]);
});
