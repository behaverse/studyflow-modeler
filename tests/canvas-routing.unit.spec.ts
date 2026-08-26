import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import {
  Canvas,
  centerOf,
  containsPoint,
  cropPoint,
  cropWaypoints,
  edgesAffectedBy,
  isOrthogonal,
  outlineFor,
  outlinePoint,
  rerouteEdge,
  route,
  routeCenters,
  routeEdge,
  setDocument,
  type CroppableShape,
} from '@canvas/index.ts';
import type { Point, SceneEdge, SceneNode } from '@canvas/model/scene.ts';

import { loadSchemaModels } from './schemas';

/**
 * P4 orthogonal routing + endpoint cropping (design §3 `routing/*`, §6 P4).
 *
 * Two halves:
 *
 * - **pure geometry** — `route()` / `cropWaypoints()` take plain bounds objects
 *   (`SceneNode` satisfies the shape structurally), so these assertions need no
 *   document at all. The contract: every segment is axis-aligned, and each endpoint
 *   lands exactly ON the silhouette the renderer draws — a circle for an event, a
 *   diamond for a gateway, a rectangle for a task — never at the centre, never
 *   outside.
 * - **canvas wiring** — `Canvas.rerouteEdges()` writes the routed waypoints through
 *   to the live `di:waypoint` moddle objects (the P3 write-through contract), so
 *   re-serializing the SAME `Definitions` tree emits them.
 *
 * jsdom via `setDocument`, same setup as the other `canvas-*` specs.
 */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const dom = new JSDOM('<!doctype html><html><body></body></html>');
setDocument(dom.window.document as unknown as Document);

// --- shape fixtures ----------------------------------------------------------

/** A 100×80 task (design §2 activity geometry). */
function task(x: number, y: number, type = 'bpmn:Task'): CroppableShape {
  return { x, y, width: 100, height: 80, type };
}

/** A 36×36 event — the circle whose crop radius must come out as 18. */
function event(x: number, y: number, type = 'bpmn:StartEvent'): CroppableShape {
  return { x, y, width: 36, height: 36, type };
}

/** A 50×50 gateway diamond. */
function gateway(x: number, y: number): CroppableShape {
  return { x, y, width: 50, height: 50, type: 'bpmn:ExclusiveGateway' };
}

const EPS = 1e-6;

// --- geometry assertions -----------------------------------------------------

/** Every segment axis-aligned, and no zero-length hops. */
function expectOrthogonal(points: readonly Point[]): void {
  expect(points.length).toBeGreaterThanOrEqual(2);
  expect(isOrthogonal(points)).toBe(true);
  for (let i = 0; i < points.length - 1; i += 1) {
    const d = Math.abs(points[i].x - points[i + 1].x) + Math.abs(points[i].y - points[i + 1].y);
    expect(d).toBeGreaterThan(EPS);
  }
}

/**
 * `point` sits exactly on `shape`'s outline: inside (or on) it, but a nudge further
 * along the outward ray leaves it. Works for every convex silhouette the cropper
 * knows, so it is the one assertion used for circle, diamond, rect and data shapes.
 */
function expectOnOutline(shape: CroppableShape, point: Point): void {
  const centre = centerOf(shape);
  expect(containsPoint(shape, point)).toBe(true);
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  const len = Math.hypot(dx, dy);
  expect(len).toBeGreaterThan(EPS); // not the centre
  const out = { x: point.x + (dx / len) * 0.5, y: point.y + (dy / len) * 0.5 };
  expect(containsPoint(shape, out)).toBe(false);
}

// --- outline selection -------------------------------------------------------

