import { expect, test } from '@playwright/test';

import type { Canvas } from '@canvas/index.ts';
import type { SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import type { ElementChangedEvent } from '@canvas/model/writeback.ts';
import { route } from '@canvas/routing/orthogonal.ts';
import { zRankOf } from '@canvas/model/tree.ts';

import { exampleXml } from './utils';

import { freshModdle, jsdomWindow, loadCanvas, pointerDown, pointerMove, pointerUp, type Loaded } from './canvasHarness';

/**
 * P3 direct manipulation + DI writeback (design §6). The canvas is driven through
 * `tests/canvasHarness.ts`, and gestures are dispatched as real pointer events on the
 * SVG DOM.
 *
 * The contract under test is the one design §1 calls "write-through": a geometry edit
 * mutates BOTH the scene field AND the live DI moddle object the scene was imported
 * from — so re-serializing the SAME `Definitions` tree with `bpmn-moddle` emits the
 * edit (move → save → reload shows the delta, and ONLY where it was edited). Nothing
 * here rebuilds the tree.
 *
 * jsdom has no layout engine: `getBoundingClientRect` is all zeros, so the viewport
 * maps screen↔diagram 1:1 with a `box.x/y` offset and `getViewbox().scale` is 1. Every
 * event's client coordinates are therefore computed from a diagram point through
 * `viewport.toScreen`, which round-trips exactly.
 */

const win = jsdomWindow();

/**
 * A deterministic three-shape process: start → task → end, with round numbers so a
 * (dx, dy) assertion is exact and grid snapping is unambiguous.
 */
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
        <di:waypoint x="136" y="118" /><di:waypoint x="200" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="300" y="120" /><di:waypoint x="400" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/**
 * A canvas with GRID snapping deliberately OFF.
 *
 * Grid snapping is on by default since parity spec addendum 7 (see
 * `canvas-snapping.unit.spec.ts`, which is where the default belongs), and every
 * test in this file is about something else: what a gesture writes to the DI, what
 * survives a round trip, what a cancel restores. Rounding each of them to the
 * nearest 10 would test the grid over and over and the write-through not at all —
 * so the deltas here stay exact and the grid is asked for explicitly where it is
 * the subject.
 */
async function load(
  xml: string,
  options: { snapToGrid?: boolean; gridSize?: number; minNodeSize?: number } = {},
): Promise<Loaded> {
  return loadCanvas(xml, { snapToGrid: false, ...options });
}

/** A STOCK canvas — no options at all, so every default is the shipped one. */
async function loadStock(xml: string): Promise<Loaded> {
  return loadCanvas(xml);
}

async function loadExample(name: string): Promise<Loaded> {
  return load(exampleXml(name));
}

// --- DI readers (walk the live moddle tree, never the scene) ------------------

function diShape(definitions: any, id: string): any {
  for (const diagram of definitions.diagrams ?? []) {
    for (const pe of diagram.plane?.planeElement ?? []) {
      if (pe.$type === 'bpmndi:BPMNShape' && pe.bpmnElement?.id === id) return pe;
    }
  }
  return undefined;
}

function diEdge(definitions: any, id: string): any {
  for (const diagram of definitions.diagrams ?? []) {
    for (const pe of diagram.plane?.planeElement ?? []) {
      if (pe.$type === 'bpmndi:BPMNEdge' && pe.bpmnElement?.id === id) return pe;
    }
  }
  return undefined;
}

function boundsOf(definitions: any, id: string): { x: number; y: number; width: number; height: number } {
  const b = diShape(definitions, id)?.bounds;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

function waypointsOf(definitions: any, id: string): { x: number; y: number }[] {
  return (diEdge(definitions, id)?.waypoint ?? []).map((w: any) => ({ x: w.x, y: w.y }));
}

/** Serialize the SAME tree back to XML and re-parse it — the move→save→reload path. */
async function roundTrip(loaded: Loaded): Promise<{ xml: string; reloaded: any }> {
  const { xml } = await loaded.moddle.toXML(loaded.definitions);
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  return { xml, reloaded };
}

// --- pointer helpers ---------------------------------------------------------

interface Pt { x: number; y: number; }

function firePointer(
  canvas: Canvas,
  target: EventTarget,
  type: string,
  diagram: Pt,
  init: MouseEventInit = {},
): void {
  const screen = canvas.getViewport().toScreen(diagram);
  target.dispatchEvent(new win.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: screen.x,
    clientY: screen.y,
    button: 0,
    ...init,
  }));
}

/** A full press–move–release gesture from one diagram point to another. */
function dragBy(canvas: Canvas, from: Pt, to: Pt): void {
  pointerDown(canvas, from);
  pointerMove(canvas, to);
  pointerUp(canvas, to);
}

/** A press with no movement — selects whatever is under the point. */
function click(canvas: Canvas, at: Pt): void {
  pointerDown(canvas, at);
  pointerUp(canvas, at);
}

function center(node: SceneNode): Pt {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function edge(canvas: Canvas, id: string): SceneEdge {
  return canvas.getScene()!.elementsById.get(id) as SceneEdge;
}

// --- move --------------------------------------------------------------------

test('move: dragging a node updates scene x/y AND di.bounds by the same delta', async () => {
  const { canvas, definitions } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  const before = { x: task.x, y: task.y };
  const beforeDi = boundsOf(definitions, 'Task_1');
  expect(beforeDi).toEqual({ x: 200, y: 80, width: 100, height: 80 });

  const dx = 40;
  const dy = -25;
  const from = center(task);
  dragBy(canvas, from, { x: from.x + dx, y: from.y + dy });

  // Scene.
  expect({ x: task.x, y: task.y }).toEqual({ x: before.x + dx, y: before.y + dy });
  // Backing DI moddle object, mutated in place (same object, not a rebuild).
  expect(task.di).toBe(diShape(definitions, 'Task_1'));
  expect(boundsOf(definitions, 'Task_1')).toEqual({
    x: beforeDi.x + dx,
    y: beforeDi.y + dy,
    width: beforeDi.width,
    height: beforeDi.height,
  });
  // Size is untouched by a move.
  expect({ w: task.width, h: task.height }).toEqual({ w: 100, h: 80 });
});

test('move → save → reload: the moved shape carries the delta, untouched shapes do not', async () => {
  const loaded = await load(FIXTURE_XML);
  const { canvas, definitions } = loaded;
  const task = node(canvas, 'Task_1');
  const untouchedBefore = boundsOf(definitions, 'Start_1');

  const dx = 40;
  const dy = -25;
  const from = center(task);
  dragBy(canvas, from, { x: from.x + dx, y: from.y + dy });

  const { xml, reloaded } = await roundTrip(loaded);

  // The serialized XML really carries the new bounds (not just the in-memory scene).
  expect(xml).toContain('<dc:Bounds x="240" y="55" width="100" height="80" />');
  expect(boundsOf(reloaded, 'Task_1')).toEqual({ x: 240, y: 55, width: 100, height: 80 });
  // …and every untouched shape is byte-identical.
  expect(boundsOf(reloaded, 'Start_1')).toEqual(untouchedBefore);
  expect(boundsOf(reloaded, 'End_1')).toEqual({ x: 400, y: 100, width: 36, height: 36 });
});

test('move: a connected edge re-routes orthogonally; the far shape is not moved', async () => {
  const loaded = await load(FIXTURE_XML);
  const { canvas, definitions } = loaded;
  const task = node(canvas, 'Task_1');

  const dx = 40;
  const dy = -25;
  const from = center(task);
  dragBy(canvas, from, { x: from.x + dx, y: from.y + dy });

  // Parity spec addendum 2 §3+§5: a move does not merely drag the docking point along
  // — it re-lays the connection out, so the two flows come back as clean Z-jogs
  // through the middle of the gap, cropped to both outlines. Every segment is
  // axis-aligned, which is the whole reason for doing it.
  const flow1 = edge(canvas, 'Flow_1').waypoints;
  expect(flow1).toEqual([
    { x: 136, y: 118 }, { x: 188, y: 118 }, { x: 188, y: 95 }, { x: 240, y: 95 },
  ]);
  expect(waypointsOf(definitions, 'Flow_1')).toEqual(flow1);
  const flow2 = edge(canvas, 'Flow_2').waypoints;
  expect(flow2).toEqual([
    { x: 340, y: 95 }, { x: 370, y: 95 }, { x: 370, y: 118 }, { x: 400, y: 118 },
  ]);
  expect(waypointsOf(definitions, 'Flow_2')).toEqual(flow2);

  // The shapes at the far ends stayed exactly where they were.
  expect(boundsOf(definitions, 'Start_1')).toEqual({ x: 100, y: 100, width: 36, height: 36 });
  expect(boundsOf(definitions, 'End_1')).toEqual({ x: 400, y: 100, width: 36, height: 36 });

  const { reloaded } = await roundTrip(loaded);
  expect(waypointsOf(reloaded, 'Flow_1')).toEqual(flow1);
  expect(waypointsOf(reloaded, 'Flow_2')).toEqual(flow2);
});

test('move: a multi-node selection moves together by one delta', async () => {
  const { canvas, definitions } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  const start = node(canvas, 'Start_1');
  canvas.getSelection().select([task, start]);

  const from = center(task);
  dragBy(canvas, from, { x: from.x + 30, y: from.y + 30 });

  expect({ x: task.x, y: task.y }).toEqual({ x: 230, y: 110 });
  expect({ x: start.x, y: start.y }).toEqual({ x: 130, y: 130 });
  expect(boundsOf(definitions, 'Start_1')).toEqual({ x: 130, y: 130, width: 36, height: 36 });
  // Flow_1 has BOTH endpoints moving → every waypoint translates, keeping its shape.
  expect(waypointsOf(definitions, 'Flow_1')).toEqual([{ x: 166, y: 148 }, { x: 230, y: 150 }]);
});

// --- resize ------------------------------------------------------------------

/**
 * A point inside a resize chip's hit square. The chips sit ON the shape's corners
 * (diagram-js `getReferencePoint`), pushed 6 units outward, with a 20x20 invisible
 * hit area — so a few units diagonally out of the corner lands squarely in one.
 */
function handlePoint(n: SceneNode, anchor: 'se' | 'nw'): Pt {
  const pad = 4;
  return anchor === 'se'
    ? { x: n.x + n.width + pad, y: n.y + n.height + pad }
    : { x: n.x - pad, y: n.y - pad };
}

test('resize: dragging the se handle updates width/height AND di.bounds', async () => {
  const loaded = await load(FIXTURE_XML);
  const { canvas, definitions } = loaded;
  const task = node(canvas, 'Task_1');
  click(canvas, center(task));
  expect(canvas.getSelection().get().map((e) => e.id)).toEqual(['Task_1']);

  const grab = handlePoint(task, 'se');
  dragBy(canvas, grab, { x: grab.x + 60, y: grab.y + 40 });

  expect({ x: task.x, y: task.y, width: task.width, height: task.height })
    .toEqual({ x: 200, y: 80, width: 160, height: 120 });
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 200, y: 80, width: 160, height: 120 });

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain('<dc:Bounds x="200" y="80" width="160" height="120" />');
  expect(boundsOf(reloaded, 'Task_1')).toEqual({ x: 200, y: 80, width: 160, height: 120 });
  expect(boundsOf(reloaded, 'End_1')).toEqual({ x: 400, y: 100, width: 36, height: 36 });
});

