import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { importDefinitions } from '@canvas/index.ts';
import type { Scene, SceneEdge, SceneElement, SceneNode } from '@canvas/index.ts';

import { loadSchemaModels } from './schemas';
import { exampleXml } from './utils';

/**
 * P1 read-only import (`@canvas/model/import`): a `bpmn:Definitions` moddle tree
 * that already carries DI becomes a scene graph. We parse the XML embedded in the
 * shipped example PNGs with `bpmn-moddle` directly (same path the runner uses) and
 * assert the scene mirrors the DI exactly — one node per `BPMNShape` at its
 * `dc:Bounds`, one edge per `BPMNEdge` through its `di:waypoint`, endpoints joined.
 */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

function freshModdle(): any {
  return new BpmnModdle(structuredClone(packages)) as any;
}

async function sceneOf(filename: string): Promise<{ scene: Scene; definitions: any }> {
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(exampleXml(filename));
  const scene = importDefinitions(definitions, { onWarning: () => {} });
  return { scene, definitions };
}

/** Every DI shape and edge across every diagram/plane, in document order. */
function diItems(definitions: any): { shapes: any[]; edges: any[] } {
  const shapes: any[] = [];
  const edges: any[] = [];
  for (const diagram of definitions.diagrams ?? []) {
    const plane = diagram.plane;
    if (!plane) continue;
    for (const pe of plane.planeElement ?? []) {
      if (pe.$type === 'bpmndi:BPMNShape') shapes.push(pe);
      else if (pe.$type === 'bpmndi:BPMNEdge') edges.push(pe);
    }
  }
  return { shapes, edges };
}

function nodesOf(scene: Scene): SceneNode[] {
  return [...scene.elementsById.values()].filter(
    (el): el is SceneNode => (el as SceneElement).kind === 'node',
  );
}

function edgesOf(scene: Scene): SceneEdge[] {
  return [...scene.elementsById.values()].filter(
    (el): el is SceneEdge => (el as SceneElement).kind === 'edge',
  );
}

// A simple flow, drawn_loop, a choreography, a pool with data flow, and nested subprocess planes.
const EXAMPLES = [
  'cognitive_battery.studyflow.png',
  'drawn_loop.studyflow.png',
  'choreography_demo.studyflow.png',
  'agent_eval_pool.studyflow.png',
  'sklearn_pipeline.studyflow.png',
  'kitchensink.studyflow.png',
] as const;

// kitchensink is a pure element showcase with no connections; the rest carry flows.
const FLOW_EXAMPLES = EXAMPLES.filter((f) => f !== 'kitchensink.studyflow.png');

