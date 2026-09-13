import { expect, test } from '@playwright/test';

import { declaredRuntime, primaryRoot, studyflowToDefinitions } from '@core/document';
import { freshModdle } from '@tests/schemas';

/** The root a document is about, and the runtime its Study declares there (`document/format.ts`). */

const moddle = freshModdle();

test('primaryRoot is the root the canvas draws: what the DI plane names, else by type, never a collaboration of actors alone', () => {
  const process = moddle.create('bpmn:Process', { id: 'Process', flowElements: [] });
  const pool = moddle.create('bpmn:Participant', { id: 'Pool', processRef: process });
  const pools = moddle.create('bpmn:Collaboration', { id: 'Pools', participants: [pool] });
  const actor = moddle.create('bpmn:Participant', { id: 'Claude', name: 'Claude' });
  const actors = moddle.create('bpmn:Collaboration', { id: 'Actors', participants: [actor] });

  const CASES: [label: string, rootElements: any[], planeNames: any, expected: any][] = [
    ['a collaboration with a pool comes before its process', [process, pools], undefined, pools],
    ['the element the DI plane names outranks the type order', [process, pools], process, process],
    ['a collaboration with no pool, only actors that take bands, is not the subject: the process is', [actors, process], undefined, process],
  ];
  for (const [label, rootElements, planeNames, expected] of CASES) {
    const definitions = moddle.create('bpmn:Definitions', { rootElements });
    if (planeNames) {
      const plane = moddle.create('bpmndi:BPMNPlane', { bpmnElement: planeNames });
      definitions.diagrams = [moddle.create('bpmndi:BPMNDiagram', { plane })];
    }
    expect(primaryRoot(definitions), label).toBe(expected);
  }
});

test('declaredRuntime reads the Study extension, where the inspector stores it, else the schema default', () => {
  const CASES: [label: string, extensionElements: object[] | undefined, expected: string][] = [
    ['declared on the Study', [{ type: 'studyflow:Study', runtime: 'browser' }], 'browser'],
    ['a Study that declares none', [{ type: 'studyflow:Study' }], 'local'],
    ['no Study at all', undefined, 'local'],
  ];
  for (const [label, extensionElements, expected] of CASES) {
    const definitions = studyflowToDefinitions({ definitions: {}, P: { type: 'Process', extensionElements } }, moddle);
    expect(declaredRuntime(definitions), label).toBe(expected);
  }
});