test('resize: the nw handle moves the origin and grows the box', async () => {
  const { canvas, definitions } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  click(canvas, center(task));

  const grab = handlePoint(task, 'nw');
  dragBy(canvas, grab, { x: grab.x - 20, y: grab.y - 10 });

  expect({ x: task.x, y: task.y, width: task.width, height: task.height })
    .toEqual({ x: 180, y: 70, width: 120, height: 90 });
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 180, y: 70, width: 120, height: 90 });
});

/**
 * The floor is the RULES' floor for that node's type (`rules/rules.ts` `minSizeFor`
 * — 100×80 for an activity), not one global number: a gesture must never produce
 * bounds `Rules.canResize` would then reject.
 */
test('resize: the per-type minimum from the rules is respected', async () => {
  const { canvas, definitions } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  expect(canvas.getRules().minSizeFor(task)).toEqual({ width: 100, height: 80 });
  click(canvas, center(task));

  const grab = handlePoint(task, 'se');
  dragBy(canvas, grab, { x: grab.x - 500, y: grab.y - 500 });

  expect({ width: task.width, height: task.height }).toEqual({ width: 100, height: 80 });
  // The anchored (nw) corner stays put.
  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 80 });
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 200, y: 80, width: 100, height: 80 });
});

/** A single global floor still wins when the host pins one (`CanvasOptions.minNodeSize`). */
test('resize: an explicit minNodeSize overrides the per-type floor', async () => {
  const { canvas } = await load(FIXTURE_XML, { minNodeSize: 20 });
  const task = node(canvas, 'Task_1');
  click(canvas, center(task));

  const grab = handlePoint(task, 'se');
  dragBy(canvas, grab, { x: grab.x - 500, y: grab.y - 500 });

  expect({ width: task.width, height: task.height }).toEqual({ width: 20, height: 20 });
});

test('resize: connected edges re-dock onto the new outline', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  click(canvas, center(task));

  const grab = handlePoint(task, 'se');
  dragBy(canvas, grab, { x: grab.x + 60, y: grab.y + 40 });

  // Task is now (200,80 160×120); Flow_2 leaves it toward (400,118), so its docking
  // waypoint sits on the new right edge (x = 360), not the old one (x = 300).
  const flow2 = edge(canvas, 'Flow_2');
  expect(flow2.waypoints[0].x).toBe(360);
  expect(flow2.waypoints[0].y).toBeGreaterThan(80);
  expect(flow2.waypoints[0].y).toBeLessThan(200);
  expect(flow2.waypoints[1]).toEqual({ x: 400, y: 118 });
  // Flow_1 enters from the left → its last waypoint docks on the new left edge.
  expect(edge(canvas, 'Flow_1').waypoints[1].x).toBe(200);
});

// --- waypoints ---------------------------------------------------------------

test('waypoint drag: updates edge.waypoints AND di.waypoint, and survives a round-trip', async () => {
  const loaded = await load(FIXTURE_XML);
  const { canvas, definitions } = loaded;
  const flow = edge(canvas, 'Flow_2');

  // Select the edge by clicking its midpoint (clear of both shapes).
  click(canvas, { x: 350, y: 119 });
  expect(canvas.getSelection().get().map((e) => e.id)).toEqual(['Flow_2']);

  // Grab waypoint 0 exactly where the overlay draws its handle. It is a TERMINAL
  // waypoint dropped clear of every shape, so it free-moves — and that is now the
  // bendpoint gesture: the tip lands on the pointer, its neighbour stays put, and the
  // run between them is left diagonal.
  dragBy(canvas, { x: 300, y: 120 }, { x: 320, y: 150 });

  const moved = [{ x: 320, y: 150 }, { x: 400, y: 118 }];
  expect(flow.waypoints).toEqual(moved);
  expect(flow.di).toBe(diEdge(definitions, 'Flow_2'));
  expect(waypointsOf(definitions, 'Flow_2')).toEqual(moved);

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain('<di:waypoint x="320" y="150" />');
  expect(waypointsOf(reloaded, 'Flow_2')).toEqual(moved);
  // The untouched edge is unchanged.
  expect(waypointsOf(reloaded, 'Flow_1')).toEqual([{ x: 136, y: 118 }, { x: 200, y: 120 }]);
});

// --- snapping, events, cancel -------------------------------------------------

test('grid snap: ON by default (addendum 7), and turned off it leaves the delta exact', async () => {
  const stock = await loadStock(FIXTURE_XML);
  expect(stock.canvas.isSnapToGrid()).toBe(true);
  const task = node(stock.canvas, 'Task_1');
  const from = center(task);
  // (+7, +23) keeps the shape's centre clear of every neighbour's, so ALIGNMENT
  // snapping (which is always on — parity spec §7) does not claim either axis and
  // the grid gets both.
  dragBy(stock.canvas, from, { x: from.x + 7, y: from.y + 23 });
  expect({ x: task.x, y: task.y }).toEqual({ x: 210, y: 100 });
  expect(boundsOf(stock.definitions, 'Task_1')).toEqual({ x: 210, y: 100, width: 100, height: 80 });

  const plain = await load(FIXTURE_XML);
  expect(plain.canvas.isSnapToGrid()).toBe(false);
  const loose = node(plain.canvas, 'Task_1');
  const looseFrom = center(loose);
  dragBy(plain.canvas, looseFrom, { x: looseFrom.x + 7, y: looseFrom.y + 23 });
  expect({ x: loose.x, y: loose.y }).toEqual({ x: 207, y: 103 });

  // …and the switch works on a live canvas, not just at construction.
  plain.canvas.setSnapToGrid(true);
  expect(plain.canvas.isSnapToGrid()).toBe(true);
});

