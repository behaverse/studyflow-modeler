import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import { isOrthogonal } from '@canvas/routing/orthogonal.ts';
import { cropPoint } from '@canvas/routing/crop.ts';
import type { Point, SceneEdge, SceneNode } from '@canvas/model/scene.ts';

import { freshModdle, loadCanvas, pointerDown, pointerMove, pointerUp, type Loaded } from './canvasHarness';

/**
 * Endpoint drags — parity spec §1 ("drag an ENDPOINT handle → reconnect/re-dock")
 * and §4 (cropping). Three outcomes, and which one a drop gets is decided by what
 * is under it:
 *
 * - a shape the rules accept → the connection is rewired AND the moved end docks
 *   where the pointer let go, on the side the route arrives from, cropped to the
 *   outline (not at the centre-anchored default the router alone would give);
 * - a shape the rules refuse → nothing at all (the ∅ cursor was already saying so);
 * - empty space → P3's free endpoint move, which is how an edge is bent by its tip.
 */

/**
 * `Start_1 → Task_1`, with `Task_2` off to the right as the reconnect candidate and
 * a second START event as the one the rules must refuse (nothing may flow INTO a
 * start event).
 */
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="One"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:task id="Task_2" name="Two" />
    <bpmn:startEvent id="Start_2" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="400" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_2_di" bpmnElement="Start_2">
        <dc:Bounds x="600" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="200" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(xml = FIXTURE_XML): Promise<Loaded> {
  return loadCanvas(xml);
}

function process(definitions: any): any {
  return definitions.rootElements.find((el: any) => el.id === 'Process_1');
}

function flowElement(definitions: any, id: string): any {
  return process(definitions).flowElements.find((el: any) => el.id === id);
}

function diEdge(definitions: any, id: string): any {
  for (const diagram of definitions.diagrams ?? []) {
    for (const pe of diagram.plane?.planeElement ?? []) {
      if (pe.$type === 'bpmndi:BPMNEdge' && pe.bpmnElement?.id === id) return pe;
    }
  }
  return undefined;
}

function diWaypoints(definitions: any, id: string): Point[] {
  return (diEdge(definitions, id)?.waypoint ?? []).map((w: any) => ({ x: w.x, y: w.y }));
}

