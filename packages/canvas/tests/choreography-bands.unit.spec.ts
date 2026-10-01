import { expect, test } from '@playwright/test';

import { Study } from '@canvas/index.ts';
import { bandsOf, swapChoreographyInitiator } from '@core/model/choreography';
import { isElement } from '@core/model/index';
import { freshMetamodel } from '@tests/schemas';

/** Who takes a choreography task's bands, said with the study's `bands` tool, as the inspector says it too. */

const HEAD = 'definitions:\n  targetNamespace: http://bpmn.io/schema/bpmn\n';

test('bands names, picks and starts a task\'s two participants, minting what it lacks, and refuses what does not exist', async () => {
  const study = await Study.open(`id: Defs
${HEAD}C:
  type: Collaboration
  participants:
    Lab: { name: Lab }
Proc:
  type: Process
  flowElements:
    Consent: { type: ChoreographyTask, name: Give consent }
    Plain: { type: Task }
`, { metamodel: freshMetamodel() });
  const task = () => study.element('Consent')!;
  const names = () => (task().participantRef as string[]).map((id) => study.element(id)?.name);

  expect(study.call('bands', { id: 'Consent', top: { name: 'Experimenter' }, bottom: { participant: 'Lab' }, initiator: 'bottom' })).toMatchObject({ ok: true });
  expect(names()).toEqual(['Experimenter', 'Lab']);
  expect(bandsOf(study.model, task())).toEqual({ top: 'Experimenter', bottom: 'Lab', initiator: 'bottom' });

  // The actor on a band is typed as a kind the schemas declare.
  expect(study.call('bands', { id: 'Consent', kinds: { bottom: 'llm' } })).toMatchObject({ ok: true });
  expect(study.element('Lab')).toMatchObject({ extensionElements: [{ type: 'studyflow:Actor', actorType: 'llm' }] });

  const swap = () => study.revise('Consent', (consent, model, ids) => swapChoreographyInitiator(model, consent, ids));
  swap();
  expect(bandsOf(study.model, task()).initiator).toBe('top');

  const REFUSALS: [args: Record<string, unknown>, reason: string][] = [
    [{ id: 'Consent', top: { participant: 'Nobody' } }, "no participant 'Nobody'"],
    [{ id: 'Consent', kinds: { top: 'wizard' } }, "no participant kind 'wizard'"],
    [{ id: 'Plain', initiator: 'top' }, "'Plain' is no choreography task: it has no bands"],
  ];
  for (const [args, reason] of REFUSALS) expect(study.call('bands', args), JSON.stringify(args)).toMatchObject({ ok: false, reason: expect.stringContaining(reason) });
});

test('clearing a band keeps a pool the canvas draws, even one with no process; an actor only bands named goes', async () => {
  const study = await Study.open(`id: Defs
${HEAD}C:
  type: Collaboration
  participants:
    Model: { name: Model, bounds: 0 0 600 100 }
    Subject: { name: Subject }
Proc:
  type: Process
  flowElements:
    Play:
      type: ChoreographyTask
      extensionElements:
        - type: cognitive:CognitiveTask
`, { metamodel: freshMetamodel() });
  // The model's pool is drawn, with no process of its own; the actor only takes bands.
  const takenBy = (id: string) => study.revise('Play', (task) => { task.participantRef = [id]; });
  const clearBottom = () => study.call('bands', { id: 'Play', bottom: null });
  const participants = () => (study.element('C')!.participants as unknown[]).filter(isElement).map((participant) => participant.id);

  takenBy('Model');
  clearBottom();
  expect(participants()).toEqual(['Model', 'Subject']);

  takenBy('Subject');
  clearBottom();
  expect(participants()).toEqual(['Model']);
});
