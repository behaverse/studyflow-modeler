import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { checkExpressions } from '@core/checks/expressions';
import { freshModdle } from '@tests/schemas';

/** What a study writes to be evaluated is checked before any run: a condition is FEEL, a timer's time ISO 8601. */

const study = (gate: string, timer: string): string => `id: expressions
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Rest:
      type: IntermediateCatchEvent
      eventDefinitions:
        Rest_Timer: { type: TimerEventDefinition${timer} }
    Gate: { type: ExclusiveGateway, default: F_No }
    Yes: { type: EndEvent }
    No: { type: EndEvent }
    F1: Start -> Rest
    F2: Rest -> Gate
    F_Yes:
      sourceRef: Gate
      targetRef: Yes
      conditionExpression: ${gate}
    F_No: Gate -> No
`;

test('a condition that is not FEEL, and a timer that says no time a run can keep, are reported before any run', () => {
  // [label, the gateway's condition, the timer's time, what the check says as `<severity> <element>: <fragment>`]
  const CASES: [string, string, string, string[]][] = [
    ['FEEL, and an ISO 8601 duration', 'score >= 0.9', ', timeDuration: PT5M', []],
    ['a placeholder reads as the path it names, in a condition and in a timer', '"{Play.rate} > 0.2"', ', timeDuration: "{rest}"', []],
    ['an idiom of another language', '"score == 1"', ', timeDate: "2026-10-01T09:00:00Z"', ['error F_Yes: is not FEEL']],
    ['a duration in words', 'score >= 0.9', ', timeDuration: 5 minutes', ['error Rest: cannot be kept: a timer\'s duration is ISO 8601']],
    ['a timer that says no time', 'score >= 0.9', '', ['error Rest: a timer says when']],
    ['a cycle is kept for its first firing', 'score >= 0.9', ', timeCycle: R3/PT10M', ['warning Rest: waits for its first firing only']],
    ['a schedule is not a wait', 'score >= 0.9', ', timeCycle: "0 9 * * 1"', ['warning Rest: passes a schedule at once']],
  ];
  for (const [label, gate, timer, says] of CASES) {
    const issues = checkExpressions(studyflowToDefinitions(study(gate, timer), freshModdle()));
    expect(issues, label).toHaveLength(says.length);
    says.forEach((expected, index) => {
      const [, severity, element, fragment] = /^(\w+) (\w+): (.*)$/.exec(expected)!;
      expect(issues[index], label).toMatchObject({ severity, elementId: element });
      expect(issues[index].message, label).toContain(fragment);
    });
  }
});
