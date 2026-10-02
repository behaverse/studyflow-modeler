import { expect, test } from '@playwright/test';

import { checkLabels } from '@core/checks/labels';
import { studyModel } from '@tests/schemas';

/** A label that copies, as a number, a value its element reads is a second copy of it, and `validate` names the
 * placeholder that shows the value instead. */

type Named = 'Failed' | 'Discontinued' | 'Enough' | 'Too_Few' | 'Accurate';

/** A threshold on the process that a task's exit reads, decision rules wired into a sub-process whose gateway reads
 * one, and a gateway whose condition writes its number itself; each label as written, unless `names` gives another. */
const study = (names: Partial<Record<Named, string>>): string => {
  const name = (id: Named, written: string): string => JSON.stringify(names[id] ?? written);
  return `id: labels
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Subjects:
  type: Process
  properties:
    P_Max:
      name: max_unanswered
      value: 0.2
  flowElements:
    Start:
      type: StartEvent
    Play:
      type: Task
      name: Play the task
    Failed:
      type: BoundaryEvent
      name: ${name('Failed', '> {max_unanswered:%} unanswered')}
      attachedToRef: Play
      eventDefinitions:
        Cond:
          type: ConditionalEventDefinition
          condition: "{Play.failedTrialRate} > max_unanswered"
    Discontinued:
      type: EndEvent
      name: ${name('Discontinued', 'Discontinued: more than {max_unanswered:%} unanswered')}
    Analysis:
      type: SubProcess
      dataInputAssociations:
        In_Rules:
          sourceRef:
            - Rules
      flowElements:
        A_Start:
          type: StartEvent
        Enough:
          type: ExclusiveGateway
          name: ${name('Enough', 'At least {min_per_arm} per arm?')}
          default: Enough_Yes
        Not_Testable:
          type: EndEvent
        Tested:
          type: EndEvent
        A_F0: A_Start -> Enough
        Too_Few:
          name: ${name('Too_Few', 'too few')}
          sourceRef: Enough
          targetRef: Not_Testable
          conditionExpression: smallest_arm < min_per_arm
        Enough_Yes:
          name: enough
          sourceRef: Enough
          targetRef: Tested
    Rules:
      type: studyflow:Parameters
      values:
        alpha: 0.05
        min_per_arm: 4
    Accurate:
      type: ExclusiveGateway
      name: ${name('Accurate', 'Accurate enough?')}
      default: F_Below
    Done:
      type: EndEvent
    Below:
      type: EndEvent
    F0: Start -> Play
    F1: Play -> Analysis
    F2: Analysis -> Accurate
    F_Pass:
      name: "yes"
      sourceRef: Accurate
      targetRef: Done
      conditionExpression: accuracy >= 0.8
    F_Below:
      name: "no"
      sourceRef: Accurate
      targetRef: Below
    F_Failed: Failed -> Discontinued
`;
};

const says = (id: string, copied: string, named: string): string =>
  `${id}: "${id}" copies ${copied}, which it reads, into its name: name it "${named}", so the label shows the value the file declares`;

test('a label that copies a value its element reads is warned of, with the placeholder to write', () => {
  const CASES: [label: string, names: Partial<Record<Named, string>>, expected: string[]][] = [
    ['labels that cite their values', {}, []],
    ['a percentage its conditional event reads', { Failed: '> 20% unanswered' }, [says('Failed', 'max_unanswered (0.2)', '> {max_unanswered:%} unanswered')]],
    ['the value as it is declared', { Failed: '> 0.2 unanswered' }, [says('Failed', 'max_unanswered (0.2)', '> {max_unanswered} unanswered')]],
    ['a percentage that is not the value', { Failed: '> 25% unanswered' }, []],
    // The question a gateway asks is the one the conditions on the flows out of it decide.
    ['a gateway, from the rules wired into its sub-process', { Enough: 'At least 4 per arm?' }, [says('Enough', 'min_per_arm (4)', 'At least {min_per_arm} per arm?')]],
    ['a flow, by its own condition', { Too_Few: 'fewer than 4' }, [says('Too_Few', 'min_per_arm (4)', 'fewer than {min_per_arm}')]],
    ['a digit of a word or of a longer number', { Enough: 'At least 44 per arm, v4?' }, []],
    // An end event reads nothing, so the exit a threshold leads to is not checked against it.
    ['an exit, which reads nothing', { Discontinued: 'Discontinued: more than 20% unanswered' }, []],
    // `accuracy >= 0.8` writes its number itself; no placeholder could cite it.
    ['a number written in the condition', { Accurate: 'At least 0.8?' }, []],
  ];
  for (const [label, names, expected] of CASES) {
    const issues = checkLabels(studyModel(study(names)));
    expect(issues.map((issue) => `${issue.elementId}: ${issue.message}`), label).toEqual(expected);
    issues.forEach((issue) => expect(issue.severity, label).toBe('warning'));
  }
});