test('outlineFor maps each drawer category to the silhouette it paints', () => {
  expect(outlineFor('bpmn:StartEvent')).toBe('ellipse');
  expect(outlineFor('bpmn:EndEvent')).toBe('ellipse');
  expect(outlineFor('bpmn:BoundaryEvent')).toBe('ellipse');
  expect(outlineFor('bpmn:ExclusiveGateway')).toBe('diamond');
  expect(outlineFor('bpmn:EventBasedGateway')).toBe('diamond');
  expect(outlineFor('bpmn:DataObjectReference')).toBe('dataObject');
  expect(outlineFor('bpmn:DataStoreReference')).toBe('dataStore');
  expect(outlineFor('bpmn:UserTask')).toBe('rect');
  expect(outlineFor('bpmn:SubProcess')).toBe('rect');
  expect(outlineFor('bpmn:ChoreographyTask')).toBe('rect');
  expect(outlineFor('bpmn:Participant')).toBe('rect');
  expect(outlineFor('bpmn:Group')).toBe('rect');
  expect(outlineFor(undefined)).toBe('rect');
});

// --- cropping ----------------------------------------------------------------

test('cropPoint puts a rect endpoint on the border it faces', () => {
  const shape = task(200, 100);
  const right = cropPoint(shape, { x: 500, y: 140 });
  expect(right).toEqual({ x: 300, y: 140 });
  expectOnOutline(shape, right);

  const top = cropPoint(shape, { x: 250, y: -50 });
  expect(top).toEqual({ x: 250, y: 100 });
  expectOnOutline(shape, top);
});

test('cropPoint puts an event endpoint on the r=18 circle', () => {
  const shape = event(100, 100);
  const centre = centerOf(shape); // (118, 118)

  for (const towards of [
    { x: 400, y: 118 },
    { x: 118, y: -100 },
    { x: -100, y: 118 },
    { x: 400, y: 400 },
  ]) {
    const p = cropPoint(shape, towards);
    expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(18, 6);
    expectOnOutline(shape, p);
  }

  // The horizontal dock is the rightmost point of the circle, not of the box.
  expect(cropPoint(shape, { x: 400, y: 118 })).toEqual({ x: 136, y: 118 });
  // A diagonal dock is strictly INSIDE the bounding box (a rect crop would not be).
  const diagonal = cropPoint(shape, { x: 400, y: 400 });
  expect(diagonal.x).toBeLessThan(136);
  expect(diagonal.y).toBeLessThan(136);
});

test('cropPoint puts a gateway endpoint on the diamond, not the bounding box', () => {
  const shape = gateway(200, 200);
  const centre = centerOf(shape); // (225, 225)
  const rhombus = (p: Point): number =>
    Math.abs(p.x - centre.x) / 25 + Math.abs(p.y - centre.y) / 25;

  // Along an axis the diamond touches the box (the tips).
  const east = cropPoint(shape, { x: 600, y: 225 });
  expect(east).toEqual({ x: 250, y: 225 });
  expect(rhombus(east)).toBeCloseTo(1, 6);

  // Off-axis it is pulled well inside the box — the defining difference from a rect.
  const corner = cropPoint(shape, { x: 600, y: 600 });
  expect(rhombus(corner)).toBeCloseTo(1, 6);
  expect(corner.x).toBeLessThan(250);
  expect(corner.y).toBeLessThan(250);
  expectOnOutline(shape, corner);

  // Same direction against a rect of the same box lands on the box corner instead.
  const asRect = cropPoint({ ...shape, type: 'bpmn:Task' }, { x: 600, y: 600 });
  expect(asRect).toEqual({ x: 250, y: 250 });
});

test('cropPoint follows the data-object dog ear and the data-store cylinder', () => {
  const page: CroppableShape = { x: 0, y: 0, width: 36, height: 50, type: 'bpmn:DataObjectReference' };
  const fold = Math.min(36, 50) * 0.32;
  // Straight up from the centre still exits through the flat part of the top edge.
  expect(cropPoint(page, { x: 18, y: -100 })).toEqual({ x: 18, y: 0 });
  // Towards the folded corner the endpoint lands on the fold line, inside the box.
  const dogEar = cropPoint(page, { x: 200, y: -200 });
  expect(dogEar.x - dogEar.y).toBeCloseTo(36 - fold - 0, 6);
  expectOnOutline(page, dogEar);
  expect(containsPoint(page, { x: 35, y: 1 })).toBe(false); // the folded-away corner

  const store: CroppableShape = { x: 0, y: 0, width: 50, height: 50, type: 'bpmn:DataStoreReference' };
  // The flanks are straight, so a side dock is exactly the box edge…
  expect(cropPoint(store, { x: 200, y: 25 })).toEqual({ x: 50, y: 25 });
  // …while the lid is an arc whose apex is the top of the box.
  const lid = cropPoint(store, { x: 25, y: -200 });
  expect(lid.x).toBe(25);
  expect(lid.y).toBeCloseTo(0, 9);
  // The box corner is outside the cylinder.
  expect(containsPoint(store, { x: 0.5, y: 0.5 })).toBe(false);
  expectOnOutline(store, cropPoint(store, { x: 200, y: -200 }));
});

