import { expect, test } from '@playwright/test';

import type { Canvas } from '@canvas/index.ts';
import { isContainerNode, pointInNode } from '@canvas/interaction/hit.ts';
import { CANVAS_CSS, CANVAS_STYLE_ID } from '@canvas/view/theme.ts';
import type { SceneEdge, SceneNode } from '@canvas/model/scene.ts';
import type { SelectionChangedEvent } from '@canvas/interaction/selection.ts';

import { exampleXml } from './utils';

import { freshModdle, jsdomWindow, loadCanvas as loadCanvasXml, pointerDown, pointerMove, pointerUp } from './canvasHarness';

/**
 * P2 hit-testing + selection + lasso (design §6). The canvas is presentation-
 * agnostic and driven through `tests/canvasHarness.ts`. We build a scene from a
 * shipped example and drive pointer events directly on the SVG DOM.
 *
 * jsdom has no layout engine, so `getBoundingClientRect` returns zeros and the
 * viewport maps screen↔diagram at unit scale with a `box.x/y` offset. That is
 * deterministic, so we compute every event's client coordinates from a diagram
 * point via `viewport.toScreen`, guaranteeing a clean round-trip regardless of the
 * (absent) layout.
 */

const win = jsdomWindow();

const EXAMPLE = 'drawn_loop.studyflow.png';
/** Carries a `bpmn:Group`, a pool/lane and an expanded subprocess — every frame kind. */
const NESTED_EXAMPLE = 'kitchensink.studyflow.png';

