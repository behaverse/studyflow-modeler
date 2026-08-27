import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, setDocument } from '@canvas/index.ts';
import type { SceneNode } from '@canvas/model/scene.ts';

import { loadSchemaModels } from './schemas';

/**
 * The two snaps a move gesture runs under, and how they COMPOSE — parity spec
 * addendum 2 §2 (element alignment) plus addendum 7 (grid snapping on by default).
 *
 * diagram-js runs both at once and lets `Snapping` override `GridSnapping` where it
 * has something to say, per axis. That is the behaviour under test here:
 *
 * - inside the 7-unit tolerance the dragged shape's CENTRE lands exactly on a
 *   neighbour's, wherever that neighbour happens to be — on the grid or off it —
 *   and a hairline is drawn along the alignment it took;
 * - outside it the axis falls through to the 10-unit grid, and no guide is drawn,
 *   because the reference draws none for a grid landing;
 * - the two verdicts are independent, so one axis can align while the other steps.
 *
 * Everything runs under jsdom (`setDocument`), where the viewport maps screen to
 * diagram 1:1, so a pointer event's client coordinates round-trip exactly.
 */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const dom = new JSDOM('<!doctype html><html><body></body></html>');
setDocument(dom.window.document as unknown as Document);

/**
 * Two shapes far enough apart that a drag between them is unambiguous, and — this is
 * the point — an End event whose centre sits at (418, 123), OFF the 10-unit grid on
 * `y`. A shape pulled onto that centre proves alignment beat the grid rather than
 * merely agreeing with it.
 */
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:task id="Task_1" name="Task" />
    <bpmn:endEvent id="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="400" y="105" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(options: { snapToGrid?: boolean } = {}): Promise<{
  canvas: Canvas;
  definitions: any;
}> {
  const moddle = new BpmnModdle(structuredClone(packages)) as any;
  const { rootElement: definitions } = await moddle.fromXML(FIXTURE_XML);
  const canvas = new Canvas(options);
  canvas.importDefinitions(definitions);
  return { canvas, definitions };
}

interface Pt { x: number; y: number; }

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function centre(n: SceneNode): Pt {
  return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
}

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

/** Press on `from`, move to `to`, and STOP there — the gesture stays live. */
function dragTo(canvas: Canvas, from: Pt, to: Pt): void {
  const svg = canvas.getSvg();
  firePointer(canvas, svg, 'pointerdown', from);
  firePointer(canvas, svg.ownerDocument!, 'pointermove', to);
}

/** …and let go. */
function drop(canvas: Canvas, at: Pt): void {
  firePointer(canvas, canvas.getSvg().ownerDocument!, 'pointerup', at);
}

function guides(canvas: Canvas): Element[] {
  return Array.from(canvas.getSvg().querySelectorAll('.sf-snap-line'));
}

function boundsOf(definitions: any, id: string): { x: number; y: number } {
  for (const diagram of definitions.diagrams ?? []) {
    for (const pe of diagram.plane?.planeElement ?? []) {
      if (pe.$type === 'bpmndi:BPMNShape' && pe.bpmnElement?.id === id) {
        return { x: pe.bounds.x, y: pe.bounds.y };
      }
    }
  }
  throw new Error(`no BPMNShape for ${id}`);
}

test('grid snapping is on out of the box (addendum 7)', async () => {
  const { canvas } = await load();
  expect(canvas.isSnapToGrid()).toBe(true);
  // …and the documented escape hatch is still the only switch there is.
  canvas.setSnapToGrid(false);
  expect(canvas.isSnapToGrid()).toBe(false);
});

test('a drag within 7 units of a neighbour\'s centre lands EXACTLY on it, grid or no grid', async () => {
  const { canvas, definitions } = await load();
  const task = node(canvas, 'Task_1');
  const end = node(canvas, 'End_1');
  const target = centre(end);
  expect(target, 'the neighbour deliberately sits off-grid').toEqual({ x: 418, y: 123 });

  // Aim 3 units below and 4 right of the end event's centre — inside diagram-js's
  // 7-unit SNAP_TOLERANCE on both axes.
  const from = centre(task);
  const to = { x: target.x + 4, y: target.y + 3 };
  dragTo(canvas, from, to);

  // Exactly the neighbour's centre. Note 123 is NOT a multiple of 10: had the grid
  // been allowed to have the last word this would read 120, and the two shapes would
  // not be level at all.
  expect(centre(task)).toEqual({ x: 418, y: 123 });

  // One guide per axis that actually took, drawn along the alignment.
  const lines = guides(canvas);
  expect(lines).toHaveLength(2);
  expect(lines[0].getAttribute('x1')).toBe('418');
  expect(lines[1].getAttribute('y1')).toBe('123');

  drop(canvas, to);
  // What was on screen is what was committed — DI included.
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 368, y: 83 });
  expect(guides(canvas)).toHaveLength(0);
});