test('cropWaypoints trims both ends along their own segment, keeping them axis-aligned', () => {
  const source = event(100, 100);
  const target = task(300, 100);
  // A deliberately off-centre horizontal lane: cropping must keep y untouched.
  const raw: Point[] = [{ x: 118, y: 125 }, { x: 350, y: 125 }];
  const cropped = cropWaypoints(raw, source, target);

  expect(cropped[0].y).toBe(125);
  expect(cropped[1].y).toBe(125);
  expectOnOutline(source, cropped[0]);
  expect(cropped[1]).toEqual({ x: 300, y: 125 });
  expectOrthogonal(cropped);
  // The input list is never mutated.
  expect(raw[0]).toEqual({ x: 118, y: 125 });
});

test('cropWaypoints passes degenerate input through', () => {
  expect(cropWaypoints([], task(0, 0), task(200, 0))).toEqual([]);
  const single = [{ x: 5, y: 5 }];
  expect(cropWaypoints(single, task(0, 0), task(200, 0))).toEqual(single);
  // No shape on one end ⇒ that end is left alone.
  const points: Point[] = [{ x: 50, y: 40 }, { x: 400, y: 40 }];
  expect(cropWaypoints(points, undefined, task(300, 0))[0]).toEqual({ x: 50, y: 40 });
});

test('outlinePoint refuses an anchor that is not inside the shape', () => {
  const shape = event(100, 100);
  expect(outlinePoint(shape, { x: 400, y: 400 }, { x: 500, y: 400 })).toBeUndefined();
  expect(outlinePoint(shape, { x: 118, y: 118 }, { x: 118, y: 118 })).toBeUndefined();
  // …and cropPoint falls back to the centre ray rather than inventing a point.
  const fallback = cropPoint(shape, { x: 500, y: 118 }, { x: 400, y: 400 });
  expect(fallback).toEqual({ x: 136, y: 118 });
});

// --- routing -----------------------------------------------------------------

test('a horizontal neighbour pair routes as one straight segment', () => {
  const source = event(100, 100); // centre (118, 118)
  const target = task(200, 80); //  centre (250, 120)
  const points = route(source, target);

  expect(points).toHaveLength(2);
  expectOrthogonal(points);
  expect(points[0].y).toBeCloseTo(119, 6);
  expect(points[1].y).toBeCloseTo(119, 6);
  // Cropped onto each outline: the circle (r=18) and the task's left edge.
  expectOnOutline(source, points[0]);
  expect(points[1]).toEqual({ x: 200, y: 119 });
  expect(Math.hypot(points[0].x - 118, points[0].y - 118)).toBeCloseTo(18, 6);
});

test('perfectly aligned neighbours route dead straight through both centres', () => {
  const source = task(0, 100);
  const target = task(300, 100);
  const points = route(source, target);
  expect(points).toEqual([{ x: 100, y: 140 }, { x: 300, y: 140 }]);

  // Vertically stacked, likewise.
  const below = route(task(0, 0), task(0, 200));
  expect(below).toEqual([{ x: 50, y: 80 }, { x: 50, y: 200 }]);
  expectOrthogonal(below);
});

