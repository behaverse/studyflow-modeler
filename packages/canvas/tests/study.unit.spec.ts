import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { Study, studyInternals, type StudyChange } from '@canvas/study/Study.ts';
import type { Mutator } from '@canvas/study/mutator.ts';
import type { ModdleObject, SceneNode } from '@canvas/study/scene.ts';

import { freshModdle } from '@tests/schemas';

/**
 * The Study: a document, its edits and its undo history, with no DOM. This spec installs no document, so
 * anything here that reached for one would fail.
 */

const YAML = `id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  properties:
    Count:
      name: count
  flowElements:
    Task_1:
      type: Task
      name: Read
      bounds: 200 80 100 80
    Sub_1:
      type: SubProcess
      name: Inner
      flowElements:
        Task_In:
          type: Task
          name: Deep
          bounds: 400 400 100 80
      bounds: 200 250 100 80
      isExpanded: false
`;

/** A pure choreography: its file holds a choreography root, which the canvas edits as a process. */
const CHOREOGRAPHY = `id: Defs_2
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Dyad:
  type: Choreography
  participants:
    Subject:
      name: Subject
    Experimenter:
      name: Experimenter
  messageFlows:
    Consent_Message: Subject -> Experimenter
  flowElements:
    Consent:
      type: ChoreographyTask
      name: Give consent
      participantRef:
        - Subject
        - Experimenter
      initiatingParticipantRef: Subject
      messageFlowRef:
        - Consent_Message
      bounds: 260 175 150 90
`;

const open = (): Study => Study.fromDefinitions(studyflowToDefinitions(YAML, freshModdle()));

/** The study's one writer. An undo swaps in another scene and another mutator, so a spec asks for both each time. */
const mutatorOf = (study: Study): Mutator => studyInternals(study).mutator;
const nodeOf = (study: Study, id: string): SceneNode => studyInternals(study).scene.elementsById.get(id) as SceneNode;
const rename = (study: Study, name: string): unknown => mutatorOf(study).setName(nodeOf(study, 'Task_1'), name);

const rootTypes = (study: Study): string[] => (study.definitions.rootElements as ModdleObject[]).map((root) => root.$type);

test('a study announces each commit once, to each listener in turn, with no DOM', () => {
  const study = open();
  const heard: string[] = [];
  study.on('change', (change) => heard.push(`first: ${change.cause} ${change.changed}`));
  const stop = study.on('change', () => heard.push('second'));

  rename(study, 'Renamed');
  stop();
  rename(study, 'Again');
  rename(study, 'Again');

  expect(heard).toEqual(['first: edit Task_1', 'second', 'first: edit Task_1']);
  expect(study.revision).toBe(2);
});

test('a load replaces the document, read as a file opens, in one change, and the history starts over', async () => {
  const study = open();
  rename(study, 'Renamed');
  const heard: StudyChange[] = [];
  study.on('change', (change) => heard.push(change));

  await study.load(CHOREOGRAPHY);

  expect(heard.map(({ cause, added, removed }) => [cause, added, removed]))
    .toEqual([['load', ['Consent'], ['Task_1', 'Sub_1', 'Task_In']]]);
  expect(rootTypes(study), 'the choreography is edited on a process').toContain('bpmn:Process');
  expect([study.canUndo, study.canRedo]).toEqual([false, false]);
  expect(study.revision, 'the revision carries on').toBe(2);
});

test('a study writes its file as a file holds it, XML or YAML, without touching what it edits, and reopens it the same', async () => {
  const study = await Study.open(CHOREOGRAPHY, { moddle: freshModdle() });

  const xml = await study.toXml();
  const yaml = study.toYaml();

  expect(xml).toContain('<bpmn:choreography id="Dyad"');
  expect(yaml).toContain('Dyad:\n  type: Choreography');
  expect(rootTypes(study), 'still a process to edit').toContain('bpmn:Process');
  expect(await (await Study.open(xml, { moddle: freshModdle() })).toXml()).toBe(xml);
  expect((await Study.open(yaml, { moddle: freshModdle() })).toYaml()).toBe(yaml);
  expect(open().toYaml(), 'a process is written as it is edited').toContain('Process_1:\n  type: Process');
});

// --- undo ------------------------------------------------------------------------------

