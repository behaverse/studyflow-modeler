import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { Study, studyInternals, type StudyChange } from '@canvas/study/Study.ts';
import type { ModdleObject, SceneNode } from '@canvas/study/scene.ts';

import { freshModdle } from '@tests/schemas';

/**
 * The Study: a document and its edits, with no DOM. This spec installs no document, so anything here that
 * reached for one would fail.
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

const rootTypes = (study: Study): string[] => (study.definitions.rootElements as ModdleObject[]).map((root) => root.$type);

test('a study announces each commit once, to each listener in turn, with no DOM', () => {
  const study = Study.fromDefinitions(studyflowToDefinitions(YAML, freshModdle()));
  const heard: string[] = [];
  study.on('change', (change) => heard.push(`first: ${change.cause} ${change.changed.map((element) => element.id)}`));
  const stop = study.on('change', () => heard.push('second'));
  const { scene, mutator } = studyInternals(study);
  const task = scene.elementsById.get('Task_1') as SceneNode;

  mutator.setName(task, 'Renamed');
  stop();
  mutator.setName(task, 'Again');
  mutator.setName(task, 'Again');

  expect(heard).toEqual(['first: edit Task_1', 'second', 'first: edit Task_1']);
  expect(study.revision).toBe(2);
});

test('a load replaces the document, read as a file opens, in one change that removes the old and adds the new', async () => {
  const study = Study.fromDefinitions(studyflowToDefinitions(YAML, freshModdle()));
  const heard: StudyChange[] = [];
  study.on('change', (change) => heard.push(change));

  await study.load(CHOREOGRAPHY);

  expect(heard.map(({ cause, added, removed }) => [cause, added.map((e) => e.id), removed.map((e) => e.id)]))
    .toEqual([['load', ['Consent'], ['Task_1']]]);
  expect(rootTypes(study), 'the choreography is edited on a process').toContain('bpmn:Process');
  expect(study.revision, 'the revision carries on').toBe(1);
});

test('a study writes its file as a file holds it, without touching what it edits, and reopens it the same', async () => {
  const study = await Study.open(CHOREOGRAPHY, { moddle: freshModdle() });

  const xml = await study.toXml();

  expect(xml).toContain('<bpmn:choreography id="Dyad"');
  expect(rootTypes(study), 'still a process to edit').toContain('bpmn:Process');
  expect(await (await Study.open(xml, { moddle: freshModdle() })).toXml()).toBe(xml);
});
