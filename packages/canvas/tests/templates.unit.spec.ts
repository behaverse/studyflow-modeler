import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { buildCatalog, getCatalog, setCatalog, type TypeCatalog } from '@core/notation';
import { fromModdleYaml } from '@core/notation/moddlePackage';
import { Study, studyInternals } from '@canvas/study/Study.ts';
import type { SceneEdge, SceneNode } from '@canvas/study/scene.ts';

import { freshModdle, loadSchemaModels } from '@tests/schemas';

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
            conditionExpression: state.trace.count('Gate') < 3
            waypoint: 285,165 285,220 150,220 150,180
`;

/** A study whose document holds one task, under `id`. */
function holding(id: string): Study {
  return Study.fromDefinitions(studyflowToDefinitions(`id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    ${id}:
      type: Task
      bounds: 100 400 100 80
`, freshModdle()));
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
});

test('a held id is suffixed, and only code that names it follows: expressions and placeholders, not prose', () => {
  const study = holding('Gate');

  study.add({ template: 'loop::template:1', at: { x: 700, y: 200 } });

  const loop = node(study, 'Loop');
  const gate = loop.children.find((child) => child.type === 'bpmn:ExclusiveGateway')!.businessObject as any;
  const work = node(study, 'Work').businessObject as any;
  const back = node(study, 'F2').businessObject as any;
  expect(gate.id).toMatch(/^Gate_\w+$/);
  expect(back.conditionExpression.body).toBe(`state.trace.count('${gate.id}') < 3`);
  expect(work.name).toBe(`Work, then ask {${gate.id}}`);
  expect(gate.name).toBe('Gate');
  expect((loop.businessObject as any).documentation[0].text).toBe('Gate decides when Work stops.');
});
