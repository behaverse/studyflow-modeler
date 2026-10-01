import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import { isOrthogonal } from '@canvas/study/orthogonal.ts';
import type { Point, SceneEdge } from '@canvas/study/scene.ts';
import type { Element } from '@core/model/index';

import { edge, loadYaml, node, pointerDown, pointerMove, pointerUp, savedDrawing, sceneOf, svgOf, waypointsOf, type Loaded } from './canvasHarness';

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
const FIXTURE_YAML = `id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    Start_1:
      type: StartEvent
      bounds: 100 100 36 36
    Task_1:
      type: Task
      name: One
      bounds: 200 80 100 80
    Task_2:
      type: Task
      name: Two
      bounds: 400 80 100 80
    Start_2:
      type: StartEvent
      bounds: 600 100 36 36
    Flow_1:
      sourceRef: Start_1
      targetRef: Task_1
      waypoint: 136,118 200,120
`;

function load(yaml = FIXTURE_YAML): Loaded {
  return loadYaml(yaml);
}

/** The element `id` names in the study `canvas` edits. */
function flowElement(canvas: Canvas, id: string): Element {
  return canvas.study.model.get(id)!;
}

function last(edge: SceneEdge): Point {
  return edge.waypoints[edge.waypoints.length - 1];
}

// --- pointer helpers ---------------------------------------------------------

/** Select `flow`, grab its LAST waypoint and drop it at `to`. */
function dragTargetEnd(canvas: Canvas, flow: SceneEdge, to: Point): void {
  canvas.select(flow.id);
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
    const { canvas } = load();
    const flow = edge(canvas, 'Flow_1');
    const target = node(canvas, 'Task_2');

    dragTargetEnd(canvas, flow, drop);

    // Rewired in the scene and in the business objects, off the old target and onto the new.
    expect(flow.target, label).toBe(target);
    expect(target.incoming, label).toContain(flow);
    expect(node(canvas, 'Task_1').incoming, label).toEqual([]);
    expect(flowElement(canvas, 'Flow_1').targetRef, label).toBe('Task_2');

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
  const loaded = load();
  const { canvas } = loaded;
  const flow = edge(canvas, 'Flow_1');
  const before = flow.waypoints.map((p) => ({ ...p }));
  const revision = sceneOf(canvas).revision;

  // A start event takes no incoming flow.
  dragTargetEnd(canvas, flow, { x: 618, y: 118 });

  expect(flow.target?.id).toBe('Task_1');
  expect(flow.waypoints).toEqual(before);
  expect(waypointsOf(savedDrawing(loaded, 'Flow_1'))).toMatchObject(before);
  expect(flowElement(canvas, 'Flow_1').targetRef).toBe('Task_1');
  expect(sceneOf(canvas).revision).toBe(revision);
});

// --- empty space -------------------------------------------------------------

test('dropped on empty space the endpoint free-moves, exactly like a bendpoint', async () => {
  const loaded = load();
  const { canvas } = loaded;
  const flow = edge(canvas, 'Flow_1');

  dragTargetEnd(canvas, flow, { x: 300, y: 320 });

  // Still docked to Task_1 as a MODEL, but its tip now sits where it was dropped.
  expect(flow.target?.id).toBe('Task_1');
  expect(last(flow).x).toBeCloseTo(300, 3);
  expect(last(flow).y).toBeCloseTo(320, 3);

  // …and NOTHING else moved. A lone run has no joint to keep square, so it goes
  // diagonal. It used to grow an elbow to keep every run square — the one gesture
  // whose whole point is "put the tip here" answering by re-cutting the edge into a
  // shape nobody drew.
  expect(flow.waypoints).toHaveLength(2);
  expect(isOrthogonal(flow.waypoints)).toBe(false);
  expect(flow.waypoints[0]).toEqual({ x: 136, y: 118 });

  expect(waypointsOf(savedDrawing(loaded, 'Flow_1'))).toMatchObject(flow.waypoints);
});

test('a reconnect drop lands on the grid, like every other waypoint gesture', async () => {
  // The dock follows the DROP, and a drop is a waypoint position: it snaps to the
  // grid, exactly as a bendpoint drag does. Two drops inside the same grid cell
  // therefore dock in the same place.
  const near = load();
  const far = load();
  const one = node(near.canvas, 'Task_1');

  // 141 and 143 both round to the same grid line…
  dragTargetEnd(near.canvas, edge(near.canvas, 'Flow_1'), { x: one.x + 6, y: 141 });
  dragTargetEnd(far.canvas, edge(far.canvas, 'Flow_1'), { x: one.x + 6, y: 143 });

  expect(last(edge(near.canvas, 'Flow_1'))).toEqual(last(edge(far.canvas, 'Flow_1')));

  // …and one that rounds to the NEXT docks somewhere else.
  const next = load();
  dragTargetEnd(next.canvas, edge(next.canvas, 'Flow_1'), { x: one.x + 6, y: 147 });
  expect(last(edge(next.canvas, 'Flow_1'))).not.toEqual(last(edge(near.canvas, 'Flow_1')));
});

test('the drag ghost shows the path the release commits, onto a shape and in open space', async () => {
  // "What the hover shows is what the click takes" applies to this gesture too: the
  // ghost is built from the same base path and the same snapped drop point the
  // commit uses, so an endpoint dragged across a shape, or let go clear of one, does
  // not preview one route and land on another.
  const ghostThenPath = (canvas: Canvas, id: string, drop: Point): [string | null, string] => {
    const flow = edge(canvas, id);
    canvas.select(flow.id);
    pointerDown(canvas, last(flow));
    pointerMove(canvas, drop);
    const ghost = svgOf(canvas).querySelector('.sf-connect-preview-line')!.getAttribute('data-waypoints');
    pointerUp(canvas, drop);
    return [ghost, flow.waypoints.map((p) => `${p.x},${p.y}`).join(' ')];
  };
  const onto = load();
  const target = node(onto.canvas, 'Task_2');
  const [ontoGhost, ontoPath] = ghostThenPath(onto.canvas, 'Flow_1', { x: target.x + 20, y: target.y + 65 });
  expect(ontoGhost).toBe(ontoPath);
  // Flow_B's last run is square: let go in open space, it stays square in the ghost and the commit alike.
  const [openGhost, openPath] = ghostThenPath(load(BENT_YAML).canvas, 'Flow_B', { x: 520, y: 300 });
  expect(openGhost).toBe(openPath);
});

/**
 * What an endpoint drag does to the joint behind it. A square terminal run keeps its
 * shape: drag the end of a vertical drop sideways and the whole drop slides with it. A
 * run somebody has already bent is left as they bent it.
 */
const BENT_YAML = `id: Defs_B
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_B:
  type: Process
  flowElements:
    Start_B:
      type: StartEvent
      bounds: 100 100 36 36
    Task_B:
      type: Task
      name: B
      bounds: 500 400 100 80
    Flow_B:
      sourceRef: Start_B
      targetRef: Task_B
      waypoint: 136,118 550,118 550,400
`;

test('an end on a square run takes the joint behind it along; on a bent run it leaves the joint', async () => {
  // Flow_B's last run drops vertically at x = 550 into Task_B's top; its end is dragged left.
  const square = load(BENT_YAML);
  const bent = load(BENT_YAML);
  // Bend the second one's last run first, by dragging its joint sideways.
  const bentFlow = edge(bent.canvas, 'Flow_B');
  bent.canvas.select(bentFlow.id);
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