test('a committed drag bumps scene.revision and fires element.changed', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const scene = canvas.getScene()!;
  const before = scene.revision;
  const changed: string[] = [];
  canvas.getEventBus().on<ElementChangedEvent>('element.changed', (e) => changed.push(e.element.id));

  const task = node(canvas, 'Task_1');
  const from = center(task);
  dragBy(canvas, from, { x: from.x + 40, y: from.y - 25 });

  expect(scene.revision).toBeGreaterThan(before);
  expect(changed).toContain('Task_1');
  // Its followed edges are reported as changed too.
  expect(changed).toContain('Flow_1');
  expect(changed).toContain('Flow_2');
});

test('Escape cancels an in-flight drag and leaves the DI untouched', async () => {
  const { canvas, definitions } = await load(FIXTURE_XML);
  const scene = canvas.getScene()!;
  const revision = scene.revision;
  const task = node(canvas, 'Task_1');
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const from = center(task);

  pointerDown(canvas, from);
  pointerMove(canvas, { x: from.x + 60, y: from.y + 60 });
  expect(task.x, 'the scene moves live during the gesture').toBe(260);
  // …but the DI has NOT been written yet — writeback happens on drop.
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 200, y: 80, width: 100, height: 80 });

  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  pointerUp(canvas, { x: from.x + 60, y: from.y + 60 });

  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 80 });
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 200, y: 80, width: 100, height: 80 });
  expect(scene.revision).toBe(revision);
});

// --- Escape restores the snapshot EXACTLY (grid snap on) ----------------------

/**
 * A document that was NOT authored on a 10-unit grid — the normal case for anything
 * drawn elsewhere and imported. Every coordinate here is off-grid on purpose, so a
 * cancel that re-derives geometry by "re-applying the gesture with a zero delta"
 * would visibly move the shape (137 → 140) while the DI, which cancel deliberately
 * never writes, kept saying 137.
 */
const OFFGRID_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_3" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_3" isExecutable="false">
    <bpmn:task id="Task_1" name="Task"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Task_2" name="Other"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Task_1" targetRef="Task_2" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_3">
    <bpmndi:BPMNPlane id="Plane_3" bpmnElement="Process_3">
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="137" y="83" width="103" height="87" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="401" y="83" width="103" height="87" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="240" y="127" /><di:waypoint x="317" y="129" /><di:waypoint x="401" y="127" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** Press, move past the drag threshold, press Escape, release — the abandon path. */
function dragThenEscape(canvas: Canvas, from: Pt, to: Pt): void {
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  pointerDown(canvas, from);
  pointerMove(canvas, to);
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  pointerUp(canvas, to);
}

test('Escape under grid snap restores an off-grid move EXACTLY, and never writes the DI', async () => {
  const { canvas, definitions } = await load(OFFGRID_FIXTURE_XML, { snapToGrid: true });
  const scene = canvas.getScene()!;
  const revision = scene.revision;
  const task = node(canvas, 'Task_1');
  const flow = edge(canvas, 'Flow_1');
  const waypoints = flow.waypoints.map((p) => ({ ...p }));

  const from = center(task);
  dragThenEscape(canvas, from, { x: from.x + 63, y: from.y + 47 });

  // NOT 140/80: the snapshot is restored verbatim, so the scene and the DI agree.
  expect({ x: task.x, y: task.y }).toEqual({ x: 137, y: 83 });
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 137, y: 83, width: 103, height: 87 });
  expect(flow.waypoints).toEqual(waypoints);
  expect(waypointsOf(definitions, 'Flow_1')).toEqual(waypoints);
  expect(scene.revision).toBe(revision);
});

test('Escape under grid snap restores an off-grid resize EXACTLY (all four edges)', async () => {
  const { canvas, definitions } = await load(OFFGRID_FIXTURE_XML, { snapToGrid: true });
  const task = node(canvas, 'Task_1');

  for (const anchor of ['se', 'nw'] as const) {
    click(canvas, center(task));
    const grab = handlePoint(task, anchor);
    dragThenEscape(canvas, grab, { x: grab.x + 33, y: grab.y + 21 });

    expect({ x: task.x, y: task.y, width: task.width, height: task.height },
      `${anchor} handle`).toEqual({ x: 137, y: 83, width: 103, height: 87 });
    expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 137, y: 83, width: 103, height: 87 });
  }
});

test('Escape under grid snap restores an off-grid waypoint drag EXACTLY', async () => {
  const { canvas, definitions } = await load(OFFGRID_FIXTURE_XML, { snapToGrid: true });
  const flow = edge(canvas, 'Flow_1');
  const before = flow.waypoints.map((p) => ({ ...p }));
  canvas.getSelection().select(flow);

  const bend = { ...before[1] };
  dragThenEscape(canvas, bend, { x: bend.x + 40, y: bend.y - 30 });

  expect(flow.waypoints).toEqual(before);
  expect(waypointsOf(definitions, 'Flow_1')).toEqual(before);
});

// --- resize is rules-gated (a start event has a fixed footprint) --------------

test('resize: a non-resizable node offers no handle and cannot be resized', async () => {
  const { canvas, definitions } = await load(FIXTURE_XML);
  const start = node(canvas, 'Start_1');
  expect(canvas.getRules().canResize(start)).toBe(false);

  click(canvas, center(start));
  expect(canvas.getSelection().get().map((e) => e.id)).toEqual(['Start_1']);
  // No handle is drawn there, so the overlay reports no grab…
  expect(canvas.getSelection().handleAt(handlePoint(start, 'se'))).toBeUndefined();

  // …and a drag from that point leaves the event's footprint alone.
  const grab = handlePoint(start, 'se');
  dragBy(canvas, grab, { x: grab.x + 60, y: grab.y + 40 });
  expect({ x: start.x, y: start.y, width: start.width, height: start.height })
    .toEqual({ x: 100, y: 100, width: 36, height: 36 });
  expect(boundsOf(definitions, 'Start_1')).toEqual({ x: 100, y: 100, width: 36, height: 36 });
});

test('resize: the rules gate startDrag even when a stale handle hit is fed to it', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const start = node(canvas, 'Start_1');
  const drag = canvas.getDrag()!;
  canvas.getSelection().select(start);

  // The gesture layer itself would happily run it — the gate is `Rules.canResize`,
  // which `Canvas.startDrag` consults before ever opening the session.
  expect(canvas.getRules().canResize(start)).toBe(false);
  expect(drag.isActive()).toBe(false);
  const grab = handlePoint(start, 'se');
  pointerDown(canvas, grab);
  pointerMove(canvas, { x: grab.x + 40, y: grab.y + 40 });
  expect(drag.getKind()).toBeUndefined();
  pointerUp(canvas, { x: grab.x + 40, y: grab.y + 40 });
});

// --- shipped example ----------------------------------------------------------

test('drawn_loop: move → save → reload shows a DI delta ONLY where edited', async () => {
  const loaded = await loadExample('drawn_loop.studyflow.png');
  const { canvas, definitions } = loaded;
  const scene = canvas.getScene()!;

  // Pick a connected leaf shape whose centre is unambiguously its own.
  let target: SceneNode | undefined;
  for (const el of scene.elementsById.values()) {
    if (el.kind !== 'node' || el.children.length > 0 || el.width <= 0) continue;
    if (el.outgoing.length + el.incoming.length === 0) continue;
    if (canvas.hitTest(center(el))?.id !== el.id) continue;
    target = el;
    break;
  }
  expect(target, 'the example has a draggable connected leaf shape').toBeTruthy();
  const moved = target!;

  // Snapshot every shape's bounds, every BPMNLabel's bounds and every edge's
  // waypoints before the edit.
  const shapesBefore = new Map<string, any>();
  const labelsBefore = new Map<string, any>();
  const edgesBefore = new Map<string, any>();
  for (const diagram of definitions.diagrams ?? []) {
    for (const pe of diagram.plane?.planeElement ?? []) {
      const id = pe.bpmnElement?.id;
      if (!id) continue;
      if (pe.$type === 'bpmndi:BPMNShape' && pe.bounds) shapesBefore.set(id, { ...pe.bounds, $type: undefined });
      if (pe.label?.bounds) {
        const b = pe.label.bounds;
        labelsBefore.set(id, { x: b.x, y: b.y, width: b.width, height: b.height });
      }
      if (pe.$type === 'bpmndi:BPMNEdge') edgesBefore.set(id, (pe.waypoint ?? []).map((w: any) => ({ x: w.x, y: w.y })));
    }
  }

  const dx = 37;
  const dy = -19;
  const origin = { x: moved.x, y: moved.y };
  const from = center(moved);
  dragBy(canvas, from, { x: from.x + dx, y: from.y + dy });
  expect({ x: moved.x, y: moved.y }).toEqual({ x: origin.x + dx, y: origin.y + dy });

  const { reloaded } = await roundTrip(loaded);
  const touchedEdges = new Set([...moved.incoming, ...moved.outgoing].map((e) => e.id));

  for (const [id, before] of shapesBefore) {
    const after = boundsOf(reloaded, id);
    if (id === moved.id) {
      expect(after, `${id} carries the drag delta`).toEqual({
        x: before.x + dx,
        y: before.y + dy,
        width: before.width,
        height: before.height,
      });
    } else {
      expect(after, `${id} is untouched`).toEqual({
        x: before.x, y: before.y, width: before.width, height: before.height,
      });
    }
  }
  for (const [id, before] of labelsBefore) {
    const after = labelBoundsOf(reloaded, id);
    const delta = id === moved.id ? { dx, dy } : { dx: 0, dy: 0 };
    expect(after, `${id}'s BPMNLabel follows its shape`).toEqual({
      x: before.x + delta.dx, y: before.y + delta.dy, width: before.width, height: before.height,
    });
  }
  for (const [id, before] of edgesBefore) {
    const after = waypointsOf(reloaded, id);
    if (touchedEdges.has(id)) continue; // one docking waypoint legitimately moved
    expect(after, `${id} is untouched`).toEqual(before);
  }
  expect(touchedEdges.size, 'the moved shape really had connections').toBeGreaterThan(0);
});

