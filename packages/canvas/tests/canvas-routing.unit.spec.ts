import { expect, test } from '@playwright/test';

import { centerOf, containsPoint, cropPoint, outlinePoint } from '@canvas/routing/crop.ts';
import type { CroppableShape } from '@canvas/routing/crop.ts';
import {
  isOrthogonal,
  isStraightRouted,
  orthogonalize,
  route,
  routeCenters,
  routeFor,
  straightRoute,
} from '@canvas/routing/orthogonal.ts';
import type { Point, SceneEdge, SceneNode } from '@canvas/model/scene.ts';

import { installDocument, loadCanvas, type Loaded } from './canvasHarness';

/**
 * Routing and docking. `route()` draws an orthogonal path of at most five points
 * between two shapes and crops each end onto the silhouette the renderer draws: a
 * circle for an event, a diamond for a gateway, a page or a cylinder for data, a
 * rectangle for the rest — never the centre, never outside. The geometry takes plain
 * bounds (`SceneNode` satisfies them), so most of this needs no document.
 */

installDocument();

// --- shape fixtures ----------------------------------------------------------

/** A 100×80 task. */
function task(x: number, y: number): CroppableShape {
  return { x, y, width: 100, height: 80, type: 'bpmn:Task' };
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

// --- cropping ----------------------------------------------------------------

test('cropPoint docks on the silhouette, where the walk from the centre toward the other end leaves it', () => {
  const circle = event(100, 100); // centre (118, 118), r = 18
  const diamond = gateway(200, 200); // centre (225, 225)
  const page: CroppableShape = { x: 0, y: 0, width: 36, height: 50, type: 'bpmn:DataObjectReference' };
  const store: CroppableShape = { x: 0, y: 0, width: 50, height: 50, type: 'bpmn:DataStoreReference' };
  const CASES: [label: string, shape: CroppableShape, towards: Point, dock: Point][] = [
    ['a task, facing right: its right edge', task(200, 100), { x: 500, y: 140 }, { x: 300, y: 140 }],
    ['a task, facing up: its top edge', task(200, 100), { x: 250, y: -50 }, { x: 250, y: 100 }],
    ['an event, level: the rightmost point of the circle', circle, { x: 400, y: 118 }, { x: 136, y: 118 }],
    ['an event, diagonally: on the circle, inside the box', circle, { x: 400, y: 400 }, { x: 118 + 18 / Math.SQRT2, y: 118 + 18 / Math.SQRT2 }],
    ['a gateway, level: the tip of the diamond', diamond, { x: 600, y: 225 }, { x: 250, y: 225 }],
    ['a gateway, diagonally: on the diamond, inside the box', diamond, { x: 600, y: 600 }, { x: 237.5, y: 237.5 }],
    ['the same box as a task, diagonally: its corner', { ...diamond, type: 'bpmn:Task' }, { x: 600, y: 600 }, { x: 250, y: 250 }],
    ['a data object, straight up: the flat part of the top edge', page, { x: 18, y: -100 }, { x: 18, y: 0 }],
    // The folded corner is cut off along x - y = 36 - 0.32 * 36.
    ['a data object, toward its folded corner: the fold', page, { x: 200, y: -200 }, { x: 32.077, y: 7.597 }],
    ['a data store, sideways: the straight flank', store, { x: 200, y: 25 }, { x: 50, y: 25 }],
    ['a data store, straight up: the top of the lid', store, { x: 25, y: -200 }, { x: 25, y: 0 }],
  ];
  for (const [label, shape, towards, dock] of CASES) {
    const at = cropPoint(shape, towards);
    expect(at.x, label).toBeCloseTo(dock.x, 3);
    expect(at.y, label).toBeCloseTo(dock.y, 3);
    expectOnOutline(shape, at);
  }
  // An anchor outside the shape is no place to walk from: cropPoint falls back to the centre.
  expect(outlinePoint(circle, { x: 400, y: 400 }, { x: 500, y: 400 })).toBeUndefined();
  expect(cropPoint(circle, { x: 500, y: 118 }, { x: 400, y: 400 })).toEqual({ x: 136, y: 118 });
});

// --- routing -----------------------------------------------------------------

/** `points` to three decimals, so a path docked on a circle compares as literals. */
const rounded = (points: readonly Point[]): Point[] =>
  points.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));

