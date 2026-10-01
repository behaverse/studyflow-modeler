import { expect, test } from '@playwright/test';

import { Study } from '@canvas/index.ts';
import { bandsOf, ensureParticipantsIn } from '@core/model/choreography';
import { isElement } from '@core/model/index';
import { selectBandParticipant, swapChoreographyInitiator } from '@modeler/shape/choreographyParticipants';
import { freshModdle } from './schemas';

/** Flipping a choreography task's `initiatingParticipantRef`, and clearing a band. */

const HEAD = 'definitions:\n  targetNamespace: http://bpmn.io/schema/bpmn\n';

test('swap flips the initiating participant', async () => {
  const study = await Study.open(`id: Defs\n${HEAD}Proc:\n  type: Process\n  flowElements:\n    Consent: { type: ChoreographyTask, name: Give consent }\n`, { moddle: freshModdle() });
  const task = () => study.element('Consent')!;
  study.revise('Consent', (consent, model, ids) => { ensureParticipantsIn(model, consent, ids); });
  const [top, bottom] = task().participantRef as string[];
  expect(task().initiatingParticipantRef).toBe(top);
  const swap = () => study.revise('Consent', (consent, model, ids) => swapChoreographyInitiator(model, consent, ids));

  swap();
  expect(task().initiatingParticipantRef).toBe(bottom);
  expect(bandsOf(study.model, task()).initiator).toBe('bottom');

  swap();
  expect(task().initiatingParticipantRef).toBe(top);
});

test('clearing a band keeps a pool the canvas draws, even one with no process; an actor only bands named goes', async () => {
  const study = await Study.open(`id: Defs
${HEAD}C:
  type: Collaboration
  participants:
    Model: { name: Model }
    Subject: { name: Subject }
Proc:
  type: Process
  flowElements:
    Play:
      type: ChoreographyTask
      extensionElements:
        - type: cognitive:CognitiveTask
`, { moddle: freshModdle() });
  // The model's pool is drawn, with no process of its own; the actor only takes bands.
  const drawn = { get: (id: string) => (id === 'Model' ? {} : undefined) };
  const takenBy = (id: string) => study.revise('Play', (task) => { task.participantRef = [id]; });
  const clearBottom = () => study.revise('Play', (task, model, ids) => selectBandParticipant(model, task, ids, drawn, 'bottom', null));
  const participants = () => (study.element('C')!.participants as unknown[]).filter(isElement).map((participant) => participant.id);

  takenBy('Model');
  clearBottom();
  expect(participants()).toEqual(['Model', 'Subject']);

  takenBy('Subject');
  clearBottom();
  expect(participants()).toEqual(['Model']);
});