// --- external labels ----------------------------------------------------------

/**
 * A shape whose external label is positioned explicitly by the document — the common
 * case: 241 of the 253 `bpmndi:BPMNLabel` elements across the shipped examples carry
 * a `dc:Bounds`. `Start_1`'s label is placed below it (the numbers mirror
 * `lablink_demo1`); `Start_2` carries a `BPMNLabel` with NO bounds, so the renderer
 * derives its placement and there is nothing to keep in sync.
 */
const LABEL_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_2" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_2" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Begin"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:startEvent id="Start_2" name="Other" />
    <bpmn:task id="Task_1" name="Task"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_2">
    <bpmndi:BPMNPlane id="Plane_2" bpmnElement="Process_2">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="180" y="200" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="186" y="243" width="24" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_2_di" bpmnElement="Start_2">
        <dc:Bounds x="180" y="400" width="36" height="36" />
        <bpmndi:BPMNLabel />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="300" y="180" width="100" height="80" />
        <bpmndi:BPMNLabel><dc:Bounds x="310" y="265" width="24" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="216" y="218" /><di:waypoint x="300" y="220" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** The `dc:Bounds` of a shape's `bpmndi:BPMNLabel`, read off the live moddle tree. */
function labelBoundsOf(definitions: any, id: string): { x: number; y: number; width: number; height: number } | undefined {
  const b = diShape(definitions, id)?.label?.bounds;
  return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : undefined;
}

test('move: an external label follows its shape in the scene AND in bpmndi:BPMNLabel', async () => {
  const loaded = await load(LABEL_FIXTURE_XML);
  const { canvas, definitions } = loaded;
  const start = node(canvas, 'Start_1');
  expect(labelBoundsOf(definitions, 'Start_1')).toEqual({ x: 186, y: 243, width: 24, height: 14 });
  expect({ x: start.label?.x, y: start.label?.y }).toEqual({ x: 186, y: 243 });

  const from = center(start);
  dragBy(canvas, from, { x: from.x + 100, y: from.y + 100 });

  // Scene: the shape and its label move by the same delta (the renderer draws the
  // label from label.x/y, so a stale value detaches it on the first frame).
  expect({ x: start.x, y: start.y }).toEqual({ x: 280, y: 300 });
  expect({ x: start.label?.x, y: start.label?.y }).toEqual({ x: 286, y: 343 });
  // DI: the very same BPMNLabel bounds object, mutated in place.
  expect(start.label?.di).toBe(diShape(definitions, 'Start_1').label);
  expect(labelBoundsOf(definitions, 'Start_1')).toEqual({ x: 286, y: 343, width: 24, height: 14 });

  // …and it survives save → reload.
  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain('<dc:Bounds x="286" y="343" width="24" height="14" />');
  expect(labelBoundsOf(reloaded, 'Start_1')).toEqual({ x: 286, y: 343, width: 24, height: 14 });
  expect(boundsOf(reloaded, 'Start_1')).toEqual({ x: 280, y: 300, width: 36, height: 36 });
  // An untouched shape's label is untouched.
  expect(labelBoundsOf(reloaded, 'Start_2')).toBeUndefined();
});

test('move: a multi-selection carries every external label', async () => {
  const { canvas, definitions } = await load(LABEL_FIXTURE_XML);
  const start = node(canvas, 'Start_1');
  const task = node(canvas, 'Task_1');
  canvas.getSelection().select([start, task]);

  const from = center(task);
  dragBy(canvas, from, { x: from.x - 30, y: from.y + 15 });

  expect({ x: start.x, y: start.y }).toEqual({ x: 150, y: 215 });
  expect(labelBoundsOf(definitions, 'Start_1')).toEqual({ x: 156, y: 258, width: 24, height: 14 });
});

test('move: a BPMNLabel without dc:Bounds stays derived — no bounds is minted', async () => {
  const loaded = await load(LABEL_FIXTURE_XML);
  const { canvas, definitions } = loaded;
  const start = node(canvas, 'Start_2');
  expect(start.label, 'the shape has a BPMNLabel').toBeTruthy();
  expect(start.label?.x).toBeUndefined();

  const from = center(start);
  dragBy(canvas, from, { x: from.x + 50, y: from.y + 50 });

  expect(boundsOf(definitions, 'Start_2')).toEqual({ x: 230, y: 450, width: 36, height: 36 });
  expect(diShape(definitions, 'Start_2').label.bounds).toBeUndefined();
  const { xml } = await roundTrip(loaded);
  expect(xml).toContain('<bpmndi:BPMNLabel />');
});

/**
 * Resized on `Task_1`, not on the start event: an event has a fixed BPMN footprint,
 * so `Rules.canResize` refuses it and the overlay draws no handles for it (see
 * `canvas-selection.unit.spec.ts`).
 */
test('resize: a positioned label re-anchors to the shape centre, in the scene and the DI', async () => {
  const loaded = await load(LABEL_FIXTURE_XML);
  const { canvas, definitions } = loaded;
  const task = node(canvas, 'Task_1');
  click(canvas, center(task));
  expect(canvas.getSelection().get().map((e) => e.id)).toEqual(['Task_1']);

  const grab = handlePoint(task, 'se');
  dragBy(canvas, grab, { x: grab.x + 60, y: grab.y + 40 });

  // The centre moved by half the se delta → so did the label.
  expect({ x: task.width, y: task.height }).toEqual({ x: 160, y: 120 });
  expect({ x: task.label?.x, y: task.label?.y }).toEqual({ x: 340, y: 285 });
  expect(labelBoundsOf(definitions, 'Task_1')).toEqual({ x: 340, y: 285, width: 24, height: 14 });

  const { reloaded } = await roundTrip(loaded);
  expect(labelBoundsOf(reloaded, 'Task_1')).toEqual({ x: 340, y: 285, width: 24, height: 14 });
});

test('Escape mid-drag restores the label too, and never writes the BPMNLabel', async () => {
  const { canvas, definitions } = await load(LABEL_FIXTURE_XML);
  const start = node(canvas, 'Start_1');
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const from = center(start);

  pointerDown(canvas, from);
  pointerMove(canvas, { x: from.x + 60, y: from.y + 60 });
  expect({ x: start.label?.x, y: start.label?.y }).toEqual({ x: 246, y: 303 });
  expect(labelBoundsOf(definitions, 'Start_1'), 'the DI is written on drop, not per frame')
    .toEqual({ x: 186, y: 243, width: 24, height: 14 });

  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  pointerUp(canvas, { x: from.x + 60, y: from.y + 60 });

  expect({ x: start.label?.x, y: start.label?.y }).toEqual({ x: 186, y: 243 });
  expect(labelBoundsOf(definitions, 'Start_1')).toEqual({ x: 186, y: 243, width: 24, height: 14 });
});

