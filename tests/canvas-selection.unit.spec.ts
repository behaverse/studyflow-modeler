import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, isContainerNode, pointInNode, setDocument } from '@canvas/index.ts';
import type { SceneNode } from '@canvas/model/scene.ts';
import type { SelectionChangedEvent } from '@canvas/interaction/selection.ts';

import { loadSchemaModels } from './schemas';
import { exampleXml } from './utils';

/**
 * P2 hit-testing + selection + lasso (design §6). The canvas is presentation-
 * agnostic and runs under jsdom via `setDocument` (same setup as
 * `canvas-render.unit.spec.ts`). We build a scene from a shipped example and drive
 * pointer events directly on the SVG DOM.
 *
 * jsdom has no layout engine, so `getBoundingClientRect` returns zeros and the
 * viewport maps screen↔diagram at unit scale with a `box.x/y` offset. That is
 * deterministic, so we compute every event's client coordinates from a diagram
 * point via `viewport.toScreen`, guaranteeing a clean round-trip regardless of the
 * (absent) layout.
 */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

function freshModdle(): any {
  return new BpmnModdle(structuredClone(packages)) as any;
}

const dom = new JSDOM('<!doctype html><html><body></body></html>');
setDocument(dom.window.document as unknown as Document);

const EXAMPLE = 'drawn_loop.studyflow.png';
/** Carries a `bpmn:Group`, a pool/lane and an expanded subprocess — every frame kind. */
const NESTED_EXAMPLE = 'kitchensink.studyflow.png';

async function loadCanvas(example = EXAMPLE): Promise<Canvas> {
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(exampleXml(example));
  const canvas = new Canvas();
  canvas.importDefinitions(definitions);
  return canvas;
}

/** Leaf nodes with positive geometry — their centre hits themselves, not a child. */
function leafNodes(canvas: Canvas): SceneNode[] {
  const scene = canvas.getScene()!;
  const out: SceneNode[] = [];
  for (const el of scene.elementsById.values()) {
    if (el.kind === 'node' && el.children.length === 0 && el.width > 0 && el.height > 0) {
      out.push(el);
    }
  }
  return out;
}

function center(node: SceneNode): { x: number; y: number } {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

/** Dispatch a pointer-typed MouseEvent at a diagram point onto `target`. */
function firePointer(
  canvas: Canvas,
  target: EventTarget,
  type: string,
  diagram: { x: number; y: number },
  opts: { shiftKey?: boolean } = {},
): void {
  const screen = canvas.getViewport().toScreen(diagram);
  const ev = new dom.window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: screen.x,
    clientY: screen.y,
    button: 0,
    shiftKey: !!opts.shiftKey,
  });
  target.dispatchEvent(ev);
}

/** Simulate a click (down+up, no move) at a node's centre. */
function click(canvas: Canvas, node: SceneNode, opts: { shiftKey?: boolean } = {}): void {
  const svg = canvas.getSvg();
  const doc = canvas.getSvg().ownerDocument!;
  firePointer(canvas, svg, 'pointerdown', center(node), opts);
  firePointer(canvas, doc, 'pointerup', center(node), opts);
}

test('hit-testing: a point inside a shape returns that node; empty space returns none', async () => {
  const canvas = await loadCanvas();
  const leaves = leafNodes(canvas);
  expect(leaves.length, 'example has selectable leaf shapes').toBeGreaterThan(0);

  const node = leaves[0];
  const hit = canvas.hitTest(center(node));
  expect(hit?.id, 'centre of a shape hits that shape').toBe(node.id);

  // A point well outside the scene bounds hits nothing.
  let minX = Infinity;
  let minY = Infinity;
  for (const n of leaves) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
  }
  const empty = canvas.hitTest({ x: minX - 500, y: minY - 500 });
  expect(empty, 'empty space hits nothing').toBeUndefined();
});