test('route: an orthogonal path of at most five points, docked on both outlines', () => {
  const loop = task(100, 100);
  const circle = event(200, 200, 'bpmn:IntermediateThrowEvent');
  const CASES: [label: string, source: CroppableShape, target: CroppableShape, path?: Point[]][] = [
    ['a level neighbour: one straight run, half way between the centres', event(100, 100), task(200, 80), [{ x: 135.972, y: 119 }, { x: 200, y: 119 }]],
    ['aligned side by side: straight through both centres', task(0, 100), task(300, 100), [{ x: 100, y: 140 }, { x: 300, y: 140 }]],
    ['aligned one above the other', task(0, 0), task(0, 200), [{ x: 50, y: 80 }, { x: 50, y: 200 }]],
    ['side by side, off-centre: a Z whose jog sits in the gap', task(0, 0), task(200, 60), [{ x: 100, y: 40 }, { x: 150, y: 40 }, { x: 150, y: 100 }, { x: 200, y: 100 }]],
    ['diagonal, wider than tall: one elbow, leaving sideways', task(0, 0), task(400, 300), [{ x: 100, y: 40 }, { x: 450, y: 40 }, { x: 450, y: 300 }]],
    ['diagonal, taller than wide: the elbow flips', task(0, 0), task(150, 400), [{ x: 50, y: 80 }, { x: 50, y: 440 }, { x: 150, y: 440 }]],
    ['overlapping: through a lane clear of both', task(0, 0), task(60, 30), [{ x: 50, y: 80 }, { x: 50, y: 130 }, { x: 110, y: 130 }, { x: 110, y: 110 }]],
    ['to itself: out of the right flank, back into the top', loop, loop, [{ x: 200, y: 140 }, { x: 220, y: 140 }, { x: 220, y: 80 }, { x: 175, y: 80 }, { x: 175, y: 100 }]],
    // Every relative placement, from a circle.
    ['to a task on the right', circle, task(400, 190)],
    ['to a task on the left', circle, task(0, 190)],
    ['to a task below', circle, task(170, 400)],
    ['to a task above', circle, task(170, 0)],
    ['to a task down-right', circle, task(400, 400)],
    ['to a task down-left', circle, task(0, 400)],
    ['to a task up-right', circle, task(400, 0)],
    ['to a task up-left', circle, task(0, 0)],
    ['to an overlapping gateway', circle, gateway(230, 230)],
    ['to a gateway diagonally', circle, gateway(400, 400)],
  ];
  for (const [label, source, target, path] of CASES) {
    const points = route(source, target);
    if (path) expect(rounded(points), label).toEqual(path);
    expect(isOrthogonal(points), label).toBe(true);
    expect(points.length, label).toBeLessThanOrEqual(5);
    expectOnOutline(source, points[0]);
    expectOnOutline(target, points[points.length - 1]);
  }
});

// --- on the canvas --------------------------------------------------------------

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

async function load(): Promise<Loaded> {
  return loadCanvas(FIXTURE_XML);
}

test('rerouting twice commits nothing the second time', async () => {
  const { canvas } = await load();
  const scene = canvas.getScene()!;
  const task = scene.elementsById.get('Task_1') as SceneNode;
  const kinked = scene.elementsById.get('Flow_1') as SceneEdge;
  const before = scene.revision;

  // Both flows are rewritten from their ends: the hand-drawn kink goes, the off-level run is levelled.
  expect(canvas.rerouteEdges([task]).map((e) => e.id).sort()).toEqual(['Flow_1', 'Flow_2']);
  expect(kinked.waypoints).toHaveLength(2);
  expect(scene.revision).toBeGreaterThan(before);

  // Routed already: nothing changes, and the revision holds still.
  const routed = scene.revision;
  expect(canvas.rerouteEdges([task])).toEqual([]);
  expect(scene.revision).toBe(routed);
});