test('an off-centre horizontal pair routes as a Z through the middle of the gap', () => {
  const source = task(0, 0); //   centre (50, 40), right edge 100
  const target = task(200, 60); // centre (250, 100), left edge 200
  const points = route(source, target);

  expect(points).toHaveLength(4);
  expectOrthogonal(points);
  expect(points[0]).toEqual({ x: 100, y: 40 }); // out of the source's right edge
  expect(points[3]).toEqual({ x: 200, y: 100 }); // into the target's left edge
  // The vertical jog sits in the gap, so it crosses neither shape.
  expect(points[1].x).toBe(150);
  expect(points[2].x).toBe(150);
  expectOnOutline(source, points[0]);
  expectOnOutline(target, points[3]);
});

test('a diagonal pair routes as a single elbow along the dominant axis', () => {
  const source = task(0, 0); //     centre (50, 40)
  const target = task(400, 300); // centre (450, 340)
  const points = route(source, target);

  expect(points).toHaveLength(3);
  expectOrthogonal(points);
  expect(points[0]).toEqual({ x: 100, y: 40 }); // leaves horizontally (|dx| > |dy|)
  expect(points[1]).toEqual({ x: 450, y: 40 });
  expect(points[2]).toEqual({ x: 450, y: 300 }); // enters the target's top edge

  // Dominant vertical ⇒ the elbow flips.
  const down = route(task(0, 0), task(150, 400));
  expect(down).toHaveLength(3);
  expectOrthogonal(down);
  expect(down[0]).toEqual({ x: 50, y: 80 }); // leaves vertically
  expect(down[2]).toEqual({ x: 150, y: 440 }); // enters the target's left edge
});

test('overlapping shapes route around through an outside lane', () => {
  const source = task(0, 0);
  const target = task(60, 30); // boxes overlap on both axes
  const points = route(source, target, { clearance: 20 });

  expectOrthogonal(points);
  expect(points.length).toBeGreaterThanOrEqual(3);
  // The traversal lane clears both boxes by the requested clearance.
  const lane = points[1];
  expect(lane.y).toBe(Math.max(80, 110) + 20);
  expectOnOutline(source, points[0]);
  expectOnOutline(target, points[points.length - 1]);
});

test('a self-connection loops out of the right flank and back into the top', () => {
  const shape = task(100, 100);
  const points = route(shape, shape, { clearance: 20 });

  expect(points).toHaveLength(5);
  expectOrthogonal(points);
  expect(points[0]).toEqual({ x: 200, y: 140 }); // right edge
  expect(points[1]).toEqual({ x: 220, y: 140 });
  expect(points[2]).toEqual({ x: 220, y: 80 });
  expect(points[4]).toEqual({ x: 175, y: 100 }); // back into the top edge
  expectOnOutline(shape, points[0]);
  expectOnOutline(shape, points[4]);
});

test('every relative placement yields an orthogonal, outline-cropped path', () => {
  const source = event(200, 200, 'bpmn:IntermediateThrowEvent');
  const placements: CroppableShape[] = [
    task(400, 190), // right
    task(0, 190), //   left
    task(170, 400), // below
    task(170, 0), //   above
    task(400, 400), // down-right
    task(0, 400), //   down-left
    task(400, 0), //   up-right
    task(0, 0), //     up-left
    gateway(230, 230), // overlapping
    gateway(400, 400), // diagonal, diamond target
  ];

  for (const target of placements) {
    const points = route(source, target);
    expectOrthogonal(points);
    expect(points.length).toBeLessThanOrEqual(5);
    expectOnOutline(source, points[0]);
    expectOnOutline(target, points[points.length - 1]);
  }
});

test('routeCenters is the uncropped path and route() is symmetric under reversal', () => {
  const source = task(0, 0);
  const target = task(300, 0);
  const raw = routeCenters(source, target);
  expect(raw).toEqual([{ x: 50, y: 40 }, { x: 350, y: 40 }]);
  expect(route(source, target, { crop: false })).toEqual(raw);

  // The straight lane is the midpoint of the two centres, so swapping the ends
  // mirrors the path instead of shifting it.
  const a = route(event(100, 100), task(200, 80));
  const b = route(task(200, 80), event(100, 100));
  expect(a[0].y).toBeCloseTo(b[1].y, 6);
  expect(a[1].y).toBeCloseTo(b[0].y, 6);
});

