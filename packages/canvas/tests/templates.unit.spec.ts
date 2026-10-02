import { expect, test } from '@playwright/test';

import { documentationOf, expressionOf, type Element } from '@core/model/index';
import { buildCatalog, getCatalog, setCatalog, type TypeCatalog } from '@core/notation';
import { fromModdleYaml } from '@core/notation/moddlePackage';
import { Study, studyInternals } from '@canvas/study/Study.ts';
import type { SceneEdge, SceneNode } from '@canvas/study/scene.ts';

import { loadSchemaModels, studyModel } from '@tests/schemas';

/**
 * A template, dropped (`study/templates.ts`): its elements laid out inside the shape it drops as, and an id the
 * document already holds moved aside, with the code that names it following.
 */

const LOOP_SCHEMA = `
name: loop
prefix: loop
uri: http://example.org/schemas/loop/v1
templates:
  - description: Work until the gate says stop.
    elements:
      Loop:
        type: SubProcess
        documentation: Gate decides when Work stops.
        loopCharacteristics:
          type: StandardLoopCharacteristics
          loopCondition: Gate = null
        flowElements:
          Work:
            type: Task
            name: Work, then ask {Gate}
            bounds: 100 100 100 80
          Gate:
            type: ExclusiveGateway
            name: Gate
            bounds: 260 115 50 50
          F1:
            sourceRef: Work
            targetRef: Gate
            waypoint: 200,140 260,140
          F2:
            sourceRef: Gate
            targetRef: Work
            conditionExpression: state._meta.reached.Gate < 3
            waypoint: 285,165 285,220 150,220 150,180
`;

/** A study whose document holds one task, under `id`. */
function holding(id: string): Study {
  return Study.of(studyModel(`id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    ${id}:
      type: Task
      bounds: 100 400 100 80
`));
}

const node = (study: Study, id: string): SceneNode => studyInternals(study).scene.elementsById.get(id) as SceneNode;

let shipped: TypeCatalog;
test.beforeAll(() => {
  shipped = getCatalog();
  setCatalog(buildCatalog([...loadSchemaModels(), fromModdleYaml(LOOP_SCHEMA, 'loop.moddle.yaml')]));
});
test.afterAll(() => setCatalog(shipped));

test('a template drops as its shape, closed, its elements inside where its drawing puts them and its ids kept, as one commit', () => {
  const study = holding('Other');

  expect(study.add({ template: 'loop::template:1', at: { x: 700, y: 200 } })).toMatchObject({ ok: true, id: 'Loop' });

  const loop = node(study, 'Loop');
  expect(loop.isExpanded).toBe(false);
  expect(loop.children.map((child) => child.id).sort()).toEqual(['F1', 'F2', 'Gate', 'Work']);
  expect((node(study, 'F2') as unknown as SceneEdge).waypoints, 'a flow keeps the route its drawing gives it')
    .toEqual([{ x: 285, y: 165 }, { x: 285, y: 220 }, { x: 150, y: 220 }, { x: 150, y: 180 }]);
  expect(study.revision).toBe(1);

  // Once the copy holding them is gone, the template's own ids are free again.
  study.remove({ ids: ['Loop'] });
  expect(study.add({ template: 'loop::template:1', at: { x: 700, y: 200 } })).toMatchObject({ ok: true, id: 'Loop' });
  expect(node(study, 'Loop').children.map((child) => child.id).sort()).toEqual(['F1', 'F2', 'Gate', 'Work']);
});

test('a held id is suffixed, and only code that names it follows: expressions and placeholders, not prose', () => {
  const study = holding('Gate');

  study.add({ template: 'loop::template:1', at: { x: 700, y: 200 } });

  const loop = node(study, 'Loop');
  const gate = loop.children.find((child) => child.type === 'bpmn:ExclusiveGateway')!.element;
  const work = node(study, 'Work').element;
  const back = node(study, 'F2').element;
  expect(gate.id).toMatch(/^Gate_\w+$/);
  expect(expressionOf(back.conditionExpression)?.body).toBe(`state._meta.reached.${gate.id} < 3`);
  expect(expressionOf((loop.element.loopCharacteristics as Element).loopCondition)?.body).toBe(`${gate.id} = null`);
  expect(work.name).toBe(`Work, then ask {${gate.id}}`);
  expect(gate.name).toBe('Gate');
  expect(documentationOf(loop.element)).toBe('Gate decides when Work stops.');
});
