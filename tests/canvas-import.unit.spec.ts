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

async function sceneOfXml(xml: string): Promise<{ scene: Scene; definitions: any }> {
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(xml);
  const scene = importDefinitions(definitions, { onWarning: () => {} });
  return { scene, definitions };
}

async function sceneOf(filename: string): Promise<{ scene: Scene; definitions: any }> {
  return sceneOfXml(exampleXml(filename));
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

/**
 * Pool/lane containment is NOT expressed by the moddle `$parent` chain: a
 * `bpmn:Participant` reaches its flow nodes through `processRef` and a `bpmn:Lane`
 * through `flowNodeRef`, both of which are references, not parents. A `$parent`-only
 * walk therefore leaves `Participant.children` / `Lane.children` empty — which is what
 * made a pool drag abandon its own contents.
 */
test.describe('canvas import: pool / lane containment', () => {
  test('spirit2025: lanes nest under their pool and flow nodes under their lane', async () => {
    const { scene } = await sceneOf('spirit2025.studyflow.png');
    const pool = scene.elementsById.get('Participant_SPIRIT') as SceneNode;
    expect(pool?.kind).toBe('node');
    expect(pool.parent).toBeUndefined();

    const lanes = nodesOf(scene).filter((n) => n.type === 'bpmn:Lane');
    expect(lanes.length).toBe(4);
    for (const lane of lanes) {
      expect(lane.parent, `${lane.id} nests under the pool`).toBe(pool);
      expect(pool.children).toContain(lane);
    }

    // Every flow node listed in a `flowNodeRef` is that lane's child (and, transitively,
    // inside the pool) — never a stray top-level element.
    for (const lane of lanes) {
      const refs: any[] = (lane.businessObject as any).flowNodeRef ?? [];
      expect(refs.length, `${lane.id} has flowNodeRefs`).toBeGreaterThan(0);
      for (const ref of refs) {
        const child = scene.elementsById.get(ref.id) as SceneNode;
        expect(child?.kind, `${ref.id} is drawn`).toBe('node');
        expect(child.parent, `${ref.id} nests under ${lane.id}`).toBe(lane);
        expect(lane.children).toContain(child);
      }
    }

    // The pool is drawn inside-out relative to its contents, so nothing it encloses is
    // left dangling at the plane root.
    const strays = nodesOf(scene).filter((n) => n !== pool && n.parent === undefined);
    expect(strays.map((n) => n.id)).toEqual([]);
  });

  /**
   * A pool whose lanes omit `flowNodeRef` (it is optional, and several exporters skip
   * it). Membership then falls back to the drawn geometry: the smallest lane of that
   * pool containing the shape's centre.
   */
  const LANES_WITHOUT_REFS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_1" name="Pool" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Top" name="Top" />
      <bpmn:lane id="Lane_Bottom" name="Bottom" />
    </bpmn:laneSet>
    <bpmn:task id="Task_Top" name="Top task" />
    <bpmn:task id="Task_Bottom" name="Bottom task" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Top_di" bpmnElement="Lane_Top" isHorizontal="true">
        <dc:Bounds x="30" y="0" width="570" height="125" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Bottom_di" bpmnElement="Lane_Bottom" isHorizontal="true">
        <dc:Bounds x="30" y="125" width="570" height="125" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Top_di" bpmnElement="Task_Top">
        <dc:Bounds x="200" y="20" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Bottom_di" bpmnElement="Task_Bottom">
        <dc:Bounds x="200" y="145" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

  test('lanes without flowNodeRef: membership falls back to drawn containment', async () => {
    const { scene } = await sceneOfXml(LANES_WITHOUT_REFS_XML);
    const pool = scene.elementsById.get('Pool_1') as SceneNode;
    const top = scene.elementsById.get('Lane_Top') as SceneNode;
    const bottom = scene.elementsById.get('Lane_Bottom') as SceneNode;

    expect(top.parent).toBe(pool);
    expect(bottom.parent).toBe(pool);
    expect((scene.elementsById.get('Task_Top') as SceneNode).parent).toBe(top);
    expect((scene.elementsById.get('Task_Bottom') as SceneNode).parent).toBe(bottom);
  });

  test('a pool without lanes owns its flow nodes directly (processRef)', async () => {
    const { scene } = await sceneOfXml(
      LANES_WITHOUT_REFS_XML
        .replace(/<bpmn:laneSet[\s\S]*?<\/bpmn:laneSet>/, '')
        .replace(/<bpmndi:BPMNShape id="Lane_[\s\S]*?<\/bpmndi:BPMNShape>/g, ''),
    );
    const pool = scene.elementsById.get('Pool_1') as SceneNode;
    expect((scene.elementsById.get('Task_Top') as SceneNode).parent).toBe(pool);
    expect((scene.elementsById.get('Task_Bottom') as SceneNode).parent).toBe(pool);
  });
});