// --- scene helpers -----------------------------------------------------------

/** A minimal scene node (only the fields routing reads). */
function node(id: string, type: string, x: number, y: number, w: number, h: number): SceneNode {
  return {
    id,
    kind: 'node',
    type,
    businessObject: { $type: type, id },
    x, y, width: w, height: h,
    children: [],
    incoming: [],
    outgoing: [],
  };
}

function connect(id: string, source: SceneNode, target: SceneNode, waypoints: Point[]): SceneEdge {
  const edge: SceneEdge = {
    id,
    kind: 'edge',
    type: 'bpmn:SequenceFlow',
    businessObject: { $type: 'bpmn:SequenceFlow', id },
    waypoints,
    source,
    target,
  };
  source.outgoing.push(edge);
  target.incoming.push(edge);
  return edge;
}

test('rerouteEdge rewrites an edge from its endpoints and is idempotent', () => {
  const a = node('A', 'bpmn:Task', 0, 0, 100, 80);
  const b = node('B', 'bpmn:Task', 300, 0, 100, 80);
  const edge = connect('F', a, b, [{ x: 17, y: 3 }, { x: 333, y: 71 }]);

  expect(rerouteEdge(edge)).toBe(true);
  expect(edge.waypoints).toEqual([{ x: 100, y: 40 }, { x: 300, y: 40 }]);
  // A second pass changes nothing, so a re-route never churns the revision.
  expect(rerouteEdge(edge)).toBe(false);

  // Move the target: the helper re-derives the whole path.
  b.y = 300;
  expect(rerouteEdge(edge)).toBe(true);
  expectOrthogonal(edge.waypoints);
  expect(edge.waypoints[edge.waypoints.length - 1]).toEqual({ x: 350, y: 300 });
});

test('routeEdge leaves a dangling connection alone', () => {
  const a = node('A', 'bpmn:Task', 0, 0, 100, 80);
  const edge: SceneEdge = {
    id: 'F', kind: 'edge', type: 'bpmn:SequenceFlow',
    businessObject: { $type: 'bpmn:SequenceFlow', id: 'F' },
    waypoints: [{ x: 0, y: 0 }],
    source: a,
  };
  expect(routeEdge(edge)).toBeUndefined();
  expect(rerouteEdge(edge)).toBe(false);
  expect(edge.waypoints).toEqual([{ x: 0, y: 0 }]);
});

test('edgesAffectedBy collects a node\'s edges, its children\'s, and listed edges', () => {
  const pool = node('Pool', 'bpmn:Participant', 0, 0, 600, 300);
  const inner = node('Inner', 'bpmn:Task', 50, 50, 100, 80);
  const outer = node('Outer', 'bpmn:Task', 400, 50, 100, 80);
  pool.children.push(inner);
  inner.parent = pool;
  const flow = connect('F', inner, outer, []);

  expect(edgesAffectedBy([pool])).toEqual([flow]); // reached through the child
  expect(edgesAffectedBy([inner, outer])).toEqual([flow]); // listed once
  expect(edgesAffectedBy([flow])).toEqual([flow]);
  expect(edgesAffectedBy([])).toEqual([]);
});

// --- canvas wiring + DI writeback -------------------------------------------

const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="Task"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="400" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="180" y="140" /><di:waypoint x="200" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="300" y="120" /><di:waypoint x="400" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

function freshModdle(): any {
  return new BpmnModdle(structuredClone(packages)) as any;
}

async function load(): Promise<{ canvas: Canvas; definitions: any; moddle: any }> {
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(FIXTURE_XML);
  const canvas = new Canvas();
  canvas.importDefinitions(definitions);
  return { canvas, definitions, moddle };
}

function diWaypoints(definitions: any, id: string): Point[] {
  for (const diagram of definitions.diagrams ?? []) {
    for (const pe of diagram.plane?.planeElement ?? []) {
      if (pe.$type === 'bpmndi:BPMNEdge' && pe.bpmnElement?.id === id) {
        return (pe.waypoint ?? []).map((w: any) => ({ x: w.x, y: w.y }));
      }
    }
  }
  return [];
}