test('hit-testing: a point on an edge polyline returns that edge', async () => {
  const canvas = await loadCanvas();
  const scene = canvas.getScene()!;
  let asserted = false;
  for (const el of scene.elementsById.values()) {
    if (el.kind !== 'edge' || el.waypoints.length < 2) continue;
    const a = el.waypoints[0];
    const b = el.waypoints[1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Only assert when the sample point is not swallowed by a node (nodes win).
    if (canvas.hitTest(mid, { tolerance: 3 })?.id === el.id) {
      asserted = true;
      expect(canvas.hitTest(mid, { tolerance: 3 })!.id).toBe(el.id);
      break;
    }
  }
  expect(asserted, 'at least one edge is hittable near its polyline').toBe(true);
});

test('selection: click selects a single node and fires selection.changed', async () => {
  const canvas = await loadCanvas();
  const leaves = leafNodes(canvas);
  const node = leaves[0];

  const events: SelectionChangedEvent[] = [];
  canvas.getEventBus().on<SelectionChangedEvent>('selection.changed', (e) => events.push(e));

  click(canvas, node);

  expect(canvas.getSelection().get().map((e) => e.id)).toEqual([node.id]);
  expect(events.length, 'selection.changed fired').toBeGreaterThanOrEqual(1);
  const last = events[events.length - 1];
  expect(last.newSelection.map((e) => e.id)).toEqual([node.id]);
  expect(last.oldSelection).toEqual([]);
  // The graphics gets a `selected` marker class.
  expect(canvas.getGraphics(node.id)?.classList.contains('selected')).toBe(true);
});

test('selection: shift-click adds to the selection', async () => {
  const canvas = await loadCanvas();
  const leaves = leafNodes(canvas);
  expect(leaves.length).toBeGreaterThanOrEqual(2);
  const [a, b] = leaves;

  click(canvas, a);
  click(canvas, b, { shiftKey: true });

  const ids = new Set(canvas.getSelection().get().map((e) => e.id));
  expect(ids.has(a.id)).toBe(true);
  expect(ids.has(b.id)).toBe(true);
  expect(ids.size).toBe(2);

  // Shift-clicking an already-selected node toggles it back out.
  click(canvas, a, { shiftKey: true });
  const after = canvas.getSelection().get().map((e) => e.id);
  expect(after).toEqual([b.id]);
});

test('selection: a plain click on empty space clears the selection', async () => {
  const canvas = await loadCanvas();
  const leaves = leafNodes(canvas);
  click(canvas, leaves[0]);
  expect(canvas.getSelection().get().length).toBe(1);

  let minX = Infinity;
  let minY = Infinity;
  for (const n of leaves) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
  }
  const empty = { x: minX - 300, y: minY - 300 };
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  firePointer(canvas, svg, 'pointerdown', empty);
  firePointer(canvas, doc, 'pointerup', empty);

  expect(canvas.getSelection().get().length).toBe(0);
});

test('lasso: a marquee over a region selects the intersecting nodes', async () => {
  const canvas = await loadCanvas();
  const leaves = leafNodes(canvas);

  // Bounds enclosing every leaf node.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of leaves) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }

  const start = { x: minX - 20, y: minY - 20 }; // empty space, above-left of all shapes
  const end = { x: maxX + 20, y: maxY + 20 };
  expect(canvas.hitTest(start), 'marquee starts on empty space').toBeUndefined();

  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  firePointer(canvas, svg, 'pointerdown', start);
  firePointer(canvas, doc, 'pointermove', end);
  firePointer(canvas, doc, 'pointerup', end);

  const selectedIds = new Set(canvas.getSelection().get().map((e) => e.id));
  // Every node whose bounds fall within the marquee is selected.
  for (const n of leaves) {
    expect(selectedIds.has(n.id), `${n.id} inside marquee is selected`).toBe(true);
  }
  // Selection contains only nodes (edges are not marquee-selectable).
  const scene = canvas.getScene()!;
  for (const id of selectedIds) {
    expect(scene.elementsById.get(id)?.kind).toBe('node');
  }
});

/**
 * Purpose-built frame fixture: a pool (0,0 600×250) holding start → task → end, with
 * a `bpmn:Group` (180,50 300×140) framing the task *and* declared AFTER it in the DI,
 * so a naive bounds-only, last-drawn-wins hit test hands every click to the group.
 * Frames must stay behind the shapes and edges they enclose.
 */
const FRAMES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_1" name="Pool" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="Task"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
    <bpmn:group id="Group_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="0" y="0" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="60" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="420" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Group_1_di" bpmnElement="Group_1">
        <dc:Bounds x="180" y="50" width="300" height="140" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="96" y="118" /><di:waypoint x="200" y="118" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="300" y="118" /><di:waypoint x="420" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function loadFrames(): Promise<Canvas> {
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(FRAMES_XML);
  const canvas = new Canvas();
  canvas.importDefinitions(definitions);
  return canvas;
}

