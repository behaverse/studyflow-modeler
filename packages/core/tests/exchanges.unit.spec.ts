import { expect, test } from '@playwright/test';

import { checkExchanges } from '@core/checks/exchanges';
import { studyModel } from '@tests/schemas';

/** Whom a typed choreography task exchanges with: in a study with a pool a program answers, its band, or message flows. */

/** A subject's questionnaire and task, `band` on each, `flows` among the collaboration's message flows. */
const study = (band: string, flows = '', actor = 'actorType: software'): string => `id: exchanges
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Subjects: { name: Subjects, processRef: S }
    Agent: { type: studyflow:Actor, name: Agent, ${actor} }
${flows}
S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Screen:
      type: cognitive:Questionnaire
      name: Screening
      instrument: comprehension-check
${band}
      dataInputAssociations:
        In_Check: { sourceRef: [Check] }
    Flanker:
      type: cognitive:CognitiveTask
      name: Flanker
      platform: jspsych
${band}
      dataInputAssociations:
        In_Protocol: { sourceRef: [Check] }
    Check: { type: DataObjectReference }
    Debrief:
      type: cognitive:Questionnaire
      name: Debrief
      instrument: debrief
    End: { type: EndEvent }
    F1: Start -> Screen
    F2: Screen -> Flanker
    F3: Flanker -> Debrief
    F4: Debrief -> End
`;

const BAND = '      participantRef: [Agent]';
const POOL_FLOWS = `  messageFlows:
    M_Trial: { sourceRef: Subjects, targetRef: Agent }
    M_Response: { sourceRef: Agent, targetRef: Subjects }`;

test('a typed choreography task with something to send names who answers it on its band, or the message flows it exchanges along; one that does neither is refused', () => {
  // The band alone, with no message flow drawn; the pool's flows alone, as before; both.
  expect(checkExchanges(studyModel(study(BAND)))).toEqual([]);
  expect(checkExchanges(studyModel(study('', POOL_FLOWS)))).toEqual([]);
  expect(checkExchanges(studyModel(study(BAND, POOL_FLOWS)))).toEqual([]);
  // Neither: each task is refused, naming the actor to put on its band.
  const refused = checkExchanges(studyModel(study('')));
  expect(refused.map(({ severity, elementId }) => [severity, elementId])).toEqual([['error', 'Screen'], ['error', 'Flanker']]);
  expect(refused[0].message).toMatch(/^"Screening" exchanges with no one: .*\("Agent"\) on its band \(participantRef\)/);
  // The debrief, with nothing to send, asks no one, band or not; and a study whose only actor is a person has no one
  // to message: its tasks are taken at the screen.
  expect(checkExchanges(studyModel(study('', '', 'actorType: human')))).toEqual([]);
});