test('Canvas.rerouteEdges routes the affected edges and writes di:waypoint through', async () => {
  const { canvas, definitions, moddle } = await load();
  const scene = canvas.getScene()!;
  const taskNode = scene.elementsById.get('Task_1') as SceneNode;
  const flow1 = scene.elementsById.get('Flow_1') as SceneEdge;

  expect(flow1.waypoints).toHaveLength(3); // the document's hand-drawn kink
  const revision = scene.revision;

  const changed = canvas.rerouteEdges([taskNode]);
  expect(changed.map((e) => e.id).sort()).toEqual(['Flow_1', 'Flow_2']);
  expect(scene.revision).toBeGreaterThan(revision);

  // Scene: straight, orthogonal, cropped onto both outlines.
  expect(flow1.waypoints).toHaveLength(2);
  expectOrthogonal(flow1.waypoints);
  expect(flow1.waypoints[0].y).toBe(119);
  expect(Math.hypot(flow1.waypoints[0].x - 118, flow1.waypoints[0].y - 118)).toBeCloseTo(18, 6);
  expect(flow1.waypoints[1]).toEqual({ x: 200, y: 119 });

  // DI: the SAME moddle objects now carry the routed geometry…
  expect(diWaypoints(definitions, 'Flow_1')).toEqual(flow1.waypoints);
  const flow2 = diWaypoints(definitions, 'Flow_2');
  expect(flow2[0]).toEqual({ x: 300, y: 119 }); // the task's right edge
  expect(Math.hypot(flow2[1].x - 418, flow2[1].y - 118)).toBeCloseTo(18, 6); // the end event's circle

  // …so serializing this very tree and re-parsing it round-trips the route.
  const { xml } = await moddle.toXML(definitions);
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  expect(diWaypoints(reloaded, 'Flow_1')).toHaveLength(2);
  expect(diWaypoints(reloaded, 'Flow_1')[1]).toEqual({ x: 200, y: 119 });
  // Untouched geometry stays untouched.
  expect(reloaded.diagrams[0].plane.planeElement
    .find((pe: any) => pe.bpmnElement?.id === 'Task_1').bounds.x).toBe(200);
});

test('Canvas.rerouteEdges defaults to the selection and reports no-ops honestly', async () => {
  const { canvas } = await load();
  const scene = canvas.getScene()!;
  const taskNode = scene.elementsById.get('Task_1') as SceneNode;

  canvas.getSelection().select(taskNode);
  expect(canvas.rerouteEdges().map((e) => e.id).sort()).toEqual(['Flow_1', 'Flow_2']);
  // Already routed ⇒ nothing changes and the revision holds still.
  const revision = scene.revision;
  expect(canvas.rerouteEdges()).toEqual([]);
  expect(scene.revision).toBe(revision);

  // Empty selection ⇒ nothing to do.
  canvas.getSelection().clear();
  expect(canvas.rerouteEdges()).toEqual([]);
});

test('a moved shape re-routes to its new position (drag keeps the P3 docking follow)', async () => {
  const { canvas, definitions } = await load();
  const scene = canvas.getScene()!;
  const taskNode = scene.elementsById.get('Task_1') as SceneNode;
  const flow1 = scene.elementsById.get('Flow_1') as SceneEdge;

  // A P3 move: the endpoints merely follow the shape, kink and all.
  canvas.getWriteback()!.setNodeBounds(taskNode, { x: 260, y: 300 });
  expect(flow1.waypoints).toHaveLength(3);

  const changed = canvas.rerouteEdges(taskNode);
  expect(changed).toContain(flow1);
  expectOrthogonal(flow1.waypoints);
  // Start (118, 118) → task centre (310, 340): separated on both axes and taller
  // than it is wide, so the elbow leaves the event downwards and enters the task's
  // left edge.
  expect(flow1.waypoints).toEqual([
    { x: 118, y: 136 },
    { x: 118, y: 340 },
    { x: 260, y: 340 },
  ]);
  expect(diWaypoints(definitions, 'Flow_1')).toEqual(flow1.waypoints);
});