test('each edit is one undo step: undo walks the file back through every one, and redo forward again', async () => {
  const EDITS: [label: string, edit: (study: Study) => unknown][] = [
    ['a rename', (study) => rename(study, 'Renamed')],
    ['a move', (study) => mutatorOf(study).setNodeBounds(nodeOf(study, 'Task_1'), { x: 420 })],
    ['an expand', (study) => mutatorOf(study).setExpanded(nodeOf(study, 'Sub_1'), true)],
    ['a colour and a font', (study) => mutatorOf(study).batch(() => {
      mutatorOf(study).setColor([nodeOf(study, 'Task_1')], { fill: '#fde68a' });
      mutatorOf(study).setFont([nodeOf(study, 'Task_1')], { bold: true });
    })],
    ['a pool, which turns the root into a collaboration', (study) => mutatorOf(study).addShape({
      type: 'bpmn:Participant', bounds: { x: 100, y: 700, width: 600, height: 250 }, id: 'Pool_1',
    })],
    ['the pool deleted, which makes the process the root again', (study) => mutatorOf(study).deleteElements([nodeOf(study, 'Pool_1')])],
  ];
  const study = open();
  const files = [await study.toXml()];
  for (const [, edit] of EDITS) {
    edit(study);
    files.push(await study.toXml());
  }
  expect(files.slice(1).map((file, step) => file === files[step]), 'every edit changed the file').not.toContain(true);
  expect(files[5], 'the pool made a collaboration').toContain('<bpmn:collaboration');
  expect(files[6], 'and its deletion undid that').not.toContain('<bpmn:collaboration');

  for (let step = EDITS.length - 1; step >= 0; step -= 1) {
    expect(study.undo().ok).toBe(true);
    expect(await study.toXml(), `undo ${EDITS[step][0]}`).toBe(files[step]);
  }
  expect(study.undo().ok, 'back at the file as opened').toBe(false);
  for (let step = 0; step < EDITS.length; step += 1) {
    expect(study.redo().ok).toBe(true);
    expect(await study.toXml(), `redo ${EDITS[step][0]}`).toBe(files[step + 1]);
  }
  expect(study.redo().ok).toBe(false);
});

test('an undo and a redo each put the document back as one change, by id, and are no edits: the redo stays', () => {
  const study = open();
  const heard: string[] = [];
  study.on('change', ({ cause, added, removed }) => {
    heard.push(`${cause} +${added} -${removed} undo:${study.canUndo} redo:${study.canRedo}`);
  });

  mutatorOf(study).addShape({ type: 'bpmn:Task', bounds: { x: 400, y: 80, width: 100, height: 80 }, id: 'Task_2' });
  study.undo();
  study.redo();

  expect(heard).toEqual([
    'edit +Task_2 - undo:true redo:false',
    'undo + -Task_2 undo:false redo:true',
    'redo +Task_2 - undo:true redo:false',
  ]);
  expect(study.revision).toBe(3);
});

test('the history holds what edits changed: nothing for a no-op, no redo past a new edit, and fifty edits back', () => {
  const study = open();
  expect([study.canUndo, study.canRedo], 'a study opens with nothing to undo').toEqual([false, false]);
  mutatorOf(study).touch([nodeOf(study, 'Task_1')]);
  expect(study.canUndo, 'a commit that changed nothing is no step').toBe(false);

  rename(study, 'One');
  study.undo();
  rename(study, 'Two');
  expect(study.canRedo, 'an edit after an undo drops what the undo went back from').toBe(false);

  for (let i = 0; i < 60; i += 1) rename(study, `Name ${i}`);
  let steps = 0;
  while (study.undo().ok) steps += 1;
  expect(steps).toBe(50);
});

// --- writes ----------------------------------------------------------------------------

test('set writes an attribute where its schema keeps it, by any id the document holds; an unknown id is refused', () => {
  const study = open();
  const heard: string[] = [];
  study.on('change', (change) => heard.push(change.changed.join()));

  expect(study.set({ id: 'Task_1', attribute: 'name', value: 'Screen' })).toMatchObject({ ok: true, changed: ['Task_1'] });
  // A property is drawn nowhere, so the root records the write.
  expect(study.set({ id: 'Count', attribute: 'name', value: 'total' })).toMatchObject({ ok: true, changed: ['Process_1'] });
  expect(study.set({ id: 'Nope', attribute: 'name', value: 'x' }))
    .toEqual({ ok: false, reason: "no element 'Nope'", added: [], changed: [], removed: [] });

  expect(heard, 'a refusal writes nothing and says nothing').toEqual(['Task_1', 'Process_1']);
  expect(nodeOf(study, 'Task_1').businessObject.name).toBe('Screen');
  expect((study.definitions.rootElements as any[])[0].properties[0].name).toBe('total');
});

test('an edit is one commit and one undo step, however many moddle writes it makes', () => {
  const study = open();
  const task = nodeOf(study, 'Task_1').businessObject;

  const result = study.edit('Task_1', (writer) => {
    writer.set(task, { name: 'Reads' });
    writer.set(task, { name: 'Reads twice', isForCompensation: true });
  });

  expect(result).toEqual({ ok: true, added: [], changed: ['Task_1'], removed: [] });
  expect(study.revision).toBe(1);
  expect(study.undo().ok).toBe(true);
  expect(study.canUndo, 'one undo takes back every write').toBe(false);
  expect(nodeOf(study, 'Task_1').businessObject.name).toBe('Read');
});