test('lablink_demo1: a labelled shape moves label-and-all through save → reload', async () => {
  const loaded = await loadExample('lablink_demo1.studyflow.png');
  const { canvas, definitions } = loaded;
  const scene = canvas.getScene()!;

  let target: SceneNode | undefined;
  for (const el of scene.elementsById.values()) {
    if (el.kind !== 'node' || el.children.length > 0 || el.width <= 0) continue;
    if (el.label?.x === undefined || el.label.y === undefined) continue;
    if (canvas.hitTest(center(el))?.id !== el.id) continue;
    target = el;
    break;
  }
  expect(target, 'the example has a hittable shape with a positioned label').toBeTruthy();
  const moved = target!;
  const beforeShape = boundsOf(definitions, moved.id);
  const beforeLabel = labelBoundsOf(definitions, moved.id)!;

  const dx = 100;
  const dy = 100;
  const from = center(moved);
  dragBy(canvas, from, { x: from.x + dx, y: from.y + dy });

  const { reloaded } = await roundTrip(loaded);
  expect(boundsOf(reloaded, moved.id)).toEqual({
    x: beforeShape.x + dx, y: beforeShape.y + dy, width: beforeShape.width, height: beforeShape.height,
  });
  expect(labelBoundsOf(reloaded, moved.id)).toEqual({
    x: beforeLabel.x + dx, y: beforeLabel.y + dy, width: beforeLabel.width, height: beforeLabel.height,
  });
});

// --- pools and lanes ----------------------------------------------------------

/**
 * A collaboration: one pool divided by a lane and holding a start event + task, a
 * second pool holding a task, and a message flow across the two. Pool/lane
 * containment lives in `processRef` / `flowNodeRef`, NOT in the moddle `$parent`
 * chain, so this is the shape of document that used to let a pool drag walk away
 * from its own contents — and commit those broken bounds to the DI.
 */
const COLLAB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_1" name="Pool one" processRef="Process_1" />
    <bpmn:participant id="Pool_2" name="Pool two" processRef="Process_2" />
    <bpmn:messageFlow id="Msg_1" sourceRef="Task_1" targetRef="Task_2" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_1" name="Lane one">
        <bpmn:flowNodeRef>Start_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_1</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="Task one"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
  </bpmn:process>
  <bpmn:process id="Process_2" isExecutable="false">
    <bpmn:task id="Task_2" name="Task two" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_1_di" bpmnElement="Lane_1" isHorizontal="true">
        <dc:Bounds x="30" y="0" width="570" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Pool_2_di" bpmnElement="Pool_2" isHorizontal="true">
        <dc:Bounds x="0" y="400" width="600" height="150" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="200" y="440" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="200" y="118" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Msg_1_di" bpmnElement="Msg_1">
        <di:waypoint x="250" y="158" /><di:waypoint x="250" y="440" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** The pool header strip — inside the pool, outside every lane. */
const POOL_1_HEADER = { x: 15, y: 125 };
/** Empty lane interior — clear of both shapes and of the sequence flow. */
const LANE_1_EMPTY = { x: 500, y: 200 };

test('collaboration: a pool owns its lane, and the lane owns its flow nodes', async () => {
  const { canvas } = await load(COLLAB_XML);
  const pool = node(canvas, 'Pool_1');
  const lane = node(canvas, 'Lane_1');

  expect(lane.parent).toBe(pool);
  expect(pool.children).toContain(lane);
  expect(node(canvas, 'Start_1').parent).toBe(lane);
  expect(node(canvas, 'Task_1').parent).toBe(lane);
  // The second pool has no lanes: its task hangs off the pool directly.
  expect(node(canvas, 'Task_2').parent).toBe(node(canvas, 'Pool_2'));
});

test('move: dragging a pool carries its lane and every shape inside it, in the scene AND the DI', async () => {
  const loaded = await load(COLLAB_XML);
  const { canvas, definitions } = loaded;

  expect(canvas.hitTest(POOL_1_HEADER)?.id, 'the header strip grabs the pool').toBe('Pool_1');

  const dx = 50;
  const dy = 50;
  dragBy(canvas, POOL_1_HEADER, { x: POOL_1_HEADER.x + dx, y: POOL_1_HEADER.y + dy });

  const expected: Record<string, { x: number; y: number; width: number; height: number }> = {
    Pool_1: { x: 50, y: 50, width: 600, height: 250 },
    Lane_1: { x: 80, y: 50, width: 570, height: 250 },
    Start_1: { x: 150, y: 150, width: 36, height: 36 },
    Task_1: { x: 250, y: 128, width: 100, height: 80 },
    // The other pool is untouched.
    Pool_2: { x: 0, y: 400, width: 600, height: 150 },
    Task_2: { x: 200, y: 440, width: 100, height: 80 },
  };
  for (const [id, bounds] of Object.entries(expected)) {
    const n = node(canvas, id);
    expect({ x: n.x, y: n.y, width: n.width, height: n.height }, `${id} scene`).toEqual(bounds);
    expect(boundsOf(definitions, id), `${id} DI`).toEqual(bounds);
  }

  // The committed geometry still describes a pool that encloses its lane and its tasks
  // — the invariant the old $parent-only parenting broke.
  const pool = node(canvas, 'Pool_1');
  for (const id of ['Lane_1', 'Start_1', 'Task_1']) {
    const n = node(canvas, id);
    expect(n.x >= pool.x && n.x + n.width <= pool.x + pool.width, `${id} inside the pool`).toBe(true);
    expect(n.y >= pool.y && n.y + n.height <= pool.y + pool.height, `${id} inside the pool`).toBe(true);
  }

  // Both endpoints of the internal flow moved, so it translates whole and keeps its
  // shape; the message flow, with only one end travelling, is re-routed instead —
  // out of the moved pool, through the middle of the vertical gap, into the other.
  expect(edge(canvas, 'Flow_1').waypoints).toEqual([{ x: 186, y: 168 }, { x: 250, y: 168 }]);
  expect(waypointsOf(definitions, 'Flow_1')).toEqual([{ x: 186, y: 168 }, { x: 250, y: 168 }]);
  expect(waypointsOf(definitions, 'Msg_1')).toEqual([
    { x: 300, y: 208 }, { x: 300, y: 324 }, { x: 250, y: 324 }, { x: 250, y: 440 },
  ]);

  // …and it all survives save → reload off the same tree.
  const { reloaded } = await roundTrip(loaded);
  for (const [id, bounds] of Object.entries(expected)) {
    expect(boundsOf(reloaded, id), `${id} reloaded`).toEqual(bounds);
  }
});

test('move: dragging a lane carries its contents but leaves the pool alone', async () => {
  const { canvas, definitions } = await load(COLLAB_XML);

  expect(canvas.hitTest(LANE_1_EMPTY)?.id, 'empty lane interior grabs the lane').toBe('Lane_1');

  // -30, not -20: at -20 the lane's centre lands within 7 units of the pool's, and
  // alignment snapping (parity spec §7) would legitimately pull it there.
  const dx = -30;
  const dy = 30;
  dragBy(canvas, LANE_1_EMPTY, { x: LANE_1_EMPTY.x + dx, y: LANE_1_EMPTY.y + dy });

  expect(boundsOf(definitions, 'Lane_1')).toEqual({ x: 0, y: 30, width: 570, height: 250 });
  expect(boundsOf(definitions, 'Start_1')).toEqual({ x: 70, y: 130, width: 36, height: 36 });
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 170, y: 108, width: 100, height: 80 });
  // The pool itself is not dragged along by its own lane.
  expect(boundsOf(definitions, 'Pool_1')).toEqual({ x: 0, y: 0, width: 600, height: 250 });
});

test('spirit2025: dragging the pool moves every lane and flow node it encloses', async () => {
  const loaded = await loadExample('spirit2025.studyflow.png');
  const { canvas, definitions } = loaded;
  const pool = node(canvas, 'Participant_SPIRIT');

  // Snapshot the root plane only (the example also carries subprocess sub-planes).
  const before = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const pe of definitions.diagrams[0].plane.planeElement ?? []) {
    const id = pe.bpmnElement?.id;
    if (pe.$type === 'bpmndi:BPMNShape' && id && pe.bounds) {
      before.set(id, { x: pe.bounds.x, y: pe.bounds.y, width: pe.bounds.width, height: pe.bounds.height });
    }
  }
  expect(before.size, 'the root plane draws the pool, its lanes and its flow nodes').toBeGreaterThan(5);

  // The header strip left of the lanes is the only place the pool itself is hit.
  const grab = { x: pool.x + 15, y: pool.y + pool.height / 2 };
  expect(canvas.hitTest(grab)?.id).toBe('Participant_SPIRIT');

  const dx = 45;
  const dy = -30;
  dragBy(canvas, grab, { x: grab.x + dx, y: grab.y + dy });

  const { reloaded } = await roundTrip(loaded);
  for (const [id, b] of before) {
    expect(boundsOf(reloaded, id), `${id} rides along with its pool`).toEqual({
      x: b.x + dx, y: b.y + dy, width: b.width, height: b.height,
    });
  }
});