test('hit-testing: frames rank below the shapes and edges they enclose', async () => {
  const canvas = await loadFrames();
  const scene = canvas.getScene()!;
  const pool = scene.elementsById.get('Pool_1') as SceneNode;
  const group = scene.elementsById.get('Group_1') as SceneNode;
  expect(isContainerNode(pool), 'a pool is a frame').toBe(true);
  expect(isContainerNode(group), 'a group is a frame').toBe(true);
  expect(pointInNode({ x: 250, y: 118 }, group), 'the group really overlaps the task').toBe(true);

  // A shape framed by the group (and the pool) still wins.
  expect(canvas.hitTest({ x: 250, y: 118 })?.id, 'task inside the group').toBe('Task_1');
  expect(canvas.hitTest({ x: 78, y: 118 })?.id, 'start event inside the pool').toBe('Start_1');

  // An edge routed through the group beats both frames.
  expect(canvas.hitTest({ x: 360, y: 118 })?.id, 'flow crossing the group').toBe('Flow_2');
  // An edge inside the pool but outside the group beats the pool.
  expect(canvas.hitTest({ x: 148, y: 118 })?.id, 'flow inside the pool').toBe('Flow_1');
});

test('hit-testing: the innermost frame wins when nothing else is under the point', async () => {
  const canvas = await loadFrames();

  // Inside the group (and the pool), clear of every shape and edge → the group.
  expect(canvas.hitTest({ x: 185, y: 55 })?.id, 'group interior').toBe('Group_1');
  // Inside the pool only → the pool.
  expect(canvas.hitTest({ x: 10, y: 10 })?.id, 'pool interior').toBe('Pool_1');
  // Outside everything → nothing.
  expect(canvas.hitTest({ x: -50, y: -50 }), 'outside the pool').toBeUndefined();
});

test('hit-testing: a collapsed subprocess is an opaque shape, not a frame', async () => {
  const canvas = await loadFrames();
  const scene = canvas.getScene()!;
  const task = scene.elementsById.get('Task_1') as SceneNode;
  const collapsed: SceneNode = { ...task, type: 'bpmn:SubProcess', isExpanded: false };
  const expanded: SceneNode = { ...task, type: 'bpmn:SubProcess', isExpanded: true };
  const unset: SceneNode = { ...task, type: 'bpmn:SubProcess' };
  expect(isContainerNode(collapsed)).toBe(false);
  expect(isContainerNode(expanded)).toBe(true);
  expect(isContainerNode(unset), 'DI without isExpanded draws expanded').toBe(true);
});

test('hit-testing: a frame in a shipped example does not swallow its contents', async () => {
  const canvas = await loadCanvas(NESTED_EXAMPLE);
  const scene = canvas.getScene()!;
  const nodes: SceneNode[] = [];
  for (const el of scene.elementsById.values()) if (el.kind === 'node') nodes.push(el);

  const frames = nodes.filter((n) => isContainerNode(n));
  const leaves = nodes.filter((n) => !isContainerNode(n) && n.width > 0 && n.height > 0);
  expect(frames.length, `${NESTED_EXAMPLE} has container frames`).toBeGreaterThan(0);

  let covered = 0;
  for (const leaf of leaves) {
    const pt = center(leaf);
    // Only leaves a frame overlaps — those a bounds-only test would hand to the
    // frame — and only where no *other* opaque shape also covers the point.
    if (!frames.some((f) => pointInNode(pt, f))) continue;
    if (leaves.some((other) => other !== leaf && pointInNode(pt, other))) continue;
    covered += 1;
    expect(canvas.hitTest(pt)?.id, `${leaf.id} inside a frame is still hittable`).toBe(leaf.id);
  }
  expect(covered, 'the example actually exercises frame-enclosed shapes').toBeGreaterThan(0);
});

test('markers: addMarker/removeMarker toggle a class on element graphics', async () => {
  const canvas = await loadCanvas();
  const node = leafNodes(canvas)[0];
  const selection = canvas.getSelection();

  selection.addMarker(node.id, 'sf-highlight');
  expect(canvas.getGraphics(node.id)?.classList.contains('sf-highlight')).toBe(true);
  expect(selection.hasMarker(node.id, 'sf-highlight')).toBe(true);

  selection.removeMarker(node.id, 'sf-highlight');
  expect(canvas.getGraphics(node.id)?.classList.contains('sf-highlight')).toBe(false);
  expect(selection.hasMarker(node.id, 'sf-highlight')).toBe(false);
});
