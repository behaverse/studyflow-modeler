import { expect, test } from '@playwright/test';

import { Study } from '@canvas/index.ts';
import { choreographyBandHeight } from '@core/document/outline.ts';
import { bandsOf, swapChoreographyInitiator } from '@core/model/choreography';
import { isElement } from '@core/model/index';
import { freshMetamodel } from '@tests/schemas';

import { centre, doubleClick, graphicsOf, installDocument, keyEvent, labelEditingOf, loadYaml, node, svgOf } from './canvasHarness';

/**
 * Who takes a choreography task's bands, said with the study's `bands` tool, as the inspector says it too, and on the
 * canvas, where a double click on a band edits it.
 */

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

test('a double click edits the band under it, or the name between them, one undo step each, and Enter gives the keys back', async () => {
  const { canvas } = loadYaml(`id: Defs\n${HEAD}Proc:\n  type: Process\n`);
  // In the page, so focus can move.
  installDocument().body.append(canvas.getContainer());
  const id = canvas.study.add({ type: 'bpmn:ChoreographyTask', at: { x: 300, y: 200 } }).id!;
  const task = node(canvas, id);
  const band = choreographyBandHeight(task.height);
  const drawn = () => graphicsOf(canvas, id)!.textContent;
  /** Double click at `y` on the task, type `text` and press Enter: what the editor opened on. */
  const edit = (y: number, text: string): string | undefined => {
    doubleClick(canvas, { x: centre(task).x, y });
    const initial = labelEditingOf(canvas).getSession()?.initial;
    labelEditingOf(canvas).setValue(text);
    canvas.getContainer().querySelector('.sf-label-editor')!.dispatchEvent(keyEvent('keydown', { key: 'Enter' }));
    return initial;
  };

  expect(edit(task.y + band / 2, 'Subject'), 'the top band').toBe('Participant A');
  expect(edit(task.y + task.height - band / 2, 'Experimenter'), 'the bottom band').toBe('Participant B');
  expect(edit(centre(task).y, 'Give consent'), 'the name').toBe('');
  expect(labelEditingOf(canvas).isActive()).toBe(false);
  expect(installDocument().activeElement).toBe(svgOf(canvas));
  expect(drawn()).toContain('Subject');
  expect(drawn()).toContain('Experimenter');
  expect(drawn()).toContain('Give consent');

  canvas.study.undo();
  expect(drawn()).not.toContain('Give consent');
  expect(drawn()).toContain('Subject');
  canvas.getContainer().remove();
});
