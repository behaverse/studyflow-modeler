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
const ids = (elements: readonly { id: string }[]): string[] => elements.map((element) => element.id);

test('a study announces each commit once, to each listener in turn, with no DOM', () => {
  const study = open();
  const heard: string[] = [];
  study.on('change', (change) => heard.push(`first: ${change.cause} ${ids(change.changed)}`));
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

  expect(heard.map(({ cause, added, removed }) => [cause, ids(added), ids(removed)]))
    .toEqual([['load', ['Consent'], ['Task_1', 'Sub_1', 'Task_In']]]);
  expect(rootTypes(study), 'the choreography is edited on a process').toContain('bpmn:Process');
  expect([study.canUndo, study.canRedo]).toEqual([false, false]);
  expect(study.revision, 'the revision carries on').toBe(2);
});

test('a study writes its file as a file holds it, without touching what it edits, and reopens it the same', async () => {
  const study = await Study.open(CHOREOGRAPHY, { moddle: freshModdle() });

  const xml = await study.toXml();

  expect(xml).toContain('<bpmn:choreography id="Dyad"');
  expect(rootTypes(study), 'still a process to edit').toContain('bpmn:Process');
  expect(await (await Study.open(xml, { moddle: freshModdle() })).toXml()).toBe(xml);
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
    expect(study.undo()).toBe(true);
    expect(await study.toXml(), `undo ${EDITS[step][0]}`).toBe(files[step]);
  }
  expect(study.undo(), 'back at the file as opened').toBe(false);
  for (let step = 0; step < EDITS.length; step += 1) {
    expect(study.redo()).toBe(true);
    expect(await study.toXml(), `redo ${EDITS[step][0]}`).toBe(files[step + 1]);
  }
  expect(study.redo()).toBe(false);
});

test('an undo and a redo each put the document back as one change, by id, and are no edits: the redo stays', () => {
  const study = open();
  const heard: string[] = [];
  study.on('change', ({ cause, added, removed }) => {
    heard.push(`${cause} +${ids(added)} -${ids(removed)} undo:${study.canUndo} redo:${study.canRedo}`);
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
  while (study.undo()) steps += 1;
  expect(steps).toBe(50);
});