test.describe('canvas import: DI → scene graph', () => {
  for (const filename of EXAMPLES) {
    test(`${filename}: one node per shape, one edge per edge`, async () => {
      const { scene, definitions } = await sceneOf(filename);
      const { shapes, edges } = diItems(definitions);

      expect(shapes.length, `${filename} draws shapes`).toBeGreaterThan(0);
      expect(nodesOf(scene).length, `${filename} node count`).toBe(shapes.length);
      expect(edgesOf(scene).length, `${filename} edge count`).toBe(edges.length);
    });

    test(`${filename}: every node's bounds equal its dc:Bounds`, async () => {
      const { scene, definitions } = await sceneOf(filename);
      const { shapes } = diItems(definitions);

      for (const shape of shapes) {
        const id = shape.bpmnElement?.id as string;
        const node = scene.elementsById.get(id);
        expect(node, `${filename}: shape ${id} yields a scene element`).toBeTruthy();
        expect(node!.kind).toBe('node');
        const n = node as SceneNode;
        expect({ x: n.x, y: n.y, width: n.width, height: n.height }).toEqual({
          x: shape.bounds.x,
          y: shape.bounds.y,
          width: shape.bounds.width,
          height: shape.bounds.height,
        });
        // Geometry writes through the backing DI moddle object (design §1).
        expect(n.di).toBe(shape);
        expect(n.businessObject).toBe(shape.bpmnElement);
      }
    });

    test(`${filename}: every edge's waypoints equal its di:waypoint`, async () => {
      const { scene, definitions } = await sceneOf(filename);
      const { edges } = diItems(definitions);

      for (const di of edges) {
        const id = di.bpmnElement?.id as string;
        const edge = scene.elementsById.get(id);
        expect(edge, `${filename}: edge ${id} yields a scene element`).toBeTruthy();
        expect(edge!.kind).toBe('edge');
        const e = edge as SceneEdge;
        const expected = (di.waypoint ?? []).map((wp: any) => ({ x: wp.x, y: wp.y }));
        expect(e.waypoints).toEqual(expected);
        expect(e.di).toBe(di);
      }
    });

  }

  for (const filename of FLOW_EXAMPLES) {
    test(`${filename}: sequence flows resolve source and target`, async () => {
      const { scene } = await sceneOf(filename);
      const flows = edgesOf(scene).filter((e) => e.type === 'bpmn:SequenceFlow');
      expect(flows.length, `${filename} has sequence flows`).toBeGreaterThan(0);
      for (const flow of flows) {
        expect(flow.source, `${filename}: ${flow.id} source resolved`).toBeTruthy();
        expect(flow.target, `${filename}: ${flow.id} target resolved`).toBeTruthy();
        // The endpoint is the scene node for the flow's sourceRef/targetRef business object.
        expect(flow.source!.businessObject).toBe(flow.businessObject.sourceRef);
        expect(flow.target!.businessObject).toBe(flow.businessObject.targetRef);
        // Reciprocal wiring.
        expect(flow.source!.outgoing).toContain(flow);
        expect(flow.target!.incoming).toContain(flow);
      }
    });
  }

  test('drawn_loop: exact topology', async () => {
    const { scene } = await sceneOf('drawn_loop.studyflow.png');
    expect(nodesOf(scene).length).toBe(4); // Start, Say, Gate, End
    expect(edgesOf(scene).length).toBe(4); // F1, F2, Again, Exit

    const start = scene.elementsById.get('Start') as SceneNode;
    expect(start.type).toBe('bpmn:StartEvent');
    expect({ x: start.x, y: start.y, width: start.width, height: start.height })
      .toEqual({ x: 57, y: 52, width: 36, height: 36 });

    const gate = scene.elementsById.get('Gate') as SceneNode;
    expect(gate.isMarkerVisible).toBe(true);

    const again = scene.elementsById.get('Again') as SceneEdge;
    expect(again.waypoints).toEqual([
      { x: 375, y: 95 },
      { x: 375, y: 140 },
      { x: 225, y: 140 },
      { x: 225, y: 110 },
    ]);
  });

  test('kitchensink: every diagram becomes a plane; root plane is the process', async () => {
    const { scene, definitions } = await sceneOf('kitchensink.studyflow.png');
    const diagrams = definitions.diagrams ?? [];
    expect(diagrams.length).toBeGreaterThan(1); // main plane + (empty) subprocess sub-planes
    expect(scene.planes.length).toBe(diagrams.length);
    expect(scene.rootPlane).toBe(scene.planes[0]);
    expect(scene.rootPlane.businessObject.$type).toBe('bpmn:Process');
    // Root-plane top-level nodes have no containing node.
    for (const node of nodesOf(scene)) expect(node.parent).toBeUndefined();
  });

  test('sklearn_pipeline: sub-plane children nest under their subprocess node', async () => {
    const { scene, definitions } = await sceneOf('sklearn_pipeline.studyflow.png');
    expect((definitions.diagrams ?? []).length).toBeGreaterThan(1);

    // `select_model` is an expanded subprocess drawn in the root plane with its own sub-plane.
    const subprocess = scene.elementsById.get('select_model') as SceneNode;
    expect(subprocess?.kind).toBe('node');

    const nested = nodesOf(scene).filter((n) => n.parent === subprocess);
    expect(nested.length).toBeGreaterThan(0);
    // Each nested node's business object descends from the subprocess business object.
    for (const child of nested) {
      let bo: any = child.businessObject.$parent;
      let reached = false;
      while (bo) {
        if (bo === subprocess.businessObject) { reached = true; break; }
        bo = bo.$parent;
      }
      expect(reached, `${child.id} descends from select_model`).toBe(true);
    }
    // The subprocess also lists them among its children.
    for (const child of nested) expect(subprocess.children).toContain(child);
  });
});