// --- drag feedback (ux-spec §7) ----------------------------------------------

/** The overlay layer, where the ghost's dimmed originals and snap lines live. */
function overlays(canvas: Canvas): Element {
  return canvas.getSvg().querySelector('[data-layer="overlays"]')!;
}

test('drag feedback: the moved element becomes the ghost and leaves a dimmed copy behind', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  const svg = canvas.getSvg();
  const from = center(task);

  click(canvas, from);
  pointerDown(canvas, from);
  pointerMove(canvas, { x: from.x + 60, y: from.y + 40 });

  // The live element IS the ghost: the style layer paints `.sf-dragger` as a blue
  // outline with no fills, so nothing has to be rendered twice.
  const gfx = canvas.getGraphics('Task_1')!;
  expect(gfx.classList.contains('sf-dragger')).toBe(true);
  // …and a frozen copy of where it came from stays behind at 0.3. It is a picture,
  // not an element: nothing may address it by the id it copies.
  const frozen = overlays(canvas).querySelector('.sf-drag-originals')!;
  expect(frozen).not.toBeNull();
  expect(frozen.querySelectorAll('.sf-dragging').length).toBeGreaterThan(0);
  expect(frozen.querySelectorAll('[data-element-id]')).toHaveLength(0);
  // Every attached connection fades to gray — `sf-dragging-edge`, NOT `sf-dragger`
  // — so the ghost is the only blue thing on screen (dnd/frame_05).
  expect(canvas.getGraphics('Flow_1')!.classList.contains('sf-dragging-edge')).toBe(true);
  expect(canvas.getGraphics('Flow_1')!.classList.contains('sf-dragger')).toBe(false);
  // The shape's own resize chips step aside while it is the one moving.
  expect(svg.querySelectorAll('[data-layer="selection"] .sf-resizers[data-overlay-for="Task_1"]'))
    .toHaveLength(0);

  pointerUp(canvas, { x: from.x + 60, y: from.y + 40 });
  expect(canvas.getGraphics('Task_1')!.classList.contains('sf-dragger')).toBe(false);
  expect(canvas.getGraphics('Flow_1')!.classList.contains('sf-dragging-edge')).toBe(false);
  expect(overlays(canvas).querySelector('.sf-drag-originals')).toBeNull();
  // The chips come back around the shape at its new home.
  expect(svg.querySelectorAll('[data-layer="selection"] .sf-resizers[data-overlay-for="Task_1"]'))
    .toHaveLength(1);
});

test('drag feedback: Escape takes the ghost down with the gesture', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const from = center(task);

  click(canvas, from);
  pointerDown(canvas, from);
  pointerMove(canvas, { x: from.x + 60, y: from.y + 40 });
  expect(overlays(canvas).querySelector('.sf-drag-originals')).not.toBeNull();

  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(overlays(canvas).querySelector('.sf-drag-originals')).toBeNull();
  expect(canvas.getGraphics('Task_1')!.classList.contains('sf-dragger')).toBe(false);
});

test('drag feedback: a resize hides that shape\'s chips, and restores them on drop', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  const svg = canvas.getSvg();
  click(canvas, center(task));
  const grab = handlePoint(task, 'se');

  pointerDown(canvas, grab);
  pointerMove(canvas, { x: grab.x + 60, y: grab.y + 40 });
  expect(canvas.getGraphics('Task_1')!.classList.contains('sf-resizing')).toBe(true);
  expect(svg.querySelectorAll('[data-layer="selection"] .sf-resizers')).toHaveLength(0);

  pointerUp(canvas, { x: grab.x + 60, y: grab.y + 40 });
  expect(canvas.getGraphics('Task_1')!.classList.contains('sf-resizing')).toBe(false);
  expect(svg.querySelectorAll('[data-layer="selection"] .sf-resizers')).toHaveLength(1);
});

test('direct editing: the inline editor hides that shape\'s chips but keeps its outline', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  const svg = canvas.getSvg();
  const chips = () => svg.querySelectorAll('[data-layer="selection"] .sf-resizer-visual').length;

  click(canvas, center(task));
  expect(chips()).toBe(8);

  firePointer(canvas, svg, 'dblclick', center(task));
  expect(canvas.getLabelEditing().isActive()).toBe(true);
  // The reference state (parity spec §5): outline yes, handles no. The eight chips
  // around a box being typed into advertise a gesture the editor is not offering, and
  // a stale chip must not be able to start one either.
  const g = canvas.getGraphics('Task_1')!;
  expect(chips()).toBe(0);
  expect(canvas.getSelection().handleAt(handlePoint(task, 'se'))).toBeUndefined();
  expect(g.querySelector('.sf-outline')).not.toBeNull();
  expect(g.classList.contains('selected')).toBe(true);
  // …and, unlike a resize, the outline is NOT suppressed with them.
  expect(g.classList.contains('sf-resizing')).toBe(false);

  canvas.getLabelEditing().cancel();
  expect(chips()).toBe(8);

  // A committed edit gives them back too, not just an abandoned one.
  firePointer(canvas, svg, 'dblclick', center(task));
  expect(chips()).toBe(0);
  canvas.getLabelEditing().complete();
  expect(chips()).toBe(8);
});

test('snap lines: a move that aligns with a neighbour snaps to it and draws the guide', async () => {
  const { canvas, definitions } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  const start = node(canvas, 'Start_1');

  // Start's centre is (118, 118); the task's is (250, 120). Drop the task's centre
  // one unit BELOW the start event's — inside diagram-js's 7-unit tolerance.
  const from = center(task);
  const to = { x: from.x + 60, y: start.y + start.height / 2 + 1 };

  click(canvas, from);
  pointerDown(canvas, from);
  pointerMove(canvas, to);

  // Pulled onto the alignment: the centres are level, exactly.
  expect(task.y + task.height / 2).toBe(start.y + start.height / 2);
  expect(task.y).toBe(78);
  // …and the x axis, which lines up with nothing, ran free.
  expect(task.x).toBe(260);

  const lines = overlays(canvas).querySelectorAll('.sf-snap-line');
  expect(lines, 'one guide: the horizontal alignment that was taken').toHaveLength(1);
  expect(lines[0].getAttribute('y1')).toBe('118');
  expect(lines[0].getAttribute('y2')).toBe('118');

  pointerUp(canvas, to);
  // The snapped geometry is what gets committed to the DI, not the raw pointer.
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 260, y: 78, width: 100, height: 80 });
  expect(overlays(canvas).querySelectorAll('.sf-snap-line')).toHaveLength(0);
});

test('snap lines: a drag that aligns with nothing draws none and is left alone', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  const from = center(task);
  const to = { x: from.x + 37, y: from.y + 53 };

  click(canvas, from);
  pointerDown(canvas, from);
  pointerMove(canvas, to);

  expect({ x: task.x, y: task.y }).toEqual({ x: 237, y: 133 });
  expect(overlays(canvas).querySelectorAll('.sf-snap-line')).toHaveLength(0);
  pointerUp(canvas, to);
});

test('snap lines: both axes can take at once, and Escape leaves nothing behind', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  const end = node(canvas, 'End_1');
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const from = center(task);
  // Two units off End_1's centre on both axes (418, 118).
  const to = { x: end.x + end.width / 2 + 2, y: end.y + end.height / 2 - 2 };

  click(canvas, from);
  pointerDown(canvas, from);
  pointerMove(canvas, to);

  expect(task.x + task.width / 2).toBe(418);
  expect(task.y + task.height / 2).toBe(118);
  const lines = overlays(canvas).querySelectorAll('.sf-snap-line');
  expect(lines).toHaveLength(2);
  expect(lines[0].getAttribute('x1')).toBe('418');
  expect(lines[1].getAttribute('y1')).toBe('118');

  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 80 });
  expect(overlays(canvas).querySelectorAll('.sf-snap-line')).toHaveLength(0);
});

