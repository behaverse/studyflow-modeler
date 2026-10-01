import { expect, test } from '@playwright/test';

import { studyModelOf, studyflowToDefinitions } from '@core/document';
import { explore, planOf } from '@core/engine';
import { freshModdle } from '@tests/schemas';

/** Soundness by exploring every way a study can go: each decision a free choice, every run walked dry. */

const plan = (study: string) => planOf(studyModelOf(studyflowToDefinitions(`id: s\ndefinitions:\n  targetNamespace: http://bpmn.io/schema/bpmn\n${study}`, freshModdle())));

/** Left decides whether to tell Right; Right always waits to be told, and once told, Left also says goodbye at a
 * boundary event Right has left by then. */
const TOLD = `C:
  type: Collaboration
  participants:
    Left: { name: Left, processRef: L }
    Right: { name: Right, processRef: R }
  messageFlows:
    M_Tell: { sourceRef: L_Tell, targetRef: R_Hear }
    M_Bye: { sourceRef: L_Bye, targetRef: R_Bye }
L:
  type: Process
  flowElements:
    L0: { type: StartEvent }
    Gate:
      type: ExclusiveGateway
      default: L_Skip
    L_Tell: { type: IntermediateThrowEvent }
    L_Bye: { type: IntermediateThrowEvent }
    L9: { type: EndEvent }
    L_Skip: Gate -> L9
    LF1: L0 -> Gate
    L_Told:
      sourceRef: Gate
      targetRef: L_Tell
      conditionExpression: ready
    LF3: L_Tell -> L_Bye
    LF4: L_Bye -> L9
R:
  type: Process
  flowElements:
    R0: { type: StartEvent }
    R_Hear: { type: ReceiveTask }
    R_Bye: { type: BoundaryEvent, attachedToRef: R_Hear, eventDefinitions: { R_ByeMessage: { type: MessageEventDefinition } } }
    R9: { type: EndEvent }
    RF1: R0 -> R_Hear
    RF2: R_Hear -> R9
    RF3: R_Bye -> R9
`;

test('every way a study can go is walked, and a wait no message will end, or a message nothing takes, is found with its path', async () => {
  const found = await explore(plan(TOLD));
  expect(found.complete).toBe(true);
  expect(found.runs).toBe(2);
  // The gateway's condition reads what no step binds: each of its flows is a way the study can go.
  expect(found.findings).toEqual([
    { message: 'R_Hear waits along M_Tell, and nothing is left to send', path: ['Gate → L_Skip'] },
    { message: 'a message along M_Bye is sent and nothing takes it', path: ['Gate → L_Told'] },
  ]);
});
