import { expect, test } from '@playwright/test';

import { checkEndpoints } from '@core/checks/endpoints';
import { studyModel } from '@tests/schemas';

/** Well-formedness condition 2: edges respect type and scope. */

const study = (elements: string): string => `id: endpoints
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  name: Study
  properties:
    P_Arm:
      name: arm
  flowElements:
    Start:
      type: StartEvent
    Draw:
      type: Task
      name: Draw an arm
      dataOutputAssociations: { Out_Arm: { targetRef: P_Arm } }
    Block:
      type: SubProcess
      name: Block
      properties:
        P_Trial:
          name: trial
      flowElements:
        B0: { type: StartEvent }
        Play:
          type: Task
          name: Play
          dataInputAssociations: { In_Arm: { sourceRef: [P_Arm] } }
          dataOutputAssociations: { Out_Trial: { targetRef: P_Trial } }
        B1: { type: EndEvent }
        BF1: B0 -> Play
        BF2: Play -> B1
    Trials:
      type: DataObjectReference
      name: Trials
    Done:
      type: EndEvent
    F1: Start -> Draw
    F2: Draw -> Block
    F3: Block -> Done
${elements}`;

test('a sequence flow joins two flow nodes of its own container, and a data association a data element in scope', () => {
  // Each issue as `<element id>: <message>`.
  const CASES: [label: string, edit: (text: string) => string, issues: string[]][] = [
    ['a property read from inside the scope that declares it, and written from that scope', (text) => text, []],
    ['a sequence flow into a data element', (text) => text.replace('    F3: Block -> Done\n', '    F3: Block -> Done\n    F4: Draw -> Trials\n'), [
      'F4: sequence flow "F4" has "Trials" as its target, which is no event, activity or gateway: data is drawn with a data association',
    ]],
    ['a sequence flow out of a sub-process', (text) => text.replace('        BF2: Play -> B1\n', '        BF2: Play -> B1\n        BF3: Play -> Done\n'), [
      'BF3: sequence flow "BF3" leaves its "Block" for "Done": a sequence flow stays inside one process or sub-process, and a message flow goes between pools',
    ]],
    ['a data association from a step', (text) => text.replace('sourceRef: [P_Arm]', 'sourceRef: [Draw]'), [
      'In_Arm: "Play" reads "Draw an arm" along a data association, but it is no data element: an order between steps is a sequence flow',
    ]],
    ['a property written outside the scope that declares it', (text) => text.replace('targetRef: P_Arm', 'targetRef: P_Trial'), [
      'Out_Arm: "Draw an arm" writes property "trial", which "Block" declares, outside it: a node reads and writes the properties of the scopes around it',
    ]],
  ];
  for (const [label, edit, issues] of CASES) {
    const found = checkEndpoints(studyModel(edit(study('')))).map((issue) => `${issue.elementId}: ${issue.message}`);
    expect(found, label).toEqual(issues);
  }
});
