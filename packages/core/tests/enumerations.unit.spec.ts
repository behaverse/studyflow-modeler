import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { checkEnumerations } from '@core/checks/enumerations';
import { freshModdle } from '@tests/schemas';

/** A value an enumeration does not list is refused before any run, unless its attribute takes free text too. */

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

test('an attribute an enumeration types holds one of its values', () => {
  const CASES: [string, string, string, string[]][] = [
    ['listed values', '          algorithm: block', '          platform: jsPsych', []],
    ['a misspelled algorithm', '          algorithm: blocks', '          platform: jsPsych', ['"Arm" has algorithm: "blocks", which cognitive:AllocationAlgorithmEnum does not list (simple, block, minimization, alternation)']],
    ['a platform the list lacks, which the attribute takes as text', '          algorithm: simple', '          platform: My own engine', []],
    ['a placeholder, read at run time', '          algorithm: "{how}"', '          platform: jsPsych', []],
  ];
  for (const [label, gateway, task, says] of CASES) {
    const issues = checkEnumerations(studyflowToDefinitions(study(gateway, task), freshModdle()));
    expect(issues.map((issue) => issue.message), label).toEqual(says);
    issues.forEach((issue) => expect(issue.severity, label).toBe('error'));
  }
});
