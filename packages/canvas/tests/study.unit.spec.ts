import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { Study, studyInternals } from '@canvas/study/Study.ts';
import type { SceneNode } from '@canvas/study/scene.ts';

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

test('a study announces each commit once, to each listener in turn, with no DOM', () => {
  const study = new Study(studyflowToDefinitions(YAML, freshModdle()));
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
