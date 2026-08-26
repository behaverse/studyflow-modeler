import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, setDocument } from '@canvas/index.ts';
import type { SceneEdge, SceneNode } from '@canvas/model/scene.ts';
import type { ElementChangedEvent } from '@canvas/model/writeback.ts';

import { loadSchemaModels } from './schemas';
import { exampleXml } from './utils';

/**
 * P3 direct manipulation + DI writeback (design §6). The canvas runs under jsdom via
 * `setDocument` (same setup as `canvas-render`/`canvas-selection`), and gestures are
 * dispatched as real pointer events on the SVG DOM.
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

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const dom = new JSDOM('<!doctype html><html><body></body></html>');
setDocument(dom.window.document as unknown as Document);

interface Loaded {
  canvas: Canvas;
  definitions: any;
  /** The moddle instance the tree was parsed with — reused to serialize it back. */
  moddle: any;
}

function freshModdle(): any {
  return new BpmnModdle(structuredClone(packages)) as any;
}

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

async function load(xml: string, options: { snapToGrid?: boolean } = {}): Promise<Loaded> {
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(xml);
  const canvas = new Canvas(options);
  canvas.importDefinitions(definitions);
  return { canvas, definitions, moddle };
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

function firePointer(canvas: Canvas, target: EventTarget, type: string, diagram: Pt): void {
  const screen = canvas.getViewport().toScreen(diagram);
  target.dispatchEvent(new dom.window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: screen.x,
    clientY: screen.y,
    button: 0,
  }));
}

/** A full press–move–release gesture from one diagram point to another. */
function dragBy(canvas: Canvas, from: Pt, to: Pt): void {
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  firePointer(canvas, svg, 'pointerdown', from);
  firePointer(canvas, doc, 'pointermove', to);
  firePointer(canvas, doc, 'pointerup', to);
}

/** A press with no movement — selects whatever is under the point. */
function click(canvas: Canvas, at: Pt): void {
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  firePointer(canvas, svg, 'pointerdown', at);
  firePointer(canvas, doc, 'pointerup', at);
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

test('move: connected edge endpoints follow the node, the far endpoints do not', async () => {
  const loaded = await load(FIXTURE_XML);
  const { canvas, definitions } = loaded;
  const task = node(canvas, 'Task_1');

  const dx = 40;
  const dy = -25;
  const from = center(task);
  dragBy(canvas, from, { x: from.x + dx, y: from.y + dy });

  // Flow_1 targets the task → its LAST waypoint moves; its first (on Start_1) does not.
  expect(edge(canvas, 'Flow_1').waypoints).toEqual([{ x: 136, y: 118 }, { x: 240, y: 95 }]);
  expect(waypointsOf(definitions, 'Flow_1')).toEqual([{ x: 136, y: 118 }, { x: 240, y: 95 }]);
  // Flow_2 sources from the task → its FIRST waypoint moves.
  expect(edge(canvas, 'Flow_2').waypoints).toEqual([{ x: 340, y: 95 }, { x: 400, y: 118 }]);
  expect(waypointsOf(definitions, 'Flow_2')).toEqual([{ x: 340, y: 95 }, { x: 400, y: 118 }]);

  const { reloaded } = await roundTrip(loaded);
  expect(waypointsOf(reloaded, 'Flow_1')).toEqual([{ x: 136, y: 118 }, { x: 240, y: 95 }]);
  expect(waypointsOf(reloaded, 'Flow_2')).toEqual([{ x: 340, y: 95 }, { x: 400, y: 118 }]);
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

/** The centre of a resize handle drawn by the selection overlay (scale 1 under jsdom). */
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

test('resize: the nw handle moves the origin and shrinks the box', async () => {
  const { canvas, definitions } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  click(canvas, center(task));

  const grab = handlePoint(task, 'nw');
  dragBy(canvas, grab, { x: grab.x + 20, y: grab.y + 10 });

  expect({ x: task.x, y: task.y, width: task.width, height: task.height })
    .toEqual({ x: 220, y: 90, width: 80, height: 70 });
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 220, y: 90, width: 80, height: 70 });
});

test('resize: a minimum size is respected', async () => {
  const { canvas, definitions } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  click(canvas, center(task));

  const grab = handlePoint(task, 'se');
  dragBy(canvas, grab, { x: grab.x - 500, y: grab.y - 500 });

  expect({ width: task.width, height: task.height }).toEqual({ width: 20, height: 20 });
  // The anchored (nw) corner stays put.
  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 80 });
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 200, y: 80, width: 20, height: 20 });
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

  // Grab waypoint 0 exactly where the overlay draws its handle.
  dragBy(canvas, { x: 300, y: 120 }, { x: 320, y: 150 });

  expect(flow.waypoints).toEqual([{ x: 320, y: 150 }, { x: 400, y: 118 }]);
  expect(flow.di).toBe(diEdge(definitions, 'Flow_2'));
  expect(waypointsOf(definitions, 'Flow_2')).toEqual([{ x: 320, y: 150 }, { x: 400, y: 118 }]);

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain('<di:waypoint x="320" y="150" />');
  expect(waypointsOf(reloaded, 'Flow_2')).toEqual([{ x: 320, y: 150 }, { x: 400, y: 118 }]);
  // The untouched edge is unchanged.
  expect(waypointsOf(reloaded, 'Flow_1')).toEqual([{ x: 136, y: 118 }, { x: 200, y: 120 }]);
});

