import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { checkValues } from '@core/checks/values';
import { freshModdle } from '@tests/schemas';

/** A value its schema's type does not take is refused before any run: one an enumeration does not list, unless its
 * attribute takes free text too, and one that is not the number or the truth value its type is. */

const study = (gateway: string, task: string): string => `id: choices
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    Arm:
      type: ExclusiveGateway
      extensionElements:
        - type: cognitive:RandomGateway
${gateway}
    Play:
      type: Task
      extensionElements:
        - type: cognitive:CognitiveTask
${task}
`;

test('an attribute holds a value of its type', () => {
  const CASES: [string, string, string, string[]][] = [
    ['listed values', '          algorithm: block', '          platform: jsPsych', []],
    ['a misspelled algorithm', '          algorithm: blocks', '          platform: jsPsych', ['"Arm" has algorithm: "blocks", which cognitive:AllocationAlgorithmEnum does not list (simple, block, minimization, alternation)']],
    ['a platform the list lacks, which the attribute takes as text', '          algorithm: simple', '          platform: My own engine', []],
    ['a placeholder, read at run time', '          algorithm: "{how}"', '          platform: jsPsych', []],
    ['a block size in words', '          algorithm: block\n          blockSize: four', '          platform: jsPsych', ['"Arm" has blockSize: "four", which is not a whole number']],
  ];
  for (const [label, gateway, task, says] of CASES) {
    const issues = checkValues(studyflowToDefinitions(study(gateway, task), freshModdle()));
    expect(issues.map((issue) => issue.message), label).toEqual(says);
    issues.forEach((issue) => expect(issue.severity, label).toBe('error'));
  }
});
