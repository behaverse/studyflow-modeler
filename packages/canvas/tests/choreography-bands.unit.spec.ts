import { expect, test } from '@playwright/test';

import { Study, type ElementRecord } from '@canvas/index.ts';
import { choreographyBandHeight } from '@core/document/outline.ts';
import { bandsOf, swapChoreographyInitiator } from '@core/model/choreography';
import { isElement } from '@core/model/index';
import { freshMetamodel } from '@tests/schemas';

import { centre, doubleClick, graphicsOf, installDocument, keyEvent, labelEditingOf, loadYaml, node, sceneOf, svgOf } from './canvasHarness';

/**
 * Who takes a choreography task's bands, said with the study's `bands` tool, as the inspector says it too, and on the
 * canvas, where a double click on a band edits it. Every actor a band names is drawn (`study/actors.ts`): as a
 * collapsed pool, BPMN's black box, under the rest, the study's own flow in a pool of the collaboration first.
 */

const HEAD = 'definitions:\n  targetNamespace: http://bpmn.io/schema/bpmn\n';

/** The pools a study draws, by name. */
const poolsOf = (study: Study): Map<string, ElementRecord> => new Map(study.list({ type: 'bpmn:Participant' }).map((pool) => [pool.name ?? pool.id, pool]));

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
  // The actor named anew is drawn, a closed pool like the one the file declared; the placeholder the band gave up is not.
  expect([...poolsOf(study).keys()].sort()).toEqual(['Experimenter', 'Lab', 'Participant_0001']);
  expect(poolsOf(study).get('Experimenter')).toMatchObject({ expanded: false });

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

test('a name typed on a band draws the actor as a collapsed pool under the rest, the study\'s flow in a pool of the collaboration; expanded, the pool holds a flow; the last band dropped takes the pool away', async () => {
  const study = await Study.open(`id: Defs
${HEAD}Proc:
  type: Process
  flowElements:
    Play:
      type: ChoreographyTask
      extensionElements:
        - type: cognitive:CognitiveTask
      bounds: 200 100 100 80
`, { metamodel: freshMetamodel() });

  expect(study.call('bands', { id: 'Play', bottom: { name: 'Subject' } })).toMatchObject({ ok: true });
  // The study keeps its id on the collaboration, its flow in a pool round what was drawn, a pool's size at least.
  expect(study.root).toMatchObject({ id: 'Proc', type: 'bpmn:Collaboration' });
  const pools = poolsOf(study);
  const session = [...pools.values()].find((pool) => pool.expanded !== false)!;
  expect(session).toMatchObject({ bounds: { x: 150, y: 15, width: 600, height: 250 }, expanded: true });
  expect(study.get('Play')).toMatchObject({ parent: session.id });
  // The actor's pool: closed, a pool's gap under the session, as wide as it.
  const subject = pools.get('Subject')!;
  expect(subject).toMatchObject({ kind: 'node', type: 'bpmn:Participant', expanded: false, bounds: { x: 150, y: 305, width: 600, height: 60 } });
  expect(study.element(subject.id)).not.toHaveProperty('processRef');
  expect(study.toYaml()).toContain(`${subject.id}: {bounds: 150 305 600 60, expanded: false}`);
  expect(study.canUndo, 'the actor and its pool are one edit').toBe(true);

  // A pool drawn closed is a black box: a step goes in only once it is drawn open, which gives it a flow.
  expect(study.add({ type: 'bpmn:Task', into: subject.id, id: 'Think' })).toMatchObject({ ok: false, reason: `a bpmn:Task cannot go into '${subject.id}'` });
  expect(study.expand({ id: subject.id })).toMatchObject({ ok: true });
  expect(study.get(subject.id)).toMatchObject({ expanded: true, bounds: { x: 150, y: 305, width: 600, height: 250 } });
  expect(study.element(subject.id)).toHaveProperty('processRef');
  expect(study.add({ type: 'bpmn:Task', into: subject.id, id: 'Think' })).toMatchObject({ ok: true });
  expect(study.collapse({ id: subject.id })).toMatchObject({ ok: false, reason: `'${subject.id}' holds a flow: a pool with steps stays open` });
  study.remove({ ids: ['Think'] });
  expect(study.collapse({ id: subject.id })).toMatchObject({ ok: true });
  expect(study.get(subject.id)).toMatchObject({ expanded: false, bounds: { x: 150, y: 305, width: 600, height: 60 } });
  expect(study.element(subject.id), 'an empty process goes with the pool\'s flow').not.toHaveProperty('processRef');
  expect(study.model.study.roots.filter((root) => study.model.host(root) === 'bpmn:Process')).toHaveLength(1);

  // Another name on the same band is another actor, drawn where the one it replaces stood, which goes.
  expect(study.call('bands', { id: 'Play', bottom: { name: 'Model' } })).toMatchObject({ ok: true });
  expect(study.get(subject.id)).toBeUndefined();
  expect(study.element(subject.id)).toBeUndefined();
  expect(poolsOf(study).get('Model')).toMatchObject({ expanded: false, bounds: { x: 150, y: 305, width: 600, height: 60 } });
  study.undo();
  expect(study.get(subject.id)).toMatchObject({ expanded: false });
  expect(poolsOf(study).has('Model')).toBe(false);

  // The band cleared, the actor no band names goes, pool and all; the study stays in its pool.
  expect(study.call('bands', { id: 'Play', bottom: null })).toMatchObject({ ok: true, removed: [subject.id] });
  expect(study.element(subject.id)).toBeUndefined();
  expect(study.root).toMatchObject({ id: 'Proc', type: 'bpmn:Collaboration' });
  expect([...poolsOf(study).keys()]).toEqual([session.id]);
});

