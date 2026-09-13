import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import { isOrthogonal } from '@canvas/routing/orthogonal.ts';
import type { Point, SceneEdge, SceneNode } from '@canvas/model/scene.ts';

import { loadCanvas, pointerDown, pointerMove, pointerUp, type Loaded } from './canvasHarness';

/**
 * Dragging a connection's end. What is under the drop decides the outcome:
 *
 * - a shape the rules accept: the connection is rewired, and the moved end docks
 *   where the pointer let go, cropped to the outline;
 * - a shape the rules refuse: nothing at all;
 * - empty space: the end moves freely, the way an edge is bent by its tip.
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

test('dragging the target end onto another task rewires it and docks where it was dropped', async () => {
  // The dock is where the walk from the drop toward the rest of the edge leaves Task_2
  // (x 400-500, y 80-160): dropped low, low on its left flank; aimed at its centre, on the
  // centre line, where the router would have docked the flow. One gesture, told apart
  // only by where the pointer lets go.
  const CASES: [label: string, drop: Point, dockY: [low: number, high: number]][] = [
    ['dropped low inside it', { x: 450, y: 155 }, [140, 160]],
    ['aimed at its centre', { x: 450, y: 120 }, [119, 121]],
  ];
  for (const [label, drop, [low, high]] of CASES) {
    const { canvas, definitions } = await load();
    const flow = edge(canvas, 'Flow_1');
    const target = node(canvas, 'Task_2');

    dragTargetEnd(canvas, flow, drop);

    // Rewired in the scene and in the business objects, off the old target and onto the new.
    expect(flow.target, label).toBe(target);
    expect(target.incoming, label).toContain(flow);
    expect(node(canvas, 'Task_1').incoming, label).toEqual([]);
    expect(flowElement(definitions, 'Flow_1').targetRef.id, label).toBe('Task_2');
    expect(flowElement(definitions, 'Task_2').incoming?.map((f: any) => f.id), label).toEqual(['Flow_1']);

    const tip = last(flow);
    expect(tip.x, label).toBe(target.x);
    expect(tip.y, label).toBeGreaterThanOrEqual(low);
    expect(tip.y, label).toBeLessThanOrEqual(high);
    // The run to the dock is left as dragged, not re-squared, and the source end stays put.
    expect(isOrthogonal(flow.waypoints), label).toBe(false);
    expect(flow.waypoints[0].x, label).toBeCloseTo(136, 0);
  }
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
  expect(diWaypoints((canvas.syncDi(), definitions), 'Flow_1')).toEqual(before);
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
  // (`moveBendpoint`): the neighbour stays put and the terminal run goes diagonal. It
  // used to grow an elbow to keep every run square — the one gesture whose whole point
  // is "put the tip here" answering by re-cutting the edge into a shape nobody drew.
  expect(flow.waypoints).toHaveLength(2);
  expect(isOrthogonal(flow.waypoints)).toBe(false);
  expect(flow.waypoints[0]).toEqual({ x: 136, y: 118 });

  const written = diWaypoints((canvas.syncDi(), definitions), 'Flow_1');
  expect(written).toEqual(flow.waypoints);
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
 * What an endpoint drag does to the joint behind it. A square terminal run keeps its
 * shape: drag the end of a vertical drop sideways and the whole drop slides with it. A
 * run somebody has already bent is left as they bent it.
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

test('an end on a square run takes the joint behind it along; on a bent run it leaves the joint', async () => {
  // Flow_B's last run drops vertically at x = 550 into Task_B's top; its end is dragged left.
  const square = await load(BENT_XML);
  const bent = await load(BENT_XML);
  // Bend the second one's last run first, by dragging its joint sideways.
  const bentFlow = edge(bent.canvas, 'Flow_B');
  bent.canvas.getSelection().select(bentFlow);
  pointerDown(bent.canvas, bentFlow.waypoints[1]);
  pointerMove(bent.canvas, { x: 400, y: 118 });
  pointerUp(bent.canvas, { x: 400, y: 118 });
  const bentJoint = { ...bentFlow.waypoints[1] };
  expect(bentJoint.x).toBe(400);

  for (const { canvas } of [square, bent]) {
    dragTargetEnd(canvas, edge(canvas, 'Flow_B'), { x: 520, y: node(canvas, 'Task_B').y + 10 });
  }

  // Square: the run is still vertical, so the joint came along to the new dock on the task's top.
  const [, joint, tip] = edge(square.canvas, 'Flow_B').waypoints;
  expect(tip.y).toBe(400);
  expect(tip.x).toBeLessThan(550);
  expect(joint).toEqual({ x: tip.x, y: 118 });
  // Bent: the joint is where it was left; re-squaring the run would undo the bend.
  expect(bentFlow.waypoints[1]).toEqual(bentJoint);
});