// --- squaring a bent route ------------------------------------------------------

test('a bent route keeps its joints when an end is re-docked: a near-aligned run is squared by moving the joint', () => {
  // A move or an expand re-crops the dock of a route of more than two points and squares it
  // with `orthogonalize(points, undefined, false)`: the joint moves onto the dock's line,
  // the dock holds, and no joint is added or dropped.
  expect(orthogonalize([{ x: 100, y: 100 }, { x: 200, y: 102 }, { x: 200, y: 300 }], undefined, false))
    .toEqual([{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 300 }]);
});

test('a plain association is routed as ONE straight diagonal, cropped to both outlines', () => {
  const task: CroppableShape = { x: 0, y: 100, width: 100, height: 80, type: 'bpmn:Task' };
  const note: CroppableShape = { x: 200, y: 0, width: 100, height: 30, type: 'bpmn:TextAnnotation' };

  const points = routeFor('bpmn:Association', task, note);
  expect(points).toHaveLength(2);
  // The line runs centre to centre — no elbow anywhere on it.
  expect(isOrthogonal(points)).toBe(false);
  // …and both ends sit ON their silhouettes, exactly as a routed edge's do.
  expect(containsPoint(task, points[0])).toBe(true);
  expect(containsPoint(note, points[1])).toBe(true);
  expect(points).toEqual(straightRoute(task, note));

  // The straight treatment is the plain association ALONE. A data association keeps
  // the orthogonal router, which is how every shipped example's DI already has them.
  expect(isStraightRouted('bpmn:Association')).toBe(true);
  expect(isStraightRouted('bpmn:DataOutputAssociation')).toBe(false);
  expect(isStraightRouted('bpmn:SequenceFlow')).toBe(false);
  expect(isOrthogonal(routeFor('bpmn:DataOutputAssociation', task, note))).toBe(true);
  expect(routeFor('bpmn:SequenceFlow', task, note)).toEqual(route(task, note));
});

/**
 * The router is no general obstacle-avoiding one: it picks among the path shapes it
 * already draws, preferring one that misses the boxes it is handed. A move hands it the
 * scene's shapes (`Canvas.routeObstacles`), so a flow re-routed under the pointer is
 * not drawn across the shape its element was dropped beside.
 */
test('an obstacle steers the route to a candidate that misses it', () => {
  const a: CroppableShape = { x: 0, y: 240, width: 100, height: 80, type: 'bpmn:Task' };
  const b: CroppableShape = { x: 400, y: 0, width: 100, height: 80, type: 'bpmn:Task' };
  const level: CroppableShape = { x: 400, y: 240, width: 100, height: 80, type: 'bpmn:Task' };
  const between = { x: 200, y: 240, width: 100, height: 80 };
  // Wider than tall, so the plain elbow leaves along y = 280.
  const plain = [{ x: 50, y: 280 }, { x: 450, y: 280 }, { x: 450, y: 40 }];
  const CASES: [label: string, path: Point[], expected: Point[]][] = [
    ['nothing in the way', routeCenters(a, b), plain],
    ['a box on the first leg: the elbow bends the other way', routeCenters(a, b, { obstacles: [between] }), [{ x: 50, y: 280 }, { x: 50, y: 40 }, { x: 450, y: 40 }]],
    // A straight run at y = 280 would cross it, so the path drops below all three boxes (320 + 20).
    ['a box between two level shapes: a lane below it', routeCenters(a, level, { obstacles: [between] }), [{ x: 50, y: 280 }, { x: 50, y: 340 }, { x: 450, y: 340 }, { x: 450, y: 280 }]],
    // One scene-wide list serves every edge, so an edge's own shapes are in it.
    ['a box on an end, which is ignored', routeCenters(a, b, { obstacles: [{ x: 10, y: 250, width: 40, height: 40 }] }), plain],
    ['a box nothing crosses', routeCenters(a, b, { obstacles: [{ x: 900, y: 900, width: 100, height: 80 }] }), plain],
  ];
  for (const [label, path, expected] of CASES) expect(path, label).toEqual(expected);
});