test('beyond the tolerance the drop quantizes to the 10-unit grid instead, with no guide', async () => {
  const { canvas, definitions } = await load();
  const task = node(canvas, 'Task_1');
  const from = centre(task);
  // (+33, +17) leaves the task's centre far from the end event's on both axes.
  const to = { x: from.x + 33, y: from.y + 17 };

  dragTo(canvas, from, to);
  expect({ x: task.x, y: task.y }).toEqual({ x: 230, y: 100 });
  expect(task.x % 10, 'x landed on the grid').toBe(0);
  expect(task.y % 10, 'y landed on the grid').toBe(0);
  expect(guides(canvas), 'a grid landing draws no hairline').toHaveLength(0);

  drop(canvas, to);
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 230, y: 100 });
});

test('alignment on one axis composes with the grid on the other', async () => {
  const { canvas, definitions } = await load();
  const task = node(canvas, 'Task_1');
  const end = node(canvas, 'End_1');
  const from = centre(task);
  // Level with the end event on y (2 units off, inside the tolerance) while x is
  // dragged somewhere with nothing to align to.
  const to = { x: from.x + 37, y: centre(end).y - 2 };

  dragTo(canvas, from, to);

  // y took the alignment — off-grid, exactly level with the neighbour…
  expect(task.y + task.height / 2).toBe(123);
  expect(task.y).toBe(83);
  // …and x, unclaimed, fell through to the grid: 250 + 37 = 287 → 290 → x = 240.
  expect(task.x).toBe(240);

  // …so exactly ONE guide is drawn: the axis that aligned.
  const lines = guides(canvas);
  expect(lines).toHaveLength(1);
  expect(lines[0].getAttribute('y1')).toBe('123');
  expect(lines[0].getAttribute('x1')).not.toBe(lines[0].getAttribute('x2'));

  drop(canvas, to);
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 240, y: 83 });
});

test('a keyboard nudge is not grid-snapped: 1 unit means 1 unit (parity spec §9)', async () => {
  const { canvas, definitions } = await load();
  const task = node(canvas, 'Task_1');
  canvas.getSelection().select(task);
  const svg = canvas.getSvg();

  svg.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect({ x: task.x, y: task.y }).toEqual({ x: 201, y: 80 });
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 201, y: 80 });

  // …and Shift still means 10, landing back on the grid by arithmetic, not by snap.
  svg.dispatchEvent(new dom.window.KeyboardEvent(
    'keydown',
    { key: 'ArrowDown', shiftKey: true, bubbles: true },
  ));
  expect({ x: task.x, y: task.y }).toEqual({ x: 201, y: 90 });
});

test('a resize grid-snaps the dragged edges too, and Escape still restores off-grid geometry', async () => {
  const { canvas, definitions } = await load();
  const task = node(canvas, 'Task_1');
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;

  firePointer(canvas, svg, 'pointerdown', centre(task));
  firePointer(canvas, doc, 'pointerup', centre(task));

  // The se chip sits on the corner with a 20x20 hit box; 4 units diagonally out of
  // the corner lands squarely in it.
  const grab = { x: task.x + task.width + 4, y: task.y + task.height + 4 };
  const to = { x: grab.x + 33, y: grab.y + 17 };
  firePointer(canvas, svg, 'pointerdown', grab);
  firePointer(canvas, doc, 'pointermove', to);
  expect(task.width % 10, 'the dragged edge landed on the grid').toBe(0);
  expect(task.height % 10).toBe(0);

  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  firePointer(canvas, doc, 'pointerup', to);
  expect({ x: task.x, y: task.y, width: task.width, height: task.height })
    .toEqual({ x: 200, y: 80, width: 100, height: 80 });
  expect(boundsOf(definitions, 'Task_1')).toEqual({ x: 200, y: 80 });
});