async function loadCanvas(example = EXAMPLE): Promise<Canvas> {
  const { canvas } = await loadCanvasXml(exampleXml(example));
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
  const ev = new win.MouseEvent(type, {
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
  pointerDown(canvas, center(node), opts);
  pointerUp(canvas, center(node), opts);
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

test('selection: click selects a single node and fires SelectionChanged', async () => {
  const canvas = await loadCanvas();
  const leaves = leafNodes(canvas);
  const node = leaves[0];

  const events: SelectionChangedEvent[] = [];
  canvas.getEventBus().on<SelectionChangedEvent>('SelectionChanged', (e) => events.push(e));

  click(canvas, node);

  expect(canvas.getSelection().get().map((e) => e.id)).toEqual([node.id]);
  expect(events.length, 'SelectionChanged fired').toBeGreaterThanOrEqual(1);
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

test('selection: a plain click on a member of a multi-selection collapses to it', async () => {
  const canvas = await loadCanvas();
  const svg = canvas.getSvg();
  const [a, b] = leafNodes(canvas);

  click(canvas, a);
  click(canvas, b, { shiftKey: true });
  expect(canvas.getSelection().get().map((e) => e.id)).toEqual([a.id, b.id]);
  expect(svg.classList.contains('sf-multi-select')).toBe(true);

  const events: SelectionChangedEvent[] = [];
  canvas.getEventBus().on<SelectionChangedEvent>('SelectionChanged', (e) => events.push(e));

  // diagram-js's SelectionBehavior on `element.click`: isSelected && multi && !add
  // collapses the set to the one element that was clicked.
  click(canvas, a);

  expect(canvas.getSelection().get().map((e) => e.id)).toEqual([a.id]);
  // The root class is what paints the SECONDARY blue; it has to go with the group.
  expect(svg.classList.contains('sf-multi-select')).toBe(false);
  expect(canvas.getGraphics(b.id)?.classList.contains('selected')).toBe(false);
  expect(events.map((e) => e.newSelection.map((s) => s.id))).toEqual([[a.id]]);

  // A second plain click on the now-single selection changes nothing and is silent.
  click(canvas, a);
  expect(canvas.getSelection().get().map((e) => e.id)).toEqual([a.id]);
  expect(events, 'no redundant SelectionChanged').toHaveLength(1);
});

test('selection: a PRESS on a multi-selection keeps the group, so a group drag moves all', async () => {
  const canvas = await loadCanvas();
  const [a, b] = leafNodes(canvas);
  const from = { x: a.x, y: a.y };
  const fromB = { x: b.x, y: b.y };

  click(canvas, a);
  click(canvas, b, { shiftKey: true });

  const start = center(a);
  pointerDown(canvas, start);
  // The press alone must NOT collapse — the gesture may still become a group drag.
  expect(canvas.getSelection().get().map((e) => e.id)).toEqual([a.id, b.id]);

  pointerMove(canvas, { x: start.x + 40, y: start.y + 20 });
  pointerUp(canvas, { x: start.x + 40, y: start.y + 20 });

  expect(canvas.getSelection().get().map((e) => e.id), 'a drag keeps the group').toEqual([a.id, b.id]);
  // Grid snapping is ON by default (parity spec addendum 7): the LEAD node's origin
  // lands on the 10-unit grid, and the whole group moves by THAT delta, not the raw one.
  const delta = {
    x: Math.round((from.x + 40) / 10) * 10 - from.x,
    y: Math.round((from.y + 20) / 10) * 10 - from.y,
  };
  expect({ x: a.x - from.x, y: a.y - from.y }).toEqual(delta);
  expect({ x: b.x - fromB.x, y: b.y - fromB.y }, 'the other member moved too').toEqual(delta);
});

test('selection: dblclick from a multi-selection leaves exactly one element selected', async () => {
  const canvas = await loadCanvas();
  const svg = canvas.getSvg();
  const [a, b] = leafNodes(canvas);

  canvas.getSelection().select([a, b]);
  expect(svg.classList.contains('sf-multi-select')).toBe(true);

  firePointer(canvas, svg, 'dblclick', center(a));

  // Otherwise the element being edited wears the secondary multi-select blue and a
  // second element stays outlined behind the editor (parity spec §5).
  expect(canvas.getSelection().get().map((e) => e.id)).toEqual([a.id]);
  expect(svg.classList.contains('sf-multi-select')).toBe(false);
  expect(canvas.getGraphics(b.id)?.classList.contains('selected')).toBe(false);
  expect(canvas.getLabelEditing().isActive()).toBe(true);
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
  pointerDown(canvas, empty);
  pointerUp(canvas, empty);

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

  // Dragging empty canvas PANS; the marquee belongs to the palette's lasso tool.
  canvas.activateLasso();
  pointerDown(canvas, start);
  pointerMove(canvas, end);
  pointerUp(canvas, end);

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
  const { canvas } = await loadCanvasXml(FRAMES_XML);
  return canvas;
}

/**
 * Overlapping frames that do NOT nest in the document: an expanded sub-process
 * (100,300 350×200) holding one task, a big `bpmn:Group` (60,260 500×180) laid over
 * its upper half, and a small group (300,440 60×40) sitting inside it. Both groups
 * are artifacts — neither is the sub-process's parent or child — and both are
 * declared AFTER it, so paint order puts them on top.
 *
 * This is the kitchensink geometry that made an expanded container impossible to
 * double-click shut: the group took every hit over the upper half of the frame and
 * the gesture opened a rename on the GROUP instead of collapsing the container.
 */
const OVERLAPPING_FRAMES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_2" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_2" isExecutable="false">
    <bpmn:subProcess id="Sub_1" name="Sub">
      <bpmn:task id="Child_1" name="Child" />
    </bpmn:subProcess>
    <bpmn:group id="Group_Big" />
    <bpmn:group id="Group_Small" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_2">
    <bpmndi:BPMNPlane id="Plane_2" bpmnElement="Process_2">
      <bpmndi:BPMNShape id="Sub_1_di" bpmnElement="Sub_1" isExpanded="true">
        <dc:Bounds x="100" y="300" width="350" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Child_1_di" bpmnElement="Child_1">
        <dc:Bounds x="150" y="380" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Group_Big_di" bpmnElement="Group_Big">
        <dc:Bounds x="60" y="260" width="500" height="180" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Group_Small_di" bpmnElement="Group_Small">
        <dc:Bounds x="300" y="440" width="60" height="40" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('hit-testing: among overlapping frames the innermost wins, not the last drawn', async () => {
  const { canvas } = await loadCanvasXml(OVERLAPPING_FRAMES_XML);
  const scene = canvas.getScene()!;
  const sub = scene.elementsById.get('Sub_1') as SceneNode;
  const big = scene.elementsById.get('Group_Big') as SceneNode;

  const overlap = { x: 420, y: 320 };
  expect(pointInNode(overlap, sub), 'the probe is inside the expanded sub-process').toBe(true);
  expect(pointInNode(overlap, big), 'and inside the group drawn over it').toBe(true);

  // The group is bigger, so the sub-process is the innermost frame under the point
  // even though the group paints above it — this is what makes a double click there
  // collapse the container instead of renaming the group.
  expect(canvas.hitTest(overlap)?.id, 'sub-process under an overlapping bigger group').toBe('Sub_1');

  // The rule is geometric, not type-based: a group SMALLER than the sub-process it
  // sits in still wins, and a point in the group alone still hits the group.
  expect(canvas.hitTest({ x: 330, y: 460 })?.id, 'small group inside the sub-process').toBe('Group_Small');
  expect(canvas.hitTest({ x: 100, y: 280 })?.id, 'group interior clear of the sub-process').toBe('Group_Big');

  // Leaves still outrank every frame over them.
  expect(canvas.hitTest({ x: 200, y: 420 })?.id, 'task inside both frames').toBe('Child_1');
});

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

// --- the overlay offers only the gestures the rules allow --------------------

/** The `<g class="sf-resizers">` drawn for one node, if any. */
function resizersFor(canvas: Canvas, id: string): Element | null {
  return canvas.getSvg().querySelector(`[data-layer="selection"] .sf-resizers[data-overlay-for="${id}"]`);
}

/** Connections of the loaded scene, narrowed for the type checker. */
function edgesOf(canvas: Canvas): SceneEdge[] {
  const out: SceneEdge[] = [];
  for (const el of canvas.getScene()!.elementsById.values()) {
    if (el.kind === 'edge') out.push(el);
  }
  return out;
}

/** The lazily created `.sf-outline` living inside an element's own `<g>`. */
function outlineFor(canvas: Canvas, id: string): Element | null {
  return canvas.getGraphics(id)?.querySelector('.sf-outline') ?? null;
}

test('overlay: a resizable node gets eight handles, a fixed-footprint one gets none', async () => {
  const canvas = await loadCanvas();
  const scene = canvas.getScene()!;
  const nodes: SceneNode[] = [];
  for (const el of scene.elementsById.values()) if (el.kind === 'node') nodes.push(el);
  const task = nodes.find((n) => n.type.endsWith('Task'))!;
  const event = nodes.find((n) => n.type === 'bpmn:StartEvent' || n.type === 'bpmn:EndEvent')!;
  expect(canvas.getRules().canResize(task)).toBe(true);
  expect(canvas.getRules().canResize(event)).toBe(false);

  canvas.getSelection().select(task);
  expect(outlineFor(canvas, task.id)).not.toBeNull();
  expect(resizersFor(canvas, task.id)!.querySelectorAll('.sf-resizer-visual')).toHaveLength(8);

  // An event/gateway has a fixed BPMN footprint: outline, no handles — and the
  // overlay's own hit test agrees, so a press there never opens a resize.
  canvas.getSelection().select(event);
  expect(outlineFor(canvas, event.id)).not.toBeNull();
  expect(resizersFor(canvas, event.id)).toBeNull();
  expect(canvas.getSelection().isResizable(event)).toBe(false);
  expect(canvas.getSelection().handleAt({ x: event.x - 4, y: event.y - 4 })).toBeUndefined();
});

test('overlay: a multi-selection draws handles only around the resizable members', async () => {
  const canvas = await loadCanvas();
  const scene = canvas.getScene()!;
  const nodes: SceneNode[] = [];
  for (const el of scene.elementsById.values()) if (el.kind === 'node') nodes.push(el);
  const task = nodes.find((n) => n.type.endsWith('Task'))!;
  const event = nodes.find((n) => n.type === 'bpmn:StartEvent' || n.type === 'bpmn:EndEvent')!;

  canvas.getSelection().select([task, event]);
  expect(outlineFor(canvas, task.id)).not.toBeNull();
  expect(outlineFor(canvas, event.id)).not.toBeNull();
  expect(canvas.getSvg().querySelectorAll('[data-layer="selection"] .sf-resizer-visual'))
    .toHaveLength(8);
});

// --- parity: outline geometry, chrome, hover (ux-spec §2, §3, §6, §7) ---------

test('outline: geometry is per shape kind (activity / gateway / event)', async () => {
  const canvas = await loadCanvas(NESTED_EXAMPLE);
  const scene = canvas.getScene()!;
  const nodes: SceneNode[] = [];
  for (const el of scene.elementsById.values()) if (el.kind === 'node') nodes.push(el);
  const selection = canvas.getSelection();

  // Activity: inset -5 all round, corner radius = the shape's own (10) + 4.
  const task = nodes.find((n) => n.type === 'bpmn:UserTask' || n.type === 'bpmn:Task')!;
  selection.select(task);
  const taskOutline = outlineFor(canvas, task.id)!;
  expect(taskOutline.tagName.toLowerCase()).toBe('rect');
  expect([
    taskOutline.getAttribute('x'),
    taskOutline.getAttribute('y'),
    taskOutline.getAttribute('width'),
    taskOutline.getAttribute('height'),
    taskOutline.getAttribute('rx'),
  ]).toEqual(['-5', '-5', String(task.width + 10), String(task.height + 10), '14']);

  // Gateway: inset INWARD by 2, rx 4, and turned 45° so it reads as a diamond.
  const gateway = nodes.find((n) => n.type.endsWith('Gateway'));
  if (gateway) {
    selection.select(gateway);
    const outline = outlineFor(canvas, gateway.id)!;
    expect([
      outline.getAttribute('x'),
      outline.getAttribute('y'),
      outline.getAttribute('width'),
      outline.getAttribute('height'),
      outline.getAttribute('rx'),
    ]).toEqual(['2', '2', String(gateway.width - 4), String(gateway.height - 4), '4']);
    expect(outline.getAttribute('transform'))
      .toBe(`rotate(45, ${gateway.width / 2}, ${gateway.height / 2})`);
  }

  // Events: a circle around the RING, +5 — and one more on an end event, whose
  // 4px stroke already pushes its visible edge half a stroke further out.
  const start = nodes.find((n) => n.type === 'bpmn:StartEvent')!;
  const end = nodes.find((n) => n.type === 'bpmn:EndEvent')!;
  for (const [event, extra] of [[start, 0], [end, 1]] as const) {
    selection.select(event);
    const outline = outlineFor(canvas, event.id)!;
    expect(outline.tagName.toLowerCase()).toBe('circle');
    // The ring bpmn-js draws: `Math.round((w + h) / 4)` — 18 for a 36x36 event, so
    // the outline is r=23 (start) / r=24 (end), parity spec §2.
    const ring = Math.round((event.width + event.height) / 4);
    expect(outline.getAttribute('r')).toBe(String(ring + 5 + extra));
    expect(outline.getAttribute('cx')).toBe(String(event.width / 2));
  }

});

test('outline: a selected connection gets none — its bendpoints are the selection', async () => {
  const canvas = await loadCanvas();
  const edge = edgesOf(canvas).find((el) => el.waypoints.length >= 2)!;
  canvas.getSelection().select(edge);
  expect(canvas.getGraphics(edge.id)!.querySelector('.sf-outline')).toBeNull();
  const dots = canvas.getSvg().querySelectorAll(
    `[data-layer="selection"] .sf-bendpoints[data-overlay-for="${edge.id}"] .sf-bendpoint-visual`,
  );
  expect(dots).toHaveLength(edge.waypoints.length);
  expect(dots[0].getAttribute('r')).toBe('4');
});

test('outline: created lazily, kept after deselection, and re-fitted after a resize', async () => {
  const canvas = await loadCanvas();
  const task = leafNodes(canvas).find((n) => n.type.endsWith('Task'))!;
  // Never selected → never minted. This is what keeps importing a large diagram cheap.
  expect(outlineFor(canvas, task.id)).toBeNull();

  canvas.getSelection().select(task);
  expect(outlineFor(canvas, task.id)).not.toBeNull();
  expect(canvas.getGraphics(task.id)!.classList.contains('selected')).toBe(true);

  canvas.getSelection().clear();
  // Still in the DOM, just not painting: the `selected` class is the whole toggle.
  expect(outlineFor(canvas, task.id)).not.toBeNull();
  expect(canvas.getGraphics(task.id)!.classList.contains('selected')).toBe(false);

  canvas.getSelection().select(task);
  task.width += 40;
  canvas.redrawElements([task]);
  expect(outlineFor(canvas, task.id)!.getAttribute('width')).toBe(String(task.width + 10));
});

test('resize handles: 8x8 chips at the diagram-js offsets, with per-corner cursors', async () => {
  const canvas = await loadCanvas();
  const task = leafNodes(canvas).find((n) => n.type.endsWith('Task'))!;
  canvas.getSelection().select(task);
  const resizers = resizersFor(canvas, task.id)!;

  const cursors: Record<string, string> = {
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  };
  const expectedOffset: Record<string, [number, number]> = {
    nw: [-10, -10], n: [-4, -10], ne: [2, -10], e: [2, -4],
    se: [2, 2], s: [-4, 2], sw: [-10, 2], w: [-10, -4],
  };

  for (const [anchor, [ox, oy]] of Object.entries(expectedOffset)) {
    const handle = resizers.querySelector(`.sf-resizer-${anchor}`)!;
    const visual = handle.querySelector('.sf-resizer-visual')!;
    expect(visual.getAttribute('width'), anchor).toBe('8');
    expect(visual.getAttribute('height'), anchor).toBe('8');
    expect([visual.getAttribute('x'), visual.getAttribute('y')], anchor)
      .toEqual([String(ox), String(oy)]);
    // The chip's own frame is the anchor point on the SHAPE's bounds, not the outline.
    const x = anchor.includes('w') ? task.x : anchor.includes('e') ? task.x + task.width : task.x + task.width / 2;
    const y = anchor.includes('n') ? task.y : anchor.includes('s') ? task.y + task.height : task.y + task.height / 2;
    expect(handle.getAttribute('transform'), anchor).toBe(`translate(${x}, ${y})`);
    // The cursor is the style layer's job; assert the class it keys off is there.
    expect(CANVAS_CSS, anchor).toContain(`.sf-canvas .sf-resizer-${anchor}`);
    expect(CANVAS_CSS, anchor).toContain(cursors[anchor]);
  }
});

test('hover: a shape is untouched; a connection reveals its bendpoints', async () => {
  const canvas = await loadCanvas();
  const svg = canvas.getSvg();
  const node = leafNodes(canvas)[0];
  const edge = edgesOf(canvas).find((el) => el.waypoints.length >= 2)!;

  const before = canvas.getGraphics(node.id)!.outerHTML;
  firePointer(canvas, svg, 'pointermove', center(node));
  // The single most counter-intuitive parity fact: hovering a shape changes NOTHING.
  expect(canvas.getGraphics(node.id)!.outerHTML).toBe(before);
  expect(canvas.getSelection().getHovered()).toBeUndefined();
  expect(svg.querySelectorAll('[data-layer="selection"] .sf-bendpoints')).toHaveLength(0);

  const a = edge.waypoints[0];
  const b = edge.waypoints[1];
  firePointer(canvas, svg, 'pointermove', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  expect(canvas.getSelection().getHovered()?.id).toBe(edge.id);
  expect(svg.querySelectorAll(`[data-layer="selection"] .sf-bendpoints[data-overlay-for="${edge.id}"] .sf-bendpoint-visual`))
    .toHaveLength(edge.waypoints.length);
  expect(
    svg.querySelector('.sf-bendpoint-visual')!.getAttribute('r'),
    'the parity spec pins the dot at r=4',
  ).toBe('4');

  // Off the line again and the bendpoints go with it.
  firePointer(canvas, svg, 'pointermove', { x: a.x - 400, y: a.y - 400 });
  expect(svg.querySelectorAll('[data-layer="selection"] .sf-bendpoints')).toHaveLength(0);
});

test('multi-select: the root carries the class the secondary outline colour keys off', async () => {
  const canvas = await loadCanvas();
  const leaves = leafNodes(canvas);
  const svg = canvas.getSvg();

  canvas.getSelection().select(leaves[0]);
  expect(svg.classList.contains('sf-multi-select')).toBe(false);

  canvas.getSelection().select([leaves[0], leaves[1]]);
  expect(svg.classList.contains('sf-multi-select')).toBe(true);
  // …and bendpoints are force-hidden while more than one thing is selected.
  const edge = edgesOf(canvas)[0];
  canvas.getSelection().select([leaves[0], edge]);
  expect(svg.querySelectorAll('[data-layer="selection"] .sf-bendpoints')).toHaveLength(0);
  expect(canvas.getSelection().waypointAt(edge.waypoints[0])).toBeUndefined();

  canvas.getSelection().select(leaves[0]);
  expect(svg.classList.contains('sf-multi-select')).toBe(false);
});

test('style layer: the parity colours and weights live in one place', () => {
  // Every value the parity spec pins, asserted where it is actually declared.
  // hsl() rather than rgb() because that is the notation diagram-js ships; the
  // conversions are exact: 205/100/45 = rgb(0,134,230), 205/100/50 = rgb(0,149,255),
  // 205/100/75 = rgb(128,202,255).
  expect(CANVAS_CSS).toContain('--sf-color-blue-205-100-45: hsl(205, 100%, 45%)');
  expect(CANVAS_CSS).toContain('--sf-color-blue-205-100-50: hsl(205, 100%, 50%)');
  expect(CANVAS_CSS).toContain('--sf-color-blue-205-100-75: hsl(205, 100%, 75%)');
  expect(CANVAS_CSS).toContain('--sf-snap-line-stroke-color: hsla(205, 100%, 45%, 0.3)');
  expect(CANVAS_CSS).toContain('--sf-lasso-fill-color: hsla(205, 100%, 50%, 0.15)');
  expect(CANVAS_CSS).toContain('--sf-element-dragging-opacity: 0.3');

  // Solid, with ONE deliberate exception: a selected caption's leader back to the
  // element it names is dashed (parity spec addendum 3 §3, `labels/frame_08`).
  expect(CANVAS_CSS.replace(/\.sf-label-leader\s*\{[^}]*\}/, '')).not.toContain('stroke-dasharray');
  expect(CANVAS_CSS).toContain('stroke-linecap: round');

  // The one hover rule that exists is on connections; there is no shape-hover rule.
  expect(CANVAS_CSS).not.toContain('.sf-shape.hover');
  expect(CANVAS_CSS).not.toContain(':hover');
});

test('style layer: injection is idempotent per document', async () => {
  const canvas = await loadCanvas();
  const doc = canvas.getSvg().ownerDocument!;
  expect(doc.querySelectorAll(`#${CANVAS_STYLE_ID}`)).toHaveLength(1);
  await loadCanvas();
  expect(doc.querySelectorAll(`#${CANVAS_STYLE_ID}`)).toHaveLength(1);
  expect(doc.getElementById(CANVAS_STYLE_ID)!.textContent).toBe(CANVAS_CSS);
});

test('export: toSVG carries no selection outline, handles or state classes', async () => {
  const canvas = await loadCanvas();
  const leaves = leafNodes(canvas);
  canvas.getSelection().select([leaves[0], leaves[1]]);
  expect(outlineFor(canvas, leaves[0].id)).not.toBeNull();

  const svg = canvas.toSVG();
  expect(svg).not.toContain('sf-outline');
  expect(svg).not.toContain('sf-resizer');
  expect(svg).not.toContain('sf-bendpoint');
  expect(svg).not.toContain('sf-multi-select');
  expect(svg).toContain('sf-shape');
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

/**
 * Markers are remembered in a map keyed by element ID, and IDs are minted PER
 * DOCUMENT (`model/ids.ts`) — so an entry that outlives the element it described
 * is not merely stale, it is a booby trap: the next element to be handed that ID
 * inherits a dead element's classes the first time `restoreMarkers` runs for it
 * (which the renderer does on every redraw, e.g. mid-drag). The two tests below
 * pin the two ways an ID stops being live: a whole new document, and a delete.
 */

test('markers: an import forgets them, so a re-used id starts clean', async () => {
  const canvas = await loadCanvas();
  const node = leafNodes(canvas)[0];
  const selection = canvas.getSelection();

  selection.addMarker(node.id, 'sf-highlight');
  expect(selection.hasMarker(node.id, 'sf-highlight')).toBe(true);

  // Re-import the SAME example: every id in the incoming document collides with
  // one from the outgoing one, which is precisely how a leak would surface.
  const moddle = freshModdle();
  const { rootElement } = await moddle.fromXML(exampleXml(EXAMPLE));
  canvas.importDefinitions(rootElement);
  expect(canvas.getScene()!.elementsById.get(node.id)).toBeDefined();

  expect(selection.hasMarker(node.id, 'sf-highlight')).toBe(false);
  // …and the redraw path cannot resurrect it either.
  selection.restoreMarkers(node.id);
  expect(canvas.getGraphics(node.id)?.classList.contains('sf-highlight')).toBe(false);
});

test('markers: deleting an element forgets its markers', async () => {
  const canvas = await loadCanvas();
  const node = leafNodes(canvas)[0];
  const selection = canvas.getSelection();

  selection.addMarker(node.id, 'sf-highlight');
  expect(selection.hasMarker(node.id, 'sf-highlight')).toBe(true);

  const removed = canvas.deleteElements(node);
  expect(removed.map((element) => element.id)).toContain(node.id);

  expect(selection.hasMarker(node.id, 'sf-highlight')).toBe(false);
});