// --- creation ----------------------------------------------------------------------------

test('creation takes plain data: the caller\'s id, a container by its id, a free spot when none is given; a refusal says why', () => {
  const study = open();

  expect(study.add({ type: 'bpmn:Task', id: 'Consent' }), 'no `at`: beside the rightmost shape it joins').toMatchObject({ ok: true, id: 'Consent' });
  expect({ x: nodeOf(study, 'Consent').x, y: nodeOf(study, 'Consent').y }).toEqual({ x: 350, y: 80 });
  const inner = study.add({ type: 'bpmn:Task', into: 'Sub_1', at: { x: 700, y: 440 } });
  expect(nodeOf(study, inner.id!).parent?.id, 'a container named by id takes it, drawn closed or not').toBe('Sub_1');

  expect(study.add({ type: 'bpmn:Task', id: 'Task_1' })).toEqual({ ok: false, reason: "the id 'Task_1' is taken", added: [], changed: [], removed: [] });
  expect(study.add({ type: 'bpmn:Task', into: 'Task_1' })).toMatchObject({ ok: false, reason: "a bpmn:Task cannot go into 'Task_1'" });
  expect(study.connect({ from: 'Consent', to: 'Nope' })).toMatchObject({ ok: false, reason: "no shape 'Nope'" });
  expect(study.revision, 'what was refused wrote nothing').toBe(2);
});

test('a batch is one edit and one undo step, its steps plain data; a refused step takes back those before it and says which', async () => {
  const study = open();

  const made = study.batch({ steps: [
    { tool: 'add', args: { type: 'bpmn:StartEvent', id: 'Start', at: { x: 100, y: 120 } } },
    { tool: 'connect', args: { from: 'Start', to: 'Task_1', id: 'Go' } },
  ] });
  expect(made).toMatchObject({ ok: true, added: ['Start', 'Go'] });
  expect(study.revision).toBe(1);

  const file = await study.toXml();
  expect(study.batch({ steps: [
    { tool: 'add', args: { type: 'bpmn:Task', id: 'Lost' } },
    { tool: 'connect', args: { from: 'Lost', to: 'Nope' } },
  ] })).toEqual({ ok: false, reason: "step 2 (connect): no shape 'Nope'", added: [], changed: [], removed: [] });
  expect(await study.toXml(), 'as if it never ran').toBe(file);
  expect(study.canRedo).toBe(false);

  expect(study.undo().ok).toBe(true);
  expect(nodeOf(study, 'Start'), 'one undo takes back the whole batch').toBeUndefined();
});

test('remove takes what goes with an element; expand and collapse take only what holds contents', () => {
  const study = open();
  expect(study.remove({ ids: ['Nope'] })).toMatchObject({ ok: false, reason: "no element 'Nope'" });
  expect(study.expand({ id: 'Task_1' })).toMatchObject({ ok: false, reason: "'Task_1' holds no contents to show" });
  expect(study.expand({ id: 'Sub_1' })).toMatchObject({ ok: true, changed: expect.arrayContaining(['Sub_1']) });
  expect([...study.remove({ ids: ['Sub_1'] }).removed].sort()).toEqual(['Sub_1', 'Task_In']);
});

// --- reads -------------------------------------------------------------------------------

test('reads are plain data: a record by id, the root, a filtered list; the moddle behind an id stays in-process', () => {
  const study = open();
  study.connect({ from: 'Task_1', to: 'Sub_1', id: 'Flow_1' });

  expect(study.root).toEqual({ id: 'Process_1', kind: 'root', type: 'bpmn:Process' });
  expect(study.get('Task_1')).toEqual({
    id: 'Task_1', kind: 'node', type: 'bpmn:Task', name: 'Read', bounds: { x: 200, y: 80, width: 100, height: 80 }, incoming: [], outgoing: ['Flow_1'],
  });
  expect(study.get('Flow_1')).toMatchObject({ kind: 'edge', type: 'bpmn:SequenceFlow', source: 'Task_1', target: 'Sub_1' });
  expect(study.get('Sub_1')).toMatchObject({ kind: 'node', expanded: false });
  expect(study.get('Nope')).toBeUndefined();

  expect(study.list().map((record) => record.id).sort()).toEqual(['Flow_1', 'Sub_1', 'Task_1', 'Task_In']);
  expect(study.list({ within: 'Sub_1' }).map((record) => record.id)).toEqual(['Task_In']);
  expect(study.list({ kind: 'edge', type: 'bpmn:SequenceFlow' }).map((record) => record.id)).toEqual(['Flow_1']);
  expect(JSON.parse(JSON.stringify(study.list())), 'JSON through and through').toEqual(study.list());
  expect(study.businessObject('Count')?.$type).toBe('bpmn:Property');
});
