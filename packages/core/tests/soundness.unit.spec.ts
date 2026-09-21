import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { checkSoundness } from '@core/checks/soundness';
import { freshModdle } from '@tests/schemas';

/** Well-formedness condition 3: every flow node lies on a path from a start event to an end event. */

const study = (elements: string): string => `id: soundness
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  name: Study
  flowElements:
${elements}`;

/** A start, a task whose error boundary event leaves for an exit, a decision, and two ends. */
const SOUND = `    Start:
      type: StartEvent
    Play:
      type: Task
      name: Play the task
    Failed:
      type: BoundaryEvent
      attachedToRef: Play
      eventDefinitions:
        Error: { type: ErrorEventDefinition }
    Stopped:
      type: EndEvent
    Gate:
      type: ExclusiveGateway
      default: F_No
    Done:
      type: EndEvent
    Retry:
      type: EndEvent
    F1: Start -> Play
    F2: Play -> Gate
    F3: Failed -> Stopped
    F_Yes: Gate -> Done
    F_No: Gate -> Retry
`;

const BATTERY = `    Battery:
      type: SubProcess
      flowElements:
        A:
          type: Task
        B:
          type: Task
        FA: A -> B
    F0: Battery -> Play
`;

test('each flow node lies on a path from a start event, or a boundary event, to an end event', () => {
  // Each issue as `<element id>: <message>`.
  const CASES: [label: string, elements: string, issues: string[]][] = [
    ['a boundary event starts a path', SOUND, []],
    ['a node no start event leads to', `${SOUND}    Pilot:\n      type: Task\n      name: Pilot session\n    F4: Pilot -> Done\n`, [
      'Pilot: "Pilot session" lies on no path from a start event to an end event: no start event leads to it',
    ]],
    ['a dead end', `${SOUND}    Check:\n      type: Task\n      name: Check again\n    F4: Gate -> Check\n`, [
      'Check: "Check again" lies on no path from a start event to an end event: it leads to no end event',
    ]],
    ['a sub-process with sequence flows but no start or end event', SOUND.replace('    F1: Start -> Play\n', `    F1: Start -> Battery\n${BATTERY}`), [
      'Battery: "Battery" has sequence flows but no start event',
      'Battery: "Battery" has sequence flows but no end event',
    ]],
    ['a container with no sequence flow is not checked', '    Only:\n      type: Task\n', []],
  ];
  for (const [label, elements, messages] of CASES) {
    const issues = checkSoundness(studyflowToDefinitions(study(elements), freshModdle()));
    expect(issues.map((issue) => `${issue.elementId}: ${issue.message}`), label).toEqual(messages);
    expect(issues.every((issue) => issue.severity === 'error'), label).toBe(true);
  }
});