test('clearing a band keeps a pool with a flow, and a black box a message flow reaches; one only the band named goes', async () => {
  const study = await Study.open(`id: Defs
${HEAD}C:
  type: Collaboration
  participants:
    Session: { name: Session, processRef: Proc, bounds: 100 50 600 200 }
    Model: { name: Model, bounds: 100 300 600 60, isExpanded: false }
    Subject: { name: Subject }
  messageFlows:
    Ask: { sourceRef: Play, targetRef: Model, waypoint: 250,160 250,300 }
Proc:
  type: Process
  flowElements:
    Play:
      type: ChoreographyTask
      extensionElements:
        - type: cognitive:CognitiveTask
      bounds: 200 100 100 80
`, { metamodel: freshMetamodel() });
  const takenBy = (id: string) => study.revise('Play', (task) => { task.participantRef = [id]; });
  const clearBottom = () => study.call('bands', { id: 'Play', bottom: null });
  const participants = () => (study.element('C')!.participants as unknown[]).filter(isElement).map((participant) => participant.id);

  // The actor the file names on no band and draws nowhere is drawn as it is read, under the rest.
  expect(study.get('Subject')).toMatchObject({ type: 'bpmn:Participant', expanded: false, bounds: { x: 100, y: 400, width: 600, height: 60 } });

  takenBy('Session');
  clearBottom();
  takenBy('Model');
  clearBottom();
  expect(participants()).toEqual(['Session', 'Model', 'Subject']);

  takenBy('Subject');
  expect(clearBottom()).toMatchObject({ ok: true, removed: ['Subject'] });
  expect(participants()).toEqual(['Session', 'Model']);
  expect(study.get('Subject')).toBeUndefined();
});

test('a file whose band-only actor has no shape is drawn one as it is read, and the flows that reach it are routed', async () => {
  const study = await Study.open(`id: Defs
${HEAD}C:
  type: Collaboration
  participants:
    Subject: { name: Subject }
  messageFlows:
    Ask: { sourceRef: Play, targetRef: Subject }
Proc:
  type: Process
  flowElements:
    Play:
      type: ChoreographyTask
      participantRef:
        - Subject
      extensionElements:
        - type: cognitive:CognitiveTask
      bounds: 200 100 100 80
`, { metamodel: freshMetamodel() });

  expect(study.root).toMatchObject({ id: 'Proc', type: 'bpmn:Collaboration' });
  expect(study.get('Subject')).toMatchObject({ type: 'bpmn:Participant', expanded: false, bounds: { x: 150, y: 305, width: 600, height: 60 }, incoming: ['Ask'] });
  expect(study.get('Ask')).toMatchObject({ kind: 'edge', type: 'bpmn:MessageFlow', source: 'Play', target: 'Subject' });
  expect(study.get('Play')?.parent).toBe([...poolsOf(study).values()].find((pool) => pool.expanded !== false)!.id);
  expect([study.canUndo, study.canRedo], 'the drawing is part of the study as read').toEqual([false, false]);
  // Read again, the file holds the drawing: nothing is drafted twice.
  const saved = study.toYaml();
  expect((await Study.open(saved, { metamodel: freshMetamodel() })).toYaml()).toBe(saved);
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

  expect(edit(task.y + band / 2, 'Subject'), 'the top band').toBe('Actor A');
  // The two actors the band minted are drawn, closed, under the flow, which a pool now holds.
  const pools = [...sceneOf(canvas).elementsById.values()].filter((element) => element.kind === 'node' && element.type === 'bpmn:Participant');
  expect(pools.map((pool) => [pool.element.name, pool.kind === 'node' && pool.isExpanded])).toEqual([[undefined, undefined], ['Subject', false], ['Actor B', false]]);
  expect(task.parent?.type).toBe('bpmn:Participant');
  expect(edit(task.y + task.height - band / 2, 'Experimenter'), 'the bottom band').toBe('Actor B');
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