test('snap lines: a GRID landing draws none — the guides mean alignment and nothing else', async () => {
  const { canvas } = await load(FIXTURE_XML, { snapToGrid: true });
  const task = node(canvas, 'Task_1');
  const from = center(task);

  click(canvas, from);
  pointerDown(canvas, from);
  pointerMove(canvas, { x: from.x + 33, y: from.y + 17 });

  // The shape really did land on the grid…
  expect({ x: task.x, y: task.y }).toEqual({ x: 230, y: 100 });
  // …and drew no guide for it. A snap line is an ALIGNMENT with a neighbour (parity
  // spec §7); the reference draws none for a grid landing, because the dot grid is
  // already showing where the steps are.
  expect(overlays(canvas).querySelectorAll('.sf-snap-line')).toHaveLength(0);

  pointerUp(canvas, { x: from.x + 33, y: from.y + 17 });
  expect(overlays(canvas).querySelectorAll('.sf-snap-line')).toHaveLength(0);
});

test('drag: connected edges re-route on every frame, and are gray rather than blue', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  const flow = edge(canvas, 'Flow_2');
  const from = center(task);

  expect(flow.waypoints, 'a straight two-point flow to start with').toHaveLength(2);

  click(canvas, from);
  pointerDown(canvas, from);
  pointerMove(canvas, { x: from.x, y: from.y + 60 });

  // MID-GESTURE the elbow already exists: the connection is being laid out live, not
  // frozen and re-drawn on drop (parity spec addendum 2 §3).
  expect(flow.waypoints.length, 'the elbow forms while the shape is in flight')
    .toBeGreaterThan(2);
  for (let i = 1; i < flow.waypoints.length; i += 1) {
    const a = flow.waypoints[i - 1];
    const b = flow.waypoints[i];
    expect(a.x === b.x || a.y === b.y, `segment ${i} is axis-aligned`).toBe(true);
  }
  expect(canvas.getGraphics('Flow_2')!.classList.contains('sf-dragging-edge')).toBe(true);

  pointerUp(canvas, { x: from.x, y: from.y + 60 });
  expect(canvas.getGraphics('Flow_2')!.classList.contains('sf-dragging-edge')).toBe(false);
});

test('lasso: the rect and the root class the secondary outline colour keys off', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const svg = canvas.getSvg();
  const from = { x: 100, y: 40 };
  const to = { x: 460, y: 220 };

  // The lasso is the palette tool's, not an empty-canvas drag's (parity spec §8).
  canvas.activateLasso();
  pointerDown(canvas, from);
  pointerMove(canvas, to);
  const rect = overlays(canvas).querySelector('.sf-lasso-overlay')!;
  expect(rect).not.toBeNull();
  // Fill, stroke and weight are the style layer's; the geometry is here.
  expect([rect.getAttribute('x'), rect.getAttribute('y'), rect.getAttribute('width'), rect.getAttribute('height')])
    .toEqual(['100', '40', '360', '180']);
  expect(svg.classList.contains('sf-dragging-active-lasso')).toBe(true);

  // Enclosed elements are OUTLINED live (the root class turns them secondary blue)
  // but not yet selected: `selection.changed` fires once, on release.
  expect(canvas.getGraphics('Task_1')!.classList.contains('selected')).toBe(true);
  expect(canvas.getGraphics('Task_1')!.querySelector('.sf-outline')).not.toBeNull();
  expect(canvas.getSelection().get()).toEqual([]);

  pointerUp(canvas, to);
  expect(overlays(canvas).querySelector('.sf-lasso-overlay')).toBeNull();
  expect(svg.classList.contains('sf-dragging-active-lasso')).toBe(false);
  expect(canvas.getSelection().get().length).toBeGreaterThan(1);
});

test('lasso: an abandoned marquee leaves no marks behind', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;

  canvas.activateLasso();
  pointerDown(canvas, { x: 100, y: 40 });
  pointerMove(canvas, { x: 460, y: 220 });
  expect(canvas.getGraphics('Task_1')!.classList.contains('selected')).toBe(true);

  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(canvas.getGraphics('Task_1')!.classList.contains('selected')).toBe(false);
  expect(canvas.getSelection().get()).toEqual([]);
  expect(overlays(canvas).querySelector('.sf-lasso-overlay')).toBeNull();
});

test('lasso: Shift adds to the selection instead of replacing it (parity spec §8)', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const selection = canvas.getSelection();
  const changes: number[] = [];
  canvas.getEventBus().on('selection.changed', () => changes.push(selection.get().length));

  // Start from something already selected, well outside the rectangle to come.
  const end = node(canvas, 'End_1');
  selection.select(end);
  changes.length = 0;

  // A shift-marquee over the start event and the task only.
  canvas.activateLasso();
  pointerDown(canvas, { x: 60, y: 40 }, { shiftKey: true });
  pointerMove(canvas, { x: 320, y: 220 }, { shiftKey: true });
  // Marked live, and the standing selection keeps its own mark throughout.
  expect(canvas.getGraphics('Task_1')!.classList.contains('selected')).toBe(true);
  expect(canvas.getGraphics('End_1')!.classList.contains('selected')).toBe(true);
  expect(changes).toEqual([]);

  pointerUp(canvas, { x: 320, y: 220 }, { shiftKey: true });
  expect(selection.get().map((e) => e.id).sort()).toEqual(['End_1', 'Start_1', 'Task_1']);
  // One event for the whole gesture, on release — never one per pointer frame.
  expect(changes).toEqual([3]);

  // …and without Shift the same rectangle REPLACES the selection (the tool is
  // one-shot, so it has to be armed again).
  canvas.activateLasso();
  pointerDown(canvas, { x: 60, y: 40 });
  pointerMove(canvas, { x: 320, y: 220 });
  pointerUp(canvas, { x: 320, y: 220 });
  expect(selection.get().map((e) => e.id).sort()).toEqual(['Start_1', 'Task_1']);
});

// --- move as a re-parenting drop ---------------------------------------------

/** Root task beside an EXPANDED sub-process that already holds one child. */
const REPARENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:task id="Task_1" name="Outside" />
    <bpmn:subProcess id="Sub_1">
      <bpmn:task id="Inner_1" name="Inner" />
    </bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="100" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub_1_di" bpmnElement="Sub_1" isExpanded="true">
        <dc:Bounds x="400" y="60" width="320" height="220" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Inner_1_di" bpmnElement="Inner_1">
        <dc:Bounds x="440" y="120" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('move: dropping a shape inside an expanded sub-process re-parents it (BO + scene)', async () => {
  const loaded = await load(REPARENT_XML);
  const { canvas, definitions } = loaded;
  const task = node(canvas, 'Task_1');
  const sub = node(canvas, 'Sub_1');
  const process = definitions.rootElements.find((el: any) => el.id === 'Process_1');
  expect(process.flowElements.map((el: any) => el.id)).toContain('Task_1');

  // Drag the task's centre into empty interior of the sub-process frame.
  dragBy(canvas, center(task), { x: 620, y: 220 });

  expect(task.parent).toBe(sub);
  expect(sub.children).toContain(task);
  // Business object refiled: subProcess.flowElements gains it, process loses it.
  expect((sub.businessObject as any).flowElements.map((el: any) => el.id)).toContain('Task_1');
  expect(process.flowElements.map((el: any) => el.id)).not.toContain('Task_1');
  expect(task.businessObject.$parent).toBe(sub.businessObject);

  // …and it serializes that way: the task's XML element sits under the subProcess.
  const { xml } = await roundTrip(loaded);
  expect(xml).toMatch(/<bpmn:subProcess[^>]*>[\s\S]*id="Task_1"[\s\S]*<\/bpmn:subProcess>/);
});

test('move: dragging a child OUT of a sub-process re-parents it back to the root', async () => {
  const { canvas, definitions } = await load(REPARENT_XML);
  const inner = node(canvas, 'Inner_1');
  const sub = node(canvas, 'Sub_1');
  const process = definitions.rootElements.find((el: any) => el.id === 'Process_1');
  expect(inner.parent).toBe(sub);

  // Drag the inner task's centre onto empty canvas, clear of the frame.
  dragBy(canvas, center(inner), { x: 150, y: 400 });

  expect(inner.parent).toBeUndefined();
  expect(sub.children).not.toContain(inner);
  expect(sub.businessObject.flowElements ?? []).not.toContain(inner.businessObject);
  expect(process.flowElements.map((el: any) => el.id)).toContain('Inner_1');
});

test('move: dragging within the same container re-parents nothing', async () => {
  const { canvas, definitions } = await load(REPARENT_XML);
  const inner = node(canvas, 'Inner_1');
  const sub = node(canvas, 'Sub_1');
  const process = definitions.rootElements.find((el: any) => el.id === 'Process_1');

  // A short hop that stays inside the frame.
  dragBy(canvas, center(inner), { x: 620, y: 220 });

  expect(inner.parent).toBe(sub);
  expect((sub.businessObject as any).flowElements.map((el: any) => el.id)).toContain('Inner_1');
  expect(process.flowElements.map((el: any) => el.id)).not.toContain('Inner_1');
});