function edge(canvas: Canvas, id: string): SceneEdge {
  return canvas.getScene()!.elementsById.get(id) as SceneEdge;
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function last(edge: SceneEdge): Point {
  return edge.waypoints[edge.waypoints.length - 1];
}

// --- pointer helpers ---------------------------------------------------------

/** Select `flow`, grab its LAST waypoint and drop it at `to`. */
function dragTargetEnd(canvas: Canvas, flow: SceneEdge, to: Point): void {
  canvas.getSelection().select(flow);
  const grab = { ...last(flow) };
  pointerDown(canvas, grab);
  pointerMove(canvas, to);
  pointerUp(canvas, to);
}

// --- an accepted target ------------------------------------------------------

test('dragging the target endpoint onto another task reconnects, re-docks where it was dropped and crops to the outline', async () => {
  const loaded = await load();
  const { canvas, definitions } = loaded;
  const flow = edge(canvas, 'Flow_1');
  const target = node(canvas, 'Task_2');

  // Dropped low inside Task_2 — well below the centre line the router would have
  // anchored the edge to.
  dragTargetEnd(canvas, flow, { x: 450, y: 155 });

  // Rewired, in the scene AND in the live moddle tree.
  expect(flow.target?.id).toBe('Task_2');
  expect(flowElement(definitions, 'Flow_1').targetRef.id).toBe('Task_2');
  expect(flowElement(definitions, 'Task_2').incoming?.map((f: any) => f.id)).toEqual(['Flow_1']);

  // Docked where it was DROPPED: the walk from the drop point toward the rest of the
  // edge leaves Task_2 through its left flank, low down, near the rounded corner it
  // was let go over — not at the centre-crossing point the router would have picked
  // (y 120), and not clamped to a fixed inset off the corner either.
  const tip = last(flow);
  expect(tip.x).toBe(target.x);
  expect(tip.y).toBeGreaterThan(target.y + target.height / 2);
  expect(tip.y).toBeLessThanOrEqual(target.y + target.height);
  // The run to it is left DIAGONAL: an endpoint drags like an interior joint, and
  // nothing re-squares the path behind it (diagram-js / draw.io).
  expect(isOrthogonal(flow.waypoints)).toBe(false);
  // The source end is untouched and still on the start event's circle.
  expect(flow.waypoints[0].x).toBeCloseTo(136, 0);
});

test('the reconnected geometry is written to di:waypoint and round-trips through bpmn-moddle', async () => {
  const loaded = await load();
  const { canvas, definitions, moddle } = loaded;
  const flow = edge(canvas, 'Flow_1');

  dragTargetEnd(canvas, flow, { x: 450, y: 155 });

  const written = diWaypoints(definitions, 'Flow_1');
  expect(written).toEqual(flow.waypoints.map((p) => ({ x: p.x, y: p.y })));

  const { xml } = await moddle.toXML(definitions);
  expect(xml).toContain('targetRef="Task_2"');
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  expect(diWaypoints(reloaded, 'Flow_1')).toEqual(written);
  expect(flowElement(reloaded, 'Flow_1').targetRef.id).toBe('Task_2');
});

// --- a refused target --------------------------------------------------------

test('a rules-refused target leaves the edge untouched', async () => {
  const loaded = await load();
  const { canvas, definitions } = loaded;
  const flow = edge(canvas, 'Flow_1');
  const before = flow.waypoints.map((p) => ({ ...p }));
  const revision = canvas.getScene()!.revision;

  // A start event takes no incoming flow.
  dragTargetEnd(canvas, flow, { x: 618, y: 118 });

  expect(flow.target?.id).toBe('Task_1');
  expect(flow.waypoints).toEqual(before);
  expect(diWaypoints(definitions, 'Flow_1')).toEqual(before);
  expect(flowElement(definitions, 'Flow_1').targetRef.id).toBe('Task_1');
  expect(canvas.getScene()!.revision).toBe(revision);
});

// --- empty space -------------------------------------------------------------

test('dropped on empty space the endpoint free-moves, exactly like a bendpoint', async () => {
  const loaded = await load();
  const { canvas, definitions } = loaded;
  const flow = edge(canvas, 'Flow_1');

  dragTargetEnd(canvas, flow, { x: 300, y: 320 });

  // Still docked to Task_1 as a MODEL, but its tip now sits where it was dropped.
  expect(flow.target?.id).toBe('Task_1');
  expect(last(flow).x).toBeCloseTo(300, 3);
  expect(last(flow).y).toBeCloseTo(320, 3);

  // …and NOTHING else moved. The endpoint is dragged the way an interior joint is
  // (`moveBendpoint`): the neighbour stays put and the terminal run goes diagonal,
  // which is what diagram-js and draw.io both do. It used to grow an elbow to keep
  // every run square — the one gesture whose whole point is "put the tip here"
  // answering by re-cutting the edge into a shape nobody drew.
  expect(flow.waypoints).toHaveLength(2);
  expect(isOrthogonal(flow.waypoints)).toBe(false);
  expect(flow.waypoints[0]).toEqual({ x: 136, y: 118 });

  const written = diWaypoints(definitions, 'Flow_1');
  expect(written).toEqual(flow.waypoints);
});

test('an endpoint dragged along its own run leaves no elbow behind', async () => {
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_1');
  // Snapping off so the drop lands on the run's own `y` exactly rather than on the
  // nearest grid line — which is also the setting the app now exposes.
  canvas.setSnapToGrid(false);

  // Straight out along the run it already had: there is no turn to make, so the path
  // stays the two-point edge it was rather than growing a redundant joint.
  dragTargetEnd(canvas, flow, { x: 360, y: 118 });

  expect(flow.waypoints).toHaveLength(2);
  expect(last(flow)).toEqual({ x: 360, y: 118 });
  expect(isOrthogonal(flow.waypoints)).toBe(true);
});

// --- the programmatic path ---------------------------------------------------

test('reconnectElement without a drop point keeps the plain centre-anchored route', async () => {
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_1');
  const target = node(canvas, 'Task_2');

  expect(canvas.reconnectElement(flow, 'target', target)).toBe(true);
  expect(flow.target?.id).toBe('Task_2');
  expect(last(flow).x).toBe(target.x);
  expect(isOrthogonal(flow.waypoints)).toBe(true);
});

test('a reconnect drop lands on the grid, like every other waypoint gesture', async () => {
  // The dock follows the DROP, and a drop is a waypoint position: it snaps to the
  // grid, exactly as a bendpoint drag does. Two drops inside the same grid cell
  // therefore dock in the same place.
  const near = await load();
  const far = await load();
  const one = node(near.canvas, 'Task_1');

  // 141 and 143 both round to the same grid line…
  dragTargetEnd(near.canvas, edge(near.canvas, 'Flow_1'), { x: one.x + 6, y: 141 });
  dragTargetEnd(far.canvas, edge(far.canvas, 'Flow_1'), { x: one.x + 6, y: 143 });

  expect(last(edge(near.canvas, 'Flow_1'))).toEqual(last(edge(far.canvas, 'Flow_1')));

  // …and one that rounds to the NEXT docks somewhere else.
  const next = await load();
  dragTargetEnd(next.canvas, edge(next.canvas, 'Flow_1'), { x: one.x + 6, y: 147 });
  expect(last(edge(next.canvas, 'Flow_1'))).not.toEqual(last(edge(near.canvas, 'Flow_1')));
});

test('a drop aimed at the middle of a shape docks where the router would anchor it', async () => {
  // The other half of the same walk: from the centre, the exit point IS the
  // centre-crossing one — so "point it at the shape" and "point it at a spot on the
  // shape" are the same gesture, told apart only by where you let go.
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_1');
  const target = node(canvas, 'Task_2');
  const centre = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const from = { ...flow.waypoints[0] };

  dragTargetEnd(canvas, flow, centre);

  expect(flow.target?.id).toBe('Task_2');
  // Aimed at the centre, the walk starts at the centre — so the dock is exactly the
  // point the router itself would have cropped to, with no anchor at all.
  const anchored = cropPoint(target, from);
  expect(last(flow).x).toBe(anchored.x);
  expect(last(flow).y).toBeCloseTo(anchored.y, 0);
});

test('the drag ghost shows the path the release commits, dock included', async () => {
  // "What the hover shows is what the click takes" applies to this gesture too: the
  // ghost is built from the same base path and the same snapped drop point the
  // commit uses, so an endpoint dragged across a shape does not preview one route
  // and land on another.
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_1');
  const target = node(canvas, 'Task_2');
  const drop = { x: target.x + 20, y: target.y + 65 };

  canvas.getSelection().select(flow);
  pointerDown(canvas, last(flow));
  pointerMove(canvas, drop);
  const ghost = canvas.getSvg().querySelector('.sf-connect-preview-line')!
    .getAttribute('data-waypoints');
  pointerUp(canvas, drop);

  expect(ghost).toBe(flow.waypoints.map((p) => `${p.x},${p.y}`).join(' '));
});

/**
 * What an endpoint drag does to the joint BEHIND it — the rule the second recording
 * demonstrates. A square terminal run keeps its shape: drag the end of a vertical
 * drop sideways and the whole drop slides with it (frames 19.0s → 23.8s, where the
 * dock and the joint above it both moved from x 871 to x 791). A run somebody has
 * already bent out of Manhattan is left exactly as they bent it.
 */
const BENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_B" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_B" isExecutable="false">
    <bpmn:startEvent id="Start_B"><bpmn:outgoing>Flow_B</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_B" name="B"><bpmn:incoming>Flow_B</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_B" sourceRef="Start_B" targetRef="Task_B" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_B">
    <bpmndi:BPMNPlane id="Plane_B" bpmnElement="Process_B">
      <bpmndi:BPMNShape id="Start_B_di" bpmnElement="Start_B">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_B_di" bpmnElement="Task_B">
        <dc:Bounds x="500" y="400" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_B_di" bpmnElement="Flow_B">
        <di:waypoint x="136" y="118" /><di:waypoint x="550" y="118" /><di:waypoint x="550" y="400" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('an endpoint on a SQUARE run takes the joint behind it along', async () => {
  const { canvas } = await load(BENT_XML);
  const flow = edge(canvas, 'Flow_B');
  const task = node(canvas, 'Task_B');

  // The last run drops vertically at x = 550 into the task's top. Drag the dock left.
  dragTargetEnd(canvas, flow, { x: 520, y: task.y + 10 });

  const [, joint, tip] = flow.waypoints;
  expect(tip.y).toBe(task.y);
  // The run is STILL vertical: the joint came along.
  expect(joint.x).toBe(tip.x);
  expect(joint.y).toBe(118);
  expect(tip.x).toBeLessThan(550);
});

test('an endpoint on a DIAGONAL run leaves the joint where it was bent', async () => {
  const { canvas } = await load(BENT_XML);
  const flow = edge(canvas, 'Flow_B');
  const task = node(canvas, 'Task_B');

  // Bend the last run out of Manhattan first, by dragging the joint sideways.
  canvas.getSelection().select(flow);
  pointerDown(canvas, flow.waypoints[1]);
  pointerMove(canvas, { x: 400, y: 118 });
  pointerUp(canvas, { x: 400, y: 118 });
  const bentJoint = { ...flow.waypoints[1] };
  expect(bentJoint.x).toBe(400);

  dragTargetEnd(canvas, flow, { x: 520, y: task.y + 10 });

  // The joint is exactly where it was left: re-squaring the run would undo the bend.
  expect(flow.waypoints[1]).toEqual(bentJoint);
});
