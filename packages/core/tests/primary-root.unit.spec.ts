import { expect, test } from '@playwright/test';

import { StudyModel, type Element, type Value } from '@core/model/index';
import { freshMetamodel } from '@tests/schemas';

/** The root a study is about, and the runtime its Study declares there (`model/index.ts`). */

const metamodel = freshMetamodel();

test('the primary root is the root the canvas draws: what the diagram names, else by type, never a collaboration of actors alone', () => {
  const process: Element = { type: 'bpmn:Process', id: 'Process' };
  const pools: Element = { type: 'bpmn:Collaboration', id: 'Pools', participants: [{ type: 'bpmn:Participant', id: 'Pool', processRef: 'Process' }] };
  const actors: Element = { type: 'bpmn:Collaboration', id: 'Actors', participants: [{ type: 'bpmn:Participant', id: 'Claude', name: 'Claude' }] };

  const CASES: [label: string, roots: Element[], planeNames: string | undefined, expected: Element][] = [
    ['a collaboration with a pool comes before its process', [process, pools], undefined, pools],
    ['the element the diagram names outranks the type order', [process, pools], 'Process', process],
    ['a collaboration with no pool, only actors that take bands, is not the subject: the process is', [actors, process], undefined, process],
  ];
  for (const [label, roots, planeNames, expected] of CASES) {
    const diagram: Value[] | undefined = planeNames ? [{ plane: { bpmnElement: planeNames } }] : undefined;
    const model = new StudyModel({ definitions: {}, roots, layout: {}, ...(diagram ? { diagram } : {}) }, metamodel);
    expect(model.primaryRoot(), label).toBe(expected);
  }
});

test('the runtime is what the Study declares, where the inspector stores it, else the schema default', () => {
  const CASES: [label: string, root: Element, expected: string][] = [
    ['declared on the Study', { type: 'studyflow:Study', id: 'P', runtime: 'browser' }, 'browser'],
    ['a Study that declares none', { type: 'studyflow:Study', id: 'P' }, 'local'],
    ['no Study at all', { type: 'bpmn:Process', id: 'P' }, 'local'],
  ];
  for (const [label, root, expected] of CASES) {
    expect(new StudyModel({ definitions: {}, roots: [root], layout: {} }, metamodel).runtime(), label).toBe(expected);
  }
});
