import { expect, test } from '@playwright/test';

import { Study, studyInternals, studyMutator, type StudyChange, type StudyResult } from '@canvas/study/Study.ts';
import type { StudyTool } from '@canvas/study/tools.ts';
import type { Mutator } from '@canvas/study/mutator.ts';
import type { Bounds, SceneNode } from '@canvas/study/scene.ts';

import { freshMetamodel, studyModel } from '@tests/schemas';

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

/** Another tool's choreography: a choreography root, which a study reads as a process. */
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

const open = (): Study => Study.of(studyModel(YAML));

/** The study's one writer. An undo swaps in another scene and another mutator, so a spec asks for both each time. */
const mutatorOf = (study: Study): Mutator => studyMutator(study);
const nodeOf = (study: Study, id: string): SceneNode => studyInternals(study).scene.elementsById.get(id) as SceneNode;
const rename = (study: Study, name: string): unknown => mutatorOf(study).setName(nodeOf(study, 'Task_1'), name);

const rootTypes = (study: Study): string[] => study.model.study.roots.map((root) => study.model.host(root));

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
  expect(rootTypes(study), 'the choreography is read as a process').toContain('bpmn:Process');
  expect([study.canUndo, study.canRedo]).toEqual([false, false]);
  expect(study.revision, 'the revision carries on').toBe(2);
});