// --- snapping, events, cancel -------------------------------------------------

test('grid snap: off by default, snaps edited coordinates when enabled', async () => {
  const plain = await load(FIXTURE_XML);
  expect(plain.canvas.isSnapToGrid()).toBe(false);
  const loose = node(plain.canvas, 'Task_1');
  const looseFrom = center(loose);
  dragBy(plain.canvas, looseFrom, { x: looseFrom.x + 7, y: looseFrom.y + 3 });
  expect({ x: loose.x, y: loose.y }).toEqual({ x: 207, y: 83 });

  const snapped = await load(FIXTURE_XML, { snapToGrid: true });
  expect(snapped.canvas.isSnapToGrid()).toBe(true);
  const task = node(snapped.canvas, 'Task_1');
  const from = center(task);
  dragBy(snapped.canvas, from, { x: from.x + 7, y: from.y + 3 });
  expect({ x: task.x, y: task.y }).toEqual({ x: 210, y: 80 });
  expect(boundsOf(snapped.definitions, 'Task_1')).toEqual({ x: 210, y: 80, width: 100, height: 80 });
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

  firePointer(canvas, svg, 'pointerdown', from);
  firePointer(canvas, doc, 'pointermove', { x: from.x + 60, y: from.y + 60 });
  expect(task.x, 'the scene moves live during the gesture').toBe(260);
  // …but the DI has NOT been written yet — writeback happens on drop.
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 200, y: 80, width: 100, height: 80 });

  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  firePointer(canvas, doc, 'pointerup', { x: from.x + 60, y: from.y + 60 });

  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 80 });
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 200, y: 80, width: 100, height: 80 });
  expect(scene.revision).toBe(revision);
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

test('resize: an external label re-anchors to the shape centre, in the scene and the DI', async () => {
  const loaded = await load(LABEL_FIXTURE_XML);
  const { canvas, definitions } = loaded;
  const start = node(canvas, 'Start_1');
  click(canvas, center(start));
  expect(canvas.getSelection().get().map((e) => e.id)).toEqual(['Start_1']);

  const grab = handlePoint(start, 'se');
  dragBy(canvas, grab, { x: grab.x + 60, y: grab.y + 40 });

  // The centre moved by half the se delta → so did the label.
  expect({ x: start.width, y: start.height }).toEqual({ x: 96, y: 76 });
  expect({ x: start.label?.x, y: start.label?.y }).toEqual({ x: 216, y: 263 });
  expect(labelBoundsOf(definitions, 'Start_1')).toEqual({ x: 216, y: 263, width: 24, height: 14 });

  const { reloaded } = await roundTrip(loaded);
  expect(labelBoundsOf(reloaded, 'Start_1')).toEqual({ x: 216, y: 263, width: 24, height: 14 });
});

test('Escape mid-drag restores the label too, and never writes the BPMNLabel', async () => {
  const { canvas, definitions } = await load(LABEL_FIXTURE_XML);
  const start = node(canvas, 'Start_1');
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const from = center(start);

  firePointer(canvas, svg, 'pointerdown', from);
  firePointer(canvas, doc, 'pointermove', { x: from.x + 60, y: from.y + 60 });
  expect({ x: start.label?.x, y: start.label?.y }).toEqual({ x: 246, y: 303 });
  expect(labelBoundsOf(definitions, 'Start_1'), 'the DI is written on drop, not per frame')
    .toEqual({ x: 186, y: 243, width: 24, height: 14 });

  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  firePointer(canvas, doc, 'pointerup', { x: from.x + 60, y: from.y + 60 });

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

  // Both endpoints of the internal flow moved, so it translates whole; the message
  // flow only re-docks the end that moved.
  expect(edge(canvas, 'Flow_1').waypoints).toEqual([{ x: 186, y: 168 }, { x: 250, y: 168 }]);
  expect(waypointsOf(definitions, 'Flow_1')).toEqual([{ x: 186, y: 168 }, { x: 250, y: 168 }]);
  expect(waypointsOf(definitions, 'Msg_1')).toEqual([{ x: 300, y: 208 }, { x: 250, y: 440 }]);

  // …and it all survives save → reload off the same tree.
  const { reloaded } = await roundTrip(loaded);
  for (const [id, bounds] of Object.entries(expected)) {
    expect(boundsOf(reloaded, id), `${id} reloaded`).toEqual(bounds);
  }
});

test('move: dragging a lane carries its contents but leaves the pool alone', async () => {
  const { canvas, definitions } = await load(COLLAB_XML);

  expect(canvas.hitTest(LANE_1_EMPTY)?.id, 'empty lane interior grabs the lane').toBe('Lane_1');

  const dx = -20;
  const dy = 30;
  dragBy(canvas, LANE_1_EMPTY, { x: LANE_1_EMPTY.x + dx, y: LANE_1_EMPTY.y + dy });

  expect(boundsOf(definitions, 'Lane_1')).toEqual({ x: 10, y: 30, width: 570, height: 250 });
  expect(boundsOf(definitions, 'Start_1')).toEqual({ x: 80, y: 130, width: 36, height: 36 });
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 180, y: 108, width: 100, height: 80 });
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