/**
 * A flow whose live re-route would cross a third shape (`RouteOptions.obstacles`).
 *
 * `Start_1` is dragged below `Blocker_1`; the elbow the router prefers — out along
 * the dominant (horizontal) axis first — then runs the length of the blocker. The
 * same two points bent the other way is clean, and that is what a move now picks.
 */
const BLOCKED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="Task"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:task id="Blocker_1" name="Blocker" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="400" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Blocker_1_di" bpmnElement="Blocker_1">
        <dc:Bounds x="200" y="280" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="400" y="140" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** Whether the axis-aligned segment `p`–`q` passes through `box`. */
function segmentCrosses(p: Pt, q: Pt, box: { x: number; y: number; width: number; height: number }): boolean {
  return Math.min(p.x, q.x) < box.x + box.width && Math.max(p.x, q.x) > box.x
    && Math.min(p.y, q.y) < box.y + box.height && Math.max(p.y, q.y) > box.y;
}

test('a live re-route steers the moved flow around a third shape', async () => {
  const { canvas, definitions } = await load(BLOCKED_XML);
  const start = node(canvas, 'Start_1');
  const blocker = node(canvas, 'Blocker_1');

  // Drag the start event below the blocker: the preferred elbow would now leave
  // along y = 318 and run straight through it.
  dragBy(canvas, center(start), { x: center(start).x, y: center(start).y + 200 });

  const points = waypointsOf(definitions, 'Flow_1');
  expect(points.length).toBeGreaterThan(2);
  for (let i = 0; i < points.length - 1; i += 1) {
    expect(
      segmentCrosses(points[i], points[i + 1], blocker),
      `segment ${i} runs through the blocker`,
    ).toBe(false);
  }
  // It bent the other way — up out of the start event — rather than detouring.
  expect(points[1]).toEqual({ x: 118, y: 140 });
});

test('the shape that is being dragged is not an obstacle to its own flow', async () => {
  // Nothing else is in the way here, so the route must stay the plain one: a moving
  // node counted as an obstacle would make every candidate look blocked.
  const { canvas, definitions } = await load(FIXTURE_XML);
  const start = node(canvas, 'Start_1');

  dragBy(canvas, center(start), { x: center(start).x, y: center(start).y - 40 });

  expect(waypointsOf(definitions, 'Flow_1')).toEqual(route(start, node(canvas, 'Task_1')));
});

/**
 * An annotation associated with a task outside, and a sub-process to drag it into.
 *
 * An ASSOCIATION may cross a container boundary — it is an artifact, with no
 * execution semantics — where a sequence flow may not (`rules/rules.ts canMove`), so
 * this is the drop that still changes an edge's depth without re-homing the edge.
 */
const CROSSING_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:task id="Outside" name="Outside" />
    <bpmn:task id="Loose" name="Loose" />
    <bpmn:textAnnotation id="Note_1"><bpmn:text>Note</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="Assoc_1" sourceRef="Outside" targetRef="Note_1" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Outside" targetRef="Loose" />
    <bpmn:subProcess id="Sub_1" name="Sub" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Outside_di" bpmnElement="Outside">
        <dc:Bounds x="60" y="200" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub_1_di" bpmnElement="Sub_1" isExpanded="true">
        <dc:Bounds x="260" y="100" width="360" height="280" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Note_1_di" bpmnElement="Note_1">
        <dc:Bounds x="700" y="215" width="100" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Loose_di" bpmnElement="Loose">
        <dc:Bounds x="700" y="380" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Assoc_1_di" bpmnElement="Assoc_1">
        <di:waypoint x="160" y="240" /><di:waypoint x="700" y="240" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="160" y="260" /><di:waypoint x="700" y="420" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** The `data-element-id`s of the element layer, bottom-most first. */
function layerOrder(canvas: Canvas): string[] {
  const layer = canvas.getSvg().querySelector('[data-layer="elements"]')!;
  return [...layer.children].map((g) => g.getAttribute('data-element-id') ?? '');
}

test('dropping a connected shape into a sub-process lifts its edge above the frame', async () => {
  // The report: the edge lands BEHIND the sub-process, and a reload or an undo/redo
  // — anything that re-renders the whole scene — puts it right. An edge ranks at its
  // deepest endpoint (`zRankOf`), so the drop changed its z-order without re-homing
  // it (its two ends still share no container), and only the elements that WERE
  // re-homed used to be re-spliced.
  const { canvas } = await load(CROSSING_XML);
  const note = node(canvas, 'Note_1');

  expect(layerOrder(canvas).indexOf('Assoc_1')).toBeLessThan(layerOrder(canvas).indexOf('Sub_1'));

  dragBy(canvas, center(note), { x: 500, y: 300 });

  expect(note.parent?.id, 'the drop re-homed it').toBe('Sub_1');
  const order = layerOrder(canvas);
  expect(order.indexOf('Assoc_1')).toBeGreaterThan(order.indexOf('Sub_1'));
  // …and the whole layer still agrees with `zRankOf`, which is what a full re-render
  // would produce and used to be the only way to get it.
  const scene = canvas.getScene()!;
  const ranks = order.map((id) => zRankOf(scene.elementsById.get(id) as SceneElement));
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
});

test('a drop that would drag a sequence flow across the boundary is refused outright', async () => {
  // BPMN: a sequence flow lives in one `flowElements` container. `Loose` is reached by
  // one from `Outside`, so it cannot be dropped inside the sub-process — and a refused
  // drop puts the shape BACK rather than leaving it drawn inside a container it does
  // not belong to.
  const { canvas, definitions } = await load(CROSSING_XML);
  const loose = node(canvas, 'Loose');
  const before = { x: loose.x, y: loose.y };

  dragBy(canvas, center(loose), { x: 500, y: 300 });

  expect(loose.parent).toBeUndefined();
  expect({ x: loose.x, y: loose.y }).toEqual(before);
  expect(boundsOf(definitions, 'Loose')).toEqual({ ...before, width: 100, height: 80 });
});

test('a hand-placed bend survives moving the shape at either end', async () => {
  // The report: bend a flow, then move one of its shapes, and the whole route is
  // re-laid-out — the bend is gone. A route the author shaped is theirs; only the
  // docking end follows the shape, and the path is squared around it. This is the
  // rule `redockToOutline` and the resize path already followed.
  const { canvas, definitions } = await load(FIXTURE_XML);
  const flow = edge(canvas, 'Flow_2');
  const end = node(canvas, 'End_1');

  // Bend the flow down: press its body and drag, which inserts a joint.
  const body = { x: (flow.waypoints[0].x + flow.waypoints[1].x) / 2, y: flow.waypoints[0].y };
  canvas.getSelection().select(flow);
  dragBy(canvas, body, { x: body.x, y: body.y + 90 });
  const bent = flow.waypoints.map((p) => ({ x: p.x, y: p.y }));
  expect(bent.length).toBeGreaterThan(2);

  // Now move the END EVENT. The interior joints must still be there.
  dragBy(canvas, center(end), { x: center(end).x + 60, y: center(end).y });

  expect(flow.waypoints.length).toBe(bent.length);
  // The joints away from the moved end are untouched…
  expect(flow.waypoints[1]).toEqual(bent[1]);
  // …and the one BEHIND the dock came along, because that run is square and stays
  // square (`interaction/segments.ts moveTerminal`) — the rule an endpoint drag
  // follows, applied to the end a moving shape drags.
  const joint = flow.waypoints[flow.waypoints.length - 2];
  const last = flow.waypoints[flow.waypoints.length - 1];
  expect(joint.x).toBe(last.x);
  expect(joint.y).toBe(bent[bent.length - 2].y);
  // The docked end followed the shape and sits on its outline…
  expect(last.x).toBeGreaterThanOrEqual(end.x - 0.5);
  expect(last.x).toBeLessThanOrEqual(end.x + end.width + 0.5);
  // …and the DI has what the screen has.
  expect(waypointsOf(definitions, 'Flow_2')).toEqual(flow.waypoints);
});

test('a flow nobody has bent is still re-routed by a move', async () => {
  // The other half of the rule: a two-point route carries no decision of the user's,
  // so a move re-cuts it exactly as before.
  const { canvas } = await load(FIXTURE_XML);
  const start = node(canvas, 'Start_1');

  dragBy(canvas, center(start), { x: center(start).x, y: center(start).y - 90 });

  expect(edge(canvas, 'Flow_1').waypoints).toEqual(route(start, node(canvas, 'Task_1')));
});