test('a study writes its file as a file holds it, XML or YAML, without touching what it edits, and reopens it the same', async () => {
  const study = await Study.open(CHOREOGRAPHY, { metamodel: freshMetamodel() });

  const xml = await study.toXml();
  const yaml = study.toYaml();

  // A choreography is read as the process a study is, and written as one: its exchange is a task in the XML.
  expect(xml).toContain('<bpmn:process id="Dyad"');
  expect(xml).toContain('<bpmn:task id="Consent" name="Give consent" studyflow:exchange="true"');
  expect(yaml).toContain('Dyad:\n  type: Process');
  expect(rootTypes(study)).toContain('bpmn:Process');
  expect(await (await Study.open(xml, { metamodel: freshMetamodel() })).toXml()).toBe(xml);
  expect((await Study.open(yaml, { metamodel: freshMetamodel() })).toYaml()).toBe(yaml);
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

test('set writes an attribute where its schema keeps it, by any id the document holds, and an empty text removes it; an unknown id is refused', () => {
  const study = open();
  const heard: string[] = [];
  study.on('change', (change) => heard.push(change.changed.join()));

  expect(study.set({ id: 'Task_1', attribute: 'name', value: 'Screen' })).toMatchObject({ ok: true, changed: ['Task_1'] });
  // A property is drawn nowhere, so the root records the write.
  expect(study.set({ id: 'Count', attribute: 'name', value: 'total' })).toMatchObject({ ok: true, changed: ['Process_1'] });
  expect(study.set({ id: 'Nope', attribute: 'name', value: 'x' }))
    .toEqual({ ok: false, reason: "no element 'Nope'", added: [], changed: [], removed: [] });

  expect(heard, 'a refusal writes nothing and says nothing').toEqual(['Task_1', 'Process_1']);
  expect(study.element('Task_1')!.name).toBe('Screen');
  expect(study.element('Count')!.name).toBe('total');

  // No text, no attribute: a field emptied removes what it held.
  expect(study.set({ id: 'Task_1', attribute: 'name', value: '' }).ok).toBe(true);
  expect(study.element('Task_1')).not.toHaveProperty('name');
});

test('set writes a list of text into the schema entry that keeps it, and an empty list clears it', () => {
  const study = Study.of(studyModel(`id: Defs_4
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Collab_1:
  type: Collaboration
  extensionElements:
    - type: studyflow:Study
  participants:
    Pool_1:
      processRef: Process_1
Process_1:
  type: Process
`));
  const authors = () => study.model.attribute(study.element('Collab_1')!, 'authors');

  expect(study.set({ id: 'Collab_1', attribute: 'studyflow:authors', value: ['Ada', ''] }).ok).toBe(true);
  expect(authors()).toEqual(['Ada', '']);
  expect(study.set({ id: 'Collab_1', attribute: 'studyflow:authors', value: [] }).ok).toBe(true);
  expect(authors()).toBeUndefined();
});

test('set takes a structured attribute as the file spells it: a loop, a timer, the data a step reads, a reference; each one undo step', () => {
  const study = open();
  const task = (): any => study.element('Task_1');

  // A loop marker, polymorphic, so it names its type as the file does.
  expect(study.set({ id: 'Task_1', attribute: 'loopCharacteristics', value: { type: 'StandardLoopCharacteristics', loopMaximum: 3, loopCondition: 'count < 3' } }))
    .toMatchObject({ ok: true, changed: ['Task_1'] });
  expect(task().loopCharacteristics).toMatchObject({ type: 'bpmn:StandardLoopCharacteristics', loopMaximum: 3, loopCondition: 'count < 3' });

  // What a step reads, by the id of what it reads: a reference the document resolves.
  expect(study.set({ id: 'Task_1', attribute: 'dataInputAssociations', value: { In_Count: { sourceRef: ['Count'] } } }).ok).toBe(true);
  expect(task().dataInputAssociations[0].sourceRef).toEqual(['Count']);

  // A name the document does not hold is refused, and nothing is written.
  const before = study.toYaml();
  expect(study.set({ id: 'Task_1', attribute: 'dataInputAssociations', value: { In_Gone: { sourceRef: ['Gone'] } } }))
    .toMatchObject({ ok: false, reason: expect.stringContaining("names 'Gone', which no element is") });
  expect(study.set({ id: 'Task_1', attribute: 'loopCharacteristics', value: { type: 'NoSuchLoop' } }).ok).toBe(false);
  expect(study.toYaml()).toBe(before);

  // The file holds what was set, and each set undoes on its own; null clears.
  expect(before).toContain('loopMaximum: 3');
  expect(study.set({ id: 'Task_1', attribute: 'loopCharacteristics', value: null }).ok).toBe(true);
  expect(task().loopCharacteristics).toBeUndefined();
  study.undo();
  expect(task().loopCharacteristics.loopMaximum).toBe(3);
  study.undo();
  expect(task().dataInputAssociations ?? []).toHaveLength(0);
  expect(task().loopCharacteristics.loopMaximum).toBe(3);
});

test('an AI finds what it may write before it writes: describe says what a type takes, can tries any write on a copy, list finds by name', () => {
  const study = open();
  // What a task takes: its schema's attributes, and BPMN's own, the polymorphic ones with the types they may hold.
  const described = study.call('describe', { type: 'bpmn:Task' }) as any;
  expect(described.attributes.map((attribute: any) => attribute.name)).toContain('name');
  const structure = new Map<string, any>(described.structure.map((entry: any) => [entry.name, entry]));
  expect(structure.get('loopCharacteristics')).toMatchObject({ type: 'bpmn:LoopCharacteristics', of: ['MultiInstanceLoopCharacteristics', 'StandardLoopCharacteristics'] });
  expect(structure.get('default')).toMatchObject({ reference: true });
  expect(structure.get('dataInputAssociations')).toMatchObject({ many: true });
  expect(study.call('describe', { type: 'bpmn:NoSuchType' })).toMatchObject({ ok: false, reason: "no type 'bpmn:NoSuchType'" });

  // Any write is asked without writing: the document is as it was, and the reason is the write's own.
  const before = study.toYaml();
  expect(study.call('can', { tool: 'set', args: { id: 'Task_1', attribute: 'loopCharacteristics', value: { type: 'StandardLoopCharacteristics' } } })).toEqual({ ok: true });
  expect(study.call('can', { tool: 'set', args: { id: 'Task_1', attribute: 'wingspan', value: 3 } }))
    .toEqual({ ok: false, reason: "no schema gives 'Task_1' an attribute 'wingspan'" });
  expect(study.call('can', { tool: 'remove', args: { ids: ['Task_1'] } })).toEqual({ ok: true });
  expect([study.toYaml(), study.canUndo]).toEqual([before, false]);

  // A list is what elements are, not where they are drawn, unless asked; a name finds one in any case.
  const found = (study.call('list', { name: 'rea' }) as any).elements;
  expect(found).toEqual([{ id: 'Task_1', kind: 'node', type: 'bpmn:Task', name: 'Read', incoming: [], outgoing: [], default: null }]);
  expect((study.call('list', { name: 'rea', geometry: true }) as any).elements[0].bounds).toEqual({ x: 200, y: 80, width: 100, height: 80 });
});

test('item says what a message flow carries and what a property holds, keeping one definition of each', async () => {
  const study = Study.of(studyModel(`id: Defs_3
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Lab: { name: Lab, processRef: P }
    Model: { name: Model }
  messageFlows:
    M_Ask: Ask -> Model
    M_Again: Ask -> Model
P:
  type: Process
  properties:
    Seen: { name: seen }
  flowElements:
    Ask: { type: Task, bounds: 200 80 100 80 }
`));
  const roots = (): string[] => study.model.study.roots.map((root) => `${root.type} ${root.id}`);
  expect(study.call('item', { id: 'M_Ask', structure: 'behaverse:Trial' }).ok).toBe(true);
  expect(study.call('item', { id: 'M_Again', structure: 'behaverse:Trial' }).ok).toBe(true);
  expect(study.call('item', { id: 'Seen', structure: 'behaverse:Trial' }).ok).toBe(true);
  // One item definition, one message, shared by both flows and the property.
  expect(roots().filter((root) => /ItemDefinition|Message /.test(root))).toEqual(['bpmn:ItemDefinition ItemDefinition_behaverse_Trial', 'bpmn:Message Message_behaverse_Trial']);
  expect(study.toYaml()).toContain('messageRef: Message_behaverse_Trial');
  // The message goes with its last flow; what holds no item is refused.
  study.call('item', { id: 'M_Ask', structure: '' });
  study.call('item', { id: 'M_Again', structure: '' });
  expect(roots().some((root) => root.startsWith('bpmn:Message '))).toBe(false);
  expect(study.call('item', { id: 'Ask', structure: 'x' })).toMatchObject({ ok: false, reason: expect.stringContaining('holds no item') });
});

test('a revision is one commit and one undo step, however many writes it makes', () => {
  const study = open();

  const result = study.revise('Task_1', (task) => {
    task.name = 'Reads';
    Object.assign(task, { name: 'Reads twice', isForCompensation: true });
  });

  expect(result).toEqual({ ok: true, added: [], changed: ['Task_1'], removed: [] });
  expect(study.revision).toBe(1);
  expect(study.undo().ok).toBe(true);
  expect(study.canUndo, 'one undo takes back every write').toBe(false);
  expect(study.element('Task_1')!.name).toBe('Read');
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

test('a flow drawn between two pools is a message flow the collaboration holds', () => {
  const POOLS = `id: Defs_M
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Lab: { name: Lab, processRef: P, bounds: 100 50 600 200 }
    Model: { name: Model, bounds: 100 300 600 100 }
P:
  type: Process
  flowElements:
    Ask: { type: Task, bounds: 200 100 100 80 }
`;
  // A drawing that names the process makes it the root, and draws the pools all the same.
  const CASES: [label: string, file: string, root: string][] = [
    ['the collaboration drawn', POOLS, 'bpmn:Collaboration'],
    ['the process drawn', `${POOLS}diagram:\n  - plane: { bpmnElement: P }\n`, 'bpmn:Process'],
  ];
  for (const [label, file, root] of CASES) {
    const study = Study.of(studyModel(file));
    expect(study.root.type, label).toBe(root);
    expect(study.connect({ from: 'Ask', to: 'Model', id: 'Ask_Model' }), label).toMatchObject({ ok: true });
    const flow = study.model.get('Ask_Model')!;
    expect(flow.type, label).toBe('bpmn:MessageFlow');
    expect(study.model.holderOf(flow), label).toMatchObject({ parent: { id: 'C' }, key: 'messageFlows' });
  }
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
  const heard: string[] = [];
  const stop = study.on('change', ({ cause }) => heard.push(cause));
  expect(study.batch({ steps: [
    { tool: 'add', args: { type: 'bpmn:Task', id: 'Lost' } },
    { tool: 'connect', args: { from: 'Lost', to: 'Nope' } },
  ] })).toEqual({ ok: false, reason: "step 2 (connect): no shape 'Nope'", added: [], changed: [], removed: [] });
  expect(await study.toXml(), 'as if it never ran').toBe(file);
  expect(heard, 'a refused batch is heard once, going back: no edit drawn, then undrawn').toEqual(['undo']);
  stop();
  expect(study.canRedo).toBe(false);

  expect(study.undo().ok).toBe(true);
  expect(nodeOf(study, 'Start'), 'one undo takes back the whole batch').toBeUndefined();
});

test('can answers what a verb would do, by the same rules, without writing; what it leaves out, it asks about any', () => {
  const withEnd = (): Study => {
    const made = open();
    made.add({ type: 'bpmn:EndEvent', id: 'End' });
    return made;
  };
  const study = withEnd();
  const revision = study.revision;
  // [tool, what it is asked, the answer]: each question naming all the verb needs is asked of the verb too.
  const CASES: [tool: 'append' | 'connect' | 'replace', args: Record<string, unknown>, ok: boolean][] = [
    ['append', { from: 'Task_1' }, true],
    ['append', { from: 'End' }, false],
    ['append', { from: 'Task_1', type: 'bpmn:EndEvent' }, true],
    ['append', { from: 'End', type: 'bpmn:TextAnnotation' }, true],
    ['append', { from: 'Nope', type: 'bpmn:Task' }, false],
    ['connect', { from: 'Task_1' }, true],
    ['connect', { from: 'Task_1', to: 'Sub_1' }, true],
    ['connect', { from: 'Task_1', to: 'Nope' }, false],
    ['replace', { id: 'Task_1' }, true],
    ['replace', { id: 'Task_1', type: 'bpmn:UserTask' }, true],
    ['replace', { id: 'Task_1', type: 'bpmn:Task', extension: 'studyflow:Actor' }, false],
  ];
  for (const [tool, args, ok] of CASES) {
    expect(study.can(tool, args).ok, `${tool} ${JSON.stringify(args)}`).toBe(ok);
    const complete = tool === 'append' ? 'type' in args : tool === 'connect' ? 'to' in args : 'type' in args;
    if (complete) expect((withEnd() as any)[tool](args).ok, `the verb: ${tool} ${JSON.stringify(args)}`).toBe(ok);
  }
  expect(study.can('append', { from: 'End' }).reason).toBe("nothing follows 'End'");
  expect(study.can('replace', { id: 'Task_1', type: 7 }).reason).toBe("'type' should be a string");
  expect(study.revision, 'asking writes nothing').toBe(revision);
});

test('move takes shapes by a delta with their flows, and into a container the rules allow; reconnect moves a flow\'s ends', () => {
  const study = open();
  study.add({ type: 'bpmn:Task', id: 'Two', at: { x: 600, y: 120 } });
  study.add({ type: 'bpmn:Task', id: 'Three', at: { x: 600, y: 320 } });
  study.connect({ from: 'Task_1', to: 'Two', id: 'Flow_1' });
  const at = study.get('Task_1')!.bounds!;

  expect(study.move({ ids: ['Task_1'], by: { x: 20, y: 30 } })).toMatchObject({ ok: true, changed: expect.arrayContaining(['Task_1', 'Flow_1']) });
  expect(study.get('Task_1')!.bounds).toMatchObject({ x: at.x + 20, y: at.y + 30 });
  expect(study.move({ ids: ['Flow_1'], by: { x: 1, y: 1 } }).reason).toContain('moves with its ends');
  expect(study.move({ ids: ['Two'], by: { x: 0, y: 0 }, into: 'Sub_1' }), 'a sequence flow would cross into it').toMatchObject({ ok: false });
  expect(study.move({ ids: ['Three'], by: { x: 0, y: 0 }, into: 'Sub_1' })).toMatchObject({ ok: true });
  expect(study.get('Three')).toMatchObject({ parent: 'Sub_1', plane: 'Sub_1' });

  expect(study.reconnect({ id: 'Flow_1', to: 'Task_1' })).toMatchObject({ ok: false });
  study.move({ ids: ['Three'], by: { x: 0, y: 0 }, into: 'Process_1' });
  expect(study.reconnect({ id: 'Flow_1', to: 'Three' })).toMatchObject({ ok: true, changed: expect.arrayContaining(['Flow_1', 'Two', 'Three']) });
  expect(study.get('Flow_1')).toMatchObject({ source: 'Task_1', target: 'Three' });
  expect(study.reconnect({ id: 'Flow_1' }).reason).toBe('give the new end: from, to, or both');
});

test('an activity moved takes the boundary events on it along', () => {
  const study = Study.of(studyModel(`id: Defs_B
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    Host:
      type: Task
      bounds: 100 100 100 80
    Timer:
      type: BoundaryEvent
      attachedToRef: Host
      eventDefinitions:
        T_1:
          type: TimerEventDefinition
      bounds: 132 162 36 36
`));
  expect(study.move({ ids: ['Host'], by: { x: 50, y: 20 } })).toMatchObject({ ok: true, changed: expect.arrayContaining(['Host', 'Timer']) });
  expect(study.get('Timer')!.bounds).toMatchObject({ x: 182, y: 182 });
});

test('a lane moved into a pool that has none is filed in a lane set the pool\'s process is given; one undo takes both back', () => {
  const study = Study.of(studyModel(`id: Defs_L
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Lab: { name: Lab, processRef: P, bounds: 100 50 600 300 }
    Home: { name: Home, processRef: Q, bounds: 100 400 600 300 }
P:
  type: Process
  laneSets:
    Set_P:
      lanes:
        Screen: { name: Screen, bounds: 130 50 570 150 }
        Model: { name: Model, bounds: 130 200 570 150 }
Q:
  type: Process
`));
  const before = study.toYaml();
  const { model } = study;

  expect(study.move({ ids: ['Model'], by: { x: 0, y: 350 }, into: 'Home' })).toMatchObject({ ok: true, changed: ['Model'] });
  expect(study.get('Model')).toMatchObject({ parent: 'Home' });
  const laneSet = model.parentOf(model.get('Model')!)!;
  expect(model.host(laneSet)).toBe('bpmn:LaneSet');
  expect(model.holderOf(laneSet)).toMatchObject({ parent: { id: 'Q' }, key: 'laneSets' });
  expect(model.get('Set_P')!.lanes, 'the pool it left keeps its other lane').toEqual([model.get('Screen')]);

  expect(study.undo().ok).toBe(true);
  expect(study.toYaml()).toBe(before);

  // Moved back, it takes the lane set it empties along, as a deletion does.
  study.redo();
  study.move({ ids: ['Model'], by: { x: 0, y: -350 }, into: 'Lab' });
  expect(study.toYaml()).toBe(before);
});

test('a lane put on a lane divides it: filed in that lane\'s own lane set, and read back from YAML or XML, drawn in it', async () => {
  const LANES = `id: Defs_N
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Lab: { name: Lab, processRef: P, bounds: 100 50 600 300 }
P:
  type: Process
  laneSets:
    Set_P:
      lanes:
        Screen: { name: Screen, bounds: 130 50 570 150 }
        Desk: { name: Desk, bounds: 130 200 570 150 }
`;
  // [how it goes on, the edit, the lane it put there]
  const CASES: [how: string, put: (study: Study) => StudyResult, lane: string][] = [
    ['add', (study) => study.add({ type: 'bpmn:Lane', id: 'Voice', into: 'Screen', at: { x: 430, y: 160 } }), 'Voice'],
    ['move', (study) => study.move({ ids: ['Desk'], by: { x: 30, y: -100 }, into: 'Screen' }), 'Desk'],
  ];
  for (const [how, put, lane] of CASES) {
    const study = Study.of(studyModel(LANES));
    const before = study.toYaml();
    expect(put(study).ok, how).toBe(true);
    const { model } = study;
    expect(model.holderOf(model.parentOf(model.get(lane)!)!), how).toMatchObject({ parent: { id: 'Screen' }, key: 'childLaneSet' });
    expect(study.get(lane), how).toMatchObject({ parent: 'Screen' });
    expect(Study.of(studyModel(study.toYaml())).get(lane), `${how}: the YAML read back`).toEqual(study.get(lane));
    expect((await Study.open(await study.toXml(), { metamodel: freshMetamodel() })).get(lane), `${how}: the XML read back`).toEqual(study.get(lane));

    expect(study.undo().ok, how).toBe(true);
    expect(study.toYaml(), how).toBe(before);
  }
});

test('a step put into a pool with no process gives the pool one, a root of the study, to hold it; one undo takes both back', () => {
  const POOLS = `id: Defs_P
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Lab: { name: Lab, processRef: P, bounds: 100 50 600 200 }
    Model: { name: Model, bounds: 100 300 600 200 }
P:
  type: Process
  flowElements:
    Ask: { type: Task, bounds: 200 100 100 80 }
`;
  const at = { x: 300, y: 400 };
  // [how the step goes in, the edit, the step it put there]
  const CASES: [how: string, put: (study: Study) => StudyResult, step: (done: StudyResult) => string][] = [
    ['add', (study) => study.add({ type: 'bpmn:Task', id: 'Tell', into: 'Model', at }), () => 'Tell'],
    ['move', (study) => study.move({ ids: ['Ask'], by: { x: 0, y: 250 }, into: 'Model' }), () => 'Ask'],
    ['paste', (study) => study.paste({ yaml: (study.copy({ ids: ['Ask'] }) as { yaml: string }).yaml, into: 'Model', at }), (done) => done.added[0]],
  ];
  for (const [how, put, stepOf] of CASES) {
    const study = Study.of(studyModel(POOLS));
    const before = study.toYaml();
    const done = put(study);
    expect(done.ok, how).toBe(true);
    const { model } = study;
    expect(rootTypes(study), how).toEqual(['bpmn:Collaboration', 'bpmn:Process', 'bpmn:Process']);
    const process = model.study.roots[2];
    expect(model.get('Model')!.processRef, how).toBe(process.id);
    const step = stepOf(done);
    expect(model.holderOf(model.get(step)!), how).toMatchObject({ parent: process, key: 'flowElements' });
    // The file holds the step and its drawing: read back, it is drawn where it was put.
    expect(Study.of(studyModel(study.toYaml())).get(step), how).toEqual(study.get(step));
    expect(study.get(step), how).toMatchObject({ parent: 'Model' });

    expect(study.undo().ok, how).toBe(true);
    expect(study.toYaml(), how).toBe(before);
  }
});

test('a step moved to another lane keeps its flows in the pool\'s process, wherever their other ends are', () => {
  const study = Study.of(studyModel(`id: Defs_F
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Lab: { name: Lab, processRef: P, bounds: 100 50 600 450 }
P:
  type: Process
  laneSets:
    Set_P:
      lanes:
        Screen: { name: Screen, flowNodeRef: [Ask], bounds: 130 50 570 150 }
        Desk: { name: Desk, flowNodeRef: [Tell], bounds: 130 200 570 150 }
        Phone: { name: Phone, bounds: 130 350 570 150 }
  flowElements:
    Ask: { type: Task, bounds: 200 80 100 80 }
    Tell: { type: Task, bounds: 400 230 100 80 }
    Ask_Tell:
      sourceRef: Ask
      targetRef: Tell
      waypoint: 300,120 450,120 450,230
`));
  const before = study.toYaml();
  const { model } = study;

  expect(study.move({ ids: ['Tell'], by: { x: 0, y: 150 }, into: 'Phone' })).toMatchObject({ ok: true });
  expect(model.holderOf(model.get('Ask_Tell')!)).toMatchObject({ parent: { id: 'P' }, key: 'flowElements' });
  const { waypoints } = study.get('Ask_Tell')!;
  expect(Study.of(studyModel(study.toYaml())).get('Ask_Tell'), 'read back, it is drawn where it was').toMatchObject({ source: 'Ask', target: 'Tell', waypoints });

  expect(study.undo().ok).toBe(true);
  expect(study.toYaml()).toBe(before);
});

test('a lane moved into another pool takes what it holds along, filed in that pool\'s process; a flow it would strand refuses the move', () => {
  const study = Study.of(studyModel(`id: Defs_T
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Lab: { name: Lab, processRef: P, bounds: 100 50 700 450 }
    Home: { name: Home, processRef: Q, bounds: 100 550 700 450 }
P:
  type: Process
  laneSets:
    Set_P:
      lanes:
        Screen:
          name: Screen
          flowNodeRef: [Ask, Late]
          bounds: 130 50 670 300
          childLaneSet:
            lanes:
              Voice: { name: Voice, flowNodeRef: [Tell], bounds: 160 200 640 150 }
        Desk: { name: Desk, flowNodeRef: [File], bounds: 130 350 670 150 }
  flowElements:
    Ask: { type: Task, bounds: 200 80 100 80 }
    Late:
      type: BoundaryEvent
      attachedToRef: Ask
      eventDefinitions:
        T_1: { type: TimerEventDefinition }
      bounds: 232 142 36 36
    Tell: { type: Task, bounds: 400 230 100 80 }
    File: { type: Task, bounds: 600 380 100 80 }
    Ask_Tell:
      sourceRef: Ask
      targetRef: Tell
      waypoint: 300,120 450,120 450,230
    Late_Tell:
      sourceRef: Late
      targetRef: Tell
      waypoint: 250,178 250,270 400,270
Q:
  type: Process
`));
  const before = study.toYaml();
  const { model } = study;
  const holderOf = (id: string): string | undefined => model.parentOf(model.get(id)!)?.id;

  expect(study.move({ ids: ['Screen'], by: { x: 0, y: 500 }, into: 'Home' })).toMatchObject({ ok: true });
  // Its steps, the lane inside it and its step, the boundary event on one, the flows between them.
  for (const id of ['Ask', 'Late', 'Tell', 'Ask_Tell', 'Late_Tell']) expect(holderOf(id), id).toBe('Q');
  expect(holderOf('File'), 'what another lane holds stays').toBe('P');
  // The file draws them where they were put: each in its lane, in the pool it went to.
  const reread = Study.of(studyModel(study.toYaml()));
  for (const id of ['Screen', 'Voice', 'Ask', 'Late', 'Tell']) expect(reread.get(id), id).toEqual(study.get(id));

  expect(study.undo().ok).toBe(true);
  expect(study.toYaml()).toBe(before);

  // A sequence flow does not cross pools: one to a step left behind keeps the lane, as it would keep the step.
  study.connect({ from: 'Tell', to: 'File', id: 'Tell_File' });
  expect(study.move({ ids: ['Screen'], by: { x: 0, y: 500 }, into: 'Home' })).toMatchObject({ ok: false });
});

const CLIPBOARD = `id: Defs_C
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    Ask:
      type: Task
      name: Ask
      bounds: 100 100 100 80
      dataInputAssociations:
        In_1:
          sourceRef:
            - Form
          waypoint: 150,260 150,180
    Late:
      type: BoundaryEvent
      name: too late
      attachedToRef: Ask
      eventDefinitions:
        T_1:
          type: TimerEventDefinition
      bounds: 132 162 36 36
    Form:
      type: DataObjectReference
      name: form
      bounds: 132 260 36 50
    Gate:
      type: ExclusiveGateway
      default: To_Other
      bounds: 260 115 50 50
    Other:
      type: Task
      bounds: 400 100 100 80
    Sub:
      type: SubProcess
      bounds: 100 400 300 200
      isExpanded: true
      flowElements:
        Inner:
          type: Task
          bounds: 150 450 100 80
    F1:
      sourceRef: Ask
      targetRef: Gate
      waypoint: 200,140 260,140
    To_Other:
      sourceRef: Gate
      targetRef: Other
      waypoint: 310,140 400,140
  artifacts:
    Around:
      type: Group
      categoryValueRef: Phase_1
      bounds: 80 80 250 250
Phase:
  type: Category
  categoryValue:
    Phase_1:
      value: Phase one
`;

test('a record says which flow a shape BPMN gives a default takes by default, and nothing on what takes none', () => {
  const study = Study.of(studyModel(CLIPBOARD));
  expect([study.get('Gate')?.default, study.get('Ask')?.default, study.get('Other')?.default]).toEqual(['To_Other', null, null]);
  expect(study.get('Form')).not.toHaveProperty('default');
});

test('copy writes shapes as a document of their own: what they hold, what sits on them, the flows between them, and nothing of what stays', () => {
  const study = Study.of(studyModel(CLIPBOARD));
  const copied = study.copy({ ids: ['Ask', 'Gate', 'Form_label', 'Sub', 'Around'] });
  expect(copied.ok).toBe(true);
  const yaml = (copied as { yaml: string }).yaml;
  for (const id of ['Ask', 'Late', 'Form', 'In_1', 'Gate', 'F1', 'Sub', 'Inner', 'Around', 'Phase one']) expect(yaml, id).toContain(id);
  for (const id of ['Other', 'To_Other']) expect(yaml, id).not.toContain(id);
  expect(study.toYaml(), 'a copy is a read').toContain('default: To_Other');

  expect(study.copy({ ids: ['Late'] }), 'what sits on an activity goes only with it').toMatchObject({ ok: false });
  expect(study.copy({ ids: ['F1'] })).toMatchObject({ ok: false });
  expect(study.copy({ ids: ['Ask', 'Nowhere'] })).toEqual({ ok: false, reason: "no element 'Nowhere'" });
});

test('paste draws a copy in as one edit: fresh ids for taken ones, centred where it is put, into what is there; a document it cannot take is refused', () => {
  const study = Study.of(studyModel(CLIPBOARD));
  const yaml = (study.copy({ ids: ['Ask', 'Gate', 'Form'] }) as { yaml: string }).yaml;
  const before = study.list().length;

  const pasted = study.paste({ yaml, at: { x: 700, y: 500 } });
  expect(pasted).toMatchObject({ ok: true, changed: [], removed: [] });
  const records = pasted.added.map((id) => study.get(id)!);
  expect(records.map((r) => r.id)).not.toContain('Ask');
  const task = records.find((r) => r.name === 'Ask')!;
  const gate = records.find((r) => r.type === 'bpmn:ExclusiveGateway')!;
  expect(records.find((r) => r.type === 'bpmn:SequenceFlow')).toMatchObject({ source: task.id, target: gate.id });
  expect(records.find((r) => r.type === 'bpmn:BoundaryEvent')).toMatchObject({ attachedTo: task.id });
  expect(records.find((r) => r.type === 'bpmn:DataInputAssociation')).toMatchObject({ target: task.id });
  const shapes = records.filter((r) => r.kind === 'node').map((r) => r.bounds!);
  const left = Math.min(...shapes.map((b) => b.x));
  const right = Math.max(...shapes.map((b) => b.x + b.width));
  expect(Math.abs((left + right) / 2 - 700)).toBeLessThanOrEqual(1);

  expect(study.paste({ yaml, into: 'Sub' }).added.map((id) => study.get(id)!.parent)).toContain('Sub');
  study.undo();
  study.undo();
  expect(study.list().length).toBe(before);

  expect(study.paste({ yaml: 'just words' }).reason).toContain('not a studyflow document');
  expect(study.paste({ yaml, into: 'Other' }), 'a task holds nothing').toMatchObject({ ok: false });
});

test('a caption keeps up with what it names, in a study no view draws', () => {
  const study = open();
  study.add({ type: 'bpmn:StartEvent', id: 'Go', name: 'go', at: { x: 100, y: 400 } });
  const was = study.get('Go_label')!.bounds!;
  study.move({ ids: ['Go'], by: { x: 40, y: 10 } });
  expect(study.get('Go_label')!.bounds).toMatchObject({ x: was.x + 40, y: was.y + 10 });
});

test('a caption is sized from its name as drawn, its placeholders resolved, pinned or not', () => {
  const drawn = (name: string): (Bounds | undefined)[] => {
    const study = Study.of(studyModel(`id: Defs_3
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  properties:
    Max:
      name: max_unanswered
      value: 0.2
  flowElements:
    Derived:
      type: EndEvent
      name: ${JSON.stringify(name)}
      bounds: 200 80 36 36
    Pinned:
      type: EndEvent
      name: ${JSON.stringify(name)}
      bounds: 400 80 36 36
      label: 340 122 184 15
`));
    return [study.get('Derived_label')?.bounds, study.get('Pinned_label')?.bounds];
  };
  // The name as written wraps to more lines than the text drawn, which would leave the box taller than its text.
  expect(drawn('> {max_unanswered:%} unanswered')).toEqual(drawn('> 20% unanswered'));
});

test('a reconnected data association is filed on its new activity, the one that reads or writes the data', () => {
  const study = open();
  study.add({ type: 'bpmn:Task', id: 'Two', at: { x: 600, y: 120 } });
  study.add({ type: 'bpmn:DataObjectReference', id: 'Data', at: { x: 400, y: 320 } });
  study.add({ type: 'bpmn:DataObjectReference', id: 'Other', at: { x: 500, y: 320 } });
  study.connect({ from: 'Data', to: 'Task_1', id: 'In_1' });
  study.connect({ from: 'Task_1', to: 'Data', id: 'Out_1' });
  // What the file says, read back: the activity an association hangs off is the one that takes or makes the data.
  const reopened = () => Study.of(studyModel(study.toYaml()));
  const ownerOf = (again: Study, id: string) => again.model.holderOf(again.element(id)!)?.parent?.id;

  const CASES: [label: string, args: { id: string; from?: string; to?: string }, ends: { source: string; target: string }, owner: string][] = [
    ['an input onto another activity', { id: 'In_1', to: 'Two' }, { source: 'Data', target: 'Two' }, 'Two'],
    ['an input from other data', { id: 'In_1', from: 'Other' }, { source: 'Other', target: 'Two' }, 'Two'],
    ['an output from another activity', { id: 'Out_1', from: 'Two' }, { source: 'Two', target: 'Data' }, 'Two'],
  ];
  for (const [label, args, ends, owner] of CASES) {
    expect(study.reconnect(args), label).toMatchObject({ ok: true });
    const again = reopened();
    expect(again.get(args.id), label).toMatchObject(ends);
    expect(ownerOf(again, args.id), label).toBe(owner);
  }
});

/** A step that declares its inputs and outputs, as a standard-BPMN file may: one input, read from Digits. */
const DECLARED = `id: Defs_D
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    Fit:
      type: Task
      name: Fit
      bounds: 200 100 100 80
      ioSpecification:
        id: Fit_io
        dataInputs:
          Fit_in_digits:
            name: digits
        inputSets:
          Fit_inputSet:
            dataInputRefs:
              - Fit_in_digits
        outputSets:
          Fit_outputSet: {}
      dataInputAssociations:
        In_1: Digits -> Fit_in_digits
    Digits:
      type: DataObjectReference
      name: digits
      bounds: 100 300 36 50
    Table:
      type: DataObjectReference
      name: table
      bounds: 200 300 36 50
    Model:
      type: DataObjectReference
      name: model
      bounds: 300 300 36 50
`;

test('on a step that declares its inputs and outputs, connecting data mints the slot, and deleting the connection gives it back, ioSpecification and all', () => {
  const study = Study.of(studyModel(DECLARED));
  const before = study.toYaml();
  const io = (): any => study.element('Fit')!.ioSpecification;

  study.connect({ from: 'Table', to: 'Fit', id: 'In_2' });
  study.connect({ from: 'Fit', to: 'Model', id: 'Out_1' });
  // Each slot is named as core names the one it mints for the compact form, and listed in the declaration's sets.
  expect([study.element('In_2')!.targetRef, study.element('Out_1')!.sourceRef]).toEqual(['Fit_in_table', ['Fit_result']]);
  expect([io().inputSets[0].dataInputRefs, io().outputSets[0].dataOutputRefs]).toEqual([['Fit_in_digits', 'Fit_in_table'], ['Fit_result']]);

  study.remove({ ids: ['In_2', 'Out_1'] });
  expect(study.toYaml()).toBe(before);
  study.remove({ ids: ['In_1'] });
  expect(io()).toBeUndefined();
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
    id: 'Task_1', kind: 'node', type: 'bpmn:Task', name: 'Read', bounds: { x: 200, y: 80, width: 100, height: 80 }, incoming: [], outgoing: ['Flow_1'], default: null,
  });
  expect(study.get('Flow_1')).toMatchObject({ kind: 'edge', type: 'bpmn:SequenceFlow', source: 'Task_1', target: 'Sub_1' });
  expect(study.get('Sub_1')).toMatchObject({ kind: 'node', expanded: false });
  expect(study.get('Task_In'), 'drawn on the plane of the closed container it sits in').toMatchObject({ parent: 'Sub_1', plane: 'Sub_1' });
  expect(study.get('Nope')).toBeUndefined();
  study.style({ ids: ['Task_1', 'Flow_1'], stroke: '#aa3333', font: { bold: true } });
  expect(study.get('Task_1'), 'what style wrote, a read returns').toMatchObject({ stroke: '#aa3333', font: { bold: true } });
  expect(study.get('Flow_1')).toMatchObject({ stroke: '#aa3333', font: { bold: true } });
  // A caption says whether it is kept where it was put (a move pins it) or placed by what it captions.
  study.set({ id: 'Flow_1', attribute: 'name', value: 'go' });
  const caption = study.list({ kind: 'label' }).find((record) => record.owner === 'Flow_1')!;
  expect(caption).not.toHaveProperty('pinned');
  study.move({ ids: [caption.id], by: { x: 10, y: 0 } });
  expect(study.get(caption.id)).toMatchObject({ kind: 'label', owner: 'Flow_1', pinned: true });

  expect(study.list().map((record) => record.id).sort()).toEqual(['Flow_1', 'Sub_1', 'Task_1', 'Task_In']);
  expect(study.list({ within: 'Sub_1' }).map((record) => record.id)).toEqual(['Task_In']);
  expect(study.list({ kind: 'edge', type: 'bpmn:SequenceFlow' }).map((record) => record.id)).toEqual(['Flow_1']);
  expect(JSON.parse(JSON.stringify(study.list())), 'JSON through and through').toEqual(study.list());
  expect(study.element('Count')?.type).toBe('bpmn:Property');
});

test('attributes lists what set takes on an element, by the names the file spells, with what each holds now', () => {
  const study = open();
  const named = (id: string, name: string) => study.attributes(id)!.find((attribute) => attribute.name === name);

  expect(named('Task_1', 'name')).toEqual({ name: 'name', type: 'String', value: 'Read' });
  expect(named('Task_1', 'duration')).toMatchObject({ type: 'String', description: expect.stringContaining('How long') });
  expect(named('Task_1', 'duration')).not.toHaveProperty('value');
  expect(named('Task_1', 'documentation'), 'kept in a body, it is text').toMatchObject({ type: 'String' });
  expect(named('Task_1', 'documentation')).not.toHaveProperty('many');
  expect(study.set({ id: 'Task_1', attribute: 'duration', value: 'PT5M' }).ok).toBe(true);
  expect(named('Task_1', 'duration')?.value).toBe('PT5M');
  // Each name is one set takes: written back as it stands, every one is accepted.
  for (const { name, value } of study.attributes('Task_1')!) {
    expect(study.set({ id: 'Task_1', attribute: name, value: value ?? null }).ok, name).toBe(true);
  }
  expect(study.attributes('Nope')).toBeUndefined();
});

// --- tools -------------------------------------------------------------------------------

/** A call as an MCP client makes it: the argument and the answer each cross JSON. */
const call = (study: Study, tool: string, args: unknown = {}): any =>
  JSON.parse(JSON.stringify(study.call(tool, JSON.parse(JSON.stringify(args)))));

test('an MCP client drives a study through its tools: listed as JSON, called with JSON, the changes heard by id, the file read back', async () => {
  const study = open();
  const heard: string[] = [];
  study.on('change', (change) => heard.push(`${change.cause} +${change.added} -${change.removed}`));

  const tools = JSON.parse(JSON.stringify(Study.tools)) as StudyTool[];
  expect(tools, 'JSON through and through').toEqual(Study.tools);
  expect(tools.filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name)).toEqual(['document', 'get', 'list', 'attributes', 'describe', 'catalog', 'can', 'copy']);
  expect(tools.find((tool) => tool.name === 'connect')?.inputSchema).toMatchObject({ type: 'object', required: ['from', 'to'] });

  const appended = call(study, 'append', { from: 'Task_1', type: 'bpmn:EndEvent', id: 'Done' });
  expect(appended).toMatchObject({ ok: true, id: 'Done' });
  const flow = call(study, 'get', { id: 'Done' }).element.incoming[0];
  expect(appended.added).toEqual(['Done', flow]);
  expect(call(study, 'get', { id: flow })).toMatchObject({ ok: true, element: { kind: 'edge', source: 'Task_1', target: 'Done' } });
  expect(call(study, 'set', { id: 'Done', attribute: 'name', value: 'Finished' })).toMatchObject({ ok: true, changed: ['Done'] });
  expect(call(study, 'list', { type: 'bpmn:EndEvent' }).elements).toMatchObject([{ id: 'Done', name: 'Finished' }]);

  const reopened = await Study.open(call(study, 'document').yaml, { metamodel: freshMetamodel() });
  expect(reopened.get('Done')).toEqual(study.get('Done'));

  expect(call(study, 'undo')).toMatchObject({ ok: true });
  expect(study.get('Done')?.name, 'undo takes back the last edit').toBeUndefined();
  expect(heard).toEqual([`edit +Done,${flow} -`, 'edit + -', 'undo + -']);
});

test('typing into one field is one undo step: a set per keystroke, an edit naming its run', () => {
  const study = open();
  const before = study.get('Task_1')?.name;
  for (const name of ['S', 'Sc', 'Scr', 'Screen']) study.set({ id: 'Task_1', attribute: 'name', value: name });
  study.set({ id: 'Task_1', attribute: 'documentation', value: 'first' });
  expect(study.undo().ok).toBe(true);
  expect(study.get('Task_1')?.name, 'another field is a step of its own').toBe('Screen');
  expect(study.undo().ok).toBe(true);
  expect(study.get('Task_1')?.name, 'the typing undoes as one').toBe(before);

  for (const text of ['a', 'ab']) study.revise('Task_1', (task) => { task.name = text; }, 'name');
  study.revise('Task_1', (task) => { task.name = 'c'; });
  study.undo();
  expect(study.get('Task_1')?.name, 'an edit naming no run is a step of its own').toBe('ab');
});

test('rename is the verb a label edit writes through: one edit, undone as one', () => {
  const study = open();
  expect(call(study, 'rename', { id: 'Task_1', name: '  Screen  ' })).toMatchObject({ ok: true, changed: ['Task_1'] });
  expect(study.get('Task_1')?.name).toBe('Screen');
  expect(call(study, 'rename', { id: 'Nope', name: 'x' })).toMatchObject({ ok: false, reason: "no shape or flow 'Nope'" });
  expect(study.undo().ok).toBe(true);
  expect(study.get('Task_1')?.name).not.toBe('Screen');
});

test('a tool call the study cannot run is refused with a reason, as data: nothing written, nothing heard', () => {
  const study = open();
  let heard = 0;
  study.on('change', () => (heard += 1));
  const REFUSALS: [tool: string, args: unknown, reason: string][] = [
    ['fly', {}, "no tool 'fly'"],
    ['rename', {}, "'id' is required"],
    ['add', [], 'the argument should be an object'],
    ['add', { type: 'bpmn:Lane' }, "'type' should be one of \"bpmn:StartEvent\", "],
    ['connect', { from: 'Task_1' }, "'to' is required"],
    ['get', { id: 'Task_1', depth: 2 }, "the argument takes no 'depth'"],
    ['resize', { id: 'Task_1', bounds: { x: 0, y: 0, width: '100', height: 80 } }, "'bounds.width' should be a number"],
    ['style', { ids: ['Task_1', 7] }, "'ids[1]' should be a string"],
    ['batch', { steps: [{ tool: 'undo', args: {} }] }, "'steps[0].tool' should be one of \"add\", "],
    ['add', { type: 'bpmn:Task', template: 'cognitive::template:1' }, 'give a type or a template, not both'],
    ['add', { name: 'Nameless' }, 'give a type or a template'],
    ['add', { template: 'nope::template:1' }, "no template 'nope::template:1'"],
    ['add', { type: 'bpmn:Task', extension: 'nope:Nope' }, "no schema type 'nope:Nope'"],
    ['add', { type: 'bpmn:Task', extension: 'studyflow:Actor' }, 'a bpmn:Task cannot be a studyflow:Actor'],
    ['set', { id: 'Task_1', attribute: 'nope', value: 1 }, "no schema gives 'Task_1' an attribute 'nope'"],
    ['get', { id: 'Nope' }, "no element 'Nope'"],
    ['undo', {}, 'nothing to undo'],
  ];
  for (const [tool, args, reason] of REFUSALS) {
    const result = call(study, tool, args);
    expect(result, `${tool} ${JSON.stringify(args)}`).toEqual({ ok: false, reason: result.reason, added: [], changed: [], removed: [] });
    expect(result.reason.startsWith(reason), `${tool} ${JSON.stringify(args)}: ${result.reason}`).toBe(true);
  }
  expect(heard).toBe(0);
  expect(study.revision).toBe(0);
});

test('what the catalog lists, add makes: every BPMN shape type, every schema type paired with its own, every template', () => {
  const { types, templates } = call(open(), 'catalog');
  expect(types).toContainEqual({ type: 'bpmn:UserTask' });
  expect(types).toContainEqual(expect.objectContaining({ type: 'bpmn:ChoreographyTask', extension: 'cognitive:CognitiveTask', title: 'Cognitive Task' }));

  for (const { title, description, ...what } of [...types, ...templates]) {
    const into = what.type === 'bpmn:BoundaryEvent' ? { into: 'Task_1' } : {};
    expect(call(open(), 'add', { ...what, ...into }), JSON.stringify(what)).toMatchObject({ ok: true });
  }

  // A schema type comes with its defaults, and is the type the element is, as the file spells it; an event type
  // with the event it is (a rest is a timer).
  const study = open();
  const { id } = call(study, 'add', { type: 'bpmn:IntermediateCatchEvent', extension: 'cognitive:Rest' });
  expect(study.element(id)).toMatchObject({ type: 'cognitive:Rest', eyes: 'open', eventDefinitions: [{ type: 'bpmn:TimerEventDefinition', timeDuration: 'PT1M' }] });
});
