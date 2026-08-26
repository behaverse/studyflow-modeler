import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, CANVAS_CSS, setDocument } from '@canvas/index.ts';
import type { SceneNode } from '@canvas/model/scene.ts';

import { loadSchemaModels } from './schemas';

/**
 * Viewport gestures — parity spec §10 ("Zoom, pan and pointer gestures") and §8
 * ("the lasso is NOT available by dragging empty canvas").
 *
 * These are the three facts that separate this backend's navigation from the
 * reference's, all verified against the live bpmn-js editor:
 *
 * 1. dragging empty canvas PANS (it used to lasso);
 * 2. a plain wheel pans and `Ctrl`+wheel zooms about the cursor, with diagram-js's
 *    own `ZoomScroll` numbers — a -240 `deltaMode: 0` notch pans 180px and zooms
 *    1 → 1.16158640, both measured on the bpmn backend for comparison;
 * 3. the marquee belongs to the palette's lasso tool, which is one-shot.
 *
 * jsdom has no layout engine: `getBoundingClientRect` is all zeros, so screen and
 * diagram units are 1:1 and `getViewbox().scale` reads 1 (see `canvas-drag`).
 */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const dom = new JSDOM('<!doctype html><html><body></body></html>');
setDocument(dom.window.document as unknown as Document);

const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="Task"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
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
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="200" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(): Promise<Canvas> {
  const moddle = new BpmnModdle(structuredClone(packages)) as any;
  const { rootElement: definitions } = await moddle.fromXML(FIXTURE_XML);
  const canvas = new Canvas();
  canvas.importDefinitions(definitions);
  return canvas;
}

interface Pt { x: number; y: number; }

function firePointer(canvas: Canvas, target: EventTarget, type: string, diagram: Pt, init: MouseEventInit = {}): void {
  const screen = canvas.getViewport().toScreen(diagram);
  target.dispatchEvent(new dom.window.MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: screen.x, clientY: screen.y, button: 0, ...init,
  }));
}

function fireWheel(canvas: Canvas, init: WheelEventInit): void {
  canvas.getSvg().dispatchEvent(new dom.window.WheelEvent('wheel', {
    bubbles: true, cancelable: true, deltaMode: 0, ...init,
  }));
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

const box = (canvas: Canvas) => canvas.getViewport().getViewbox();

// --- dragging empty canvas ---------------------------------------------------

test('empty canvas: a drag PANS the viewport and lassoes nothing (parity spec §10)', async () => {
  const canvas = await load();
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const before = box(canvas);
  const empty = { x: before.x + 10, y: before.y + 10 };
  expect(canvas.hitTest(empty), 'the gesture starts on empty space').toBeUndefined();

  firePointer(canvas, svg, 'pointerdown', empty);
  firePointer(canvas, doc, 'pointermove', { x: empty.x + 120, y: empty.y + 80 });

  // The content follows the pointer: the viewBox moves the other way.
  const during = box(canvas);
  expect({ x: during.x, y: during.y }).toEqual({ x: before.x - 120, y: before.y - 80 });
  expect({ w: during.width, h: during.height }).toEqual({ w: before.width, h: before.height });
  // …and no marquee was ever drawn.
  expect(svg.querySelector('.sf-lasso-overlay')).toBeNull();
  expect(svg.classList.contains('sf-dragging-active-lasso')).toBe(false);
  // `grabbing` for as long as the pan runs (the idle `grab` is on `.sf-canvas`).
  expect(svg.classList.contains('sf-panning')).toBe(true);

  firePointer(canvas, doc, 'pointerup', { x: empty.x + 120, y: empty.y + 80 });
  expect(svg.classList.contains('sf-panning')).toBe(false);
  expect(canvas.getSelection().get()).toEqual([]);
});

test('empty canvas: a plain CLICK still clears the selection', async () => {
  const canvas = await load();
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  canvas.getSelection().select(node(canvas, 'Task_1'));
  const before = box(canvas);

  const empty = { x: before.x + 10, y: before.y + 10 };
  firePointer(canvas, svg, 'pointerdown', empty);
  firePointer(canvas, doc, 'pointerup', empty);

  expect(canvas.getSelection().get()).toEqual([]);
  // A click is not a pan.
  expect({ x: box(canvas).x, y: box(canvas).y }).toEqual({ x: before.x, y: before.y });
});

test('the idle cursor over the canvas is grab, and grabbing while panning', async () => {
  expect(CANVAS_CSS).toContain('cursor: grab;');
  expect(CANVAS_CSS).toContain('.sf-canvas.sf-panning');
  expect(CANVAS_CSS).toContain('cursor: grabbing;');
  expect(CANVAS_CSS).toContain('.sf-canvas.sf-lasso-tool');
  expect(CANVAS_CSS).toContain('cursor: crosshair;');
});

// --- the lasso tool ----------------------------------------------------------

test('lasso: only the palette tool arms it, and it disarms after one gesture', async () => {
  const canvas = await load();
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const before = box(canvas);
  const from = { x: before.x + 10, y: before.y + 10 };
  const to = { x: 350, y: 200 };

  expect(canvas.isLassoArmed()).toBe(false);
  canvas.activateLasso();
  expect(canvas.isLassoArmed()).toBe(true);
  expect(svg.classList.contains('sf-lasso-tool')).toBe(true);

  firePointer(canvas, svg, 'pointerdown', from);
  firePointer(canvas, doc, 'pointermove', to);
  expect(svg.querySelector('.sf-lasso-overlay')).not.toBeNull();
  // A lasso does not pan.
  expect({ x: box(canvas).x, y: box(canvas).y }).toEqual({ x: before.x, y: before.y });

  firePointer(canvas, doc, 'pointerup', to);
  expect(canvas.getSelection().get().map((e) => e.id).sort()).toEqual(['Start_1', 'Task_1']);
  // One shot: the next empty-canvas drag pans again.
  expect(canvas.isLassoArmed()).toBe(false);
  expect(svg.classList.contains('sf-lasso-tool')).toBe(false);

  firePointer(canvas, svg, 'pointerdown', from);
  firePointer(canvas, doc, 'pointermove', to);
  expect(svg.querySelector('.sf-lasso-overlay')).toBeNull();
  expect(box(canvas).x).not.toBe(before.x);
  firePointer(canvas, doc, 'pointerup', to);
});

test('lasso: an armed tool ignores what is under the pointer', async () => {
  const canvas = await load();
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const task = node(canvas, 'Task_1');
  const onTask = { x: task.x + task.width / 2, y: task.y + task.height / 2 };

  canvas.activateLasso();
  firePointer(canvas, svg, 'pointerdown', onTask);
  // Pressing on a shape with the lasso armed neither selects nor moves it.
  expect(canvas.getSelection().get()).toEqual([]);
  firePointer(canvas, doc, 'pointermove', { x: onTask.x + 100, y: onTask.y + 100 });
  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 80 });
  expect(svg.querySelector('.sf-lasso-overlay')).not.toBeNull();
  firePointer(canvas, doc, 'pointerup', { x: onTask.x + 100, y: onTask.y + 100 });
});

test('Escape disarms the lasso tool', async () => {
  const canvas = await load();
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  canvas.activateLasso();
  firePointer(canvas, svg, 'pointerdown', { x: box(canvas).x + 10, y: box(canvas).y + 10 });
  firePointer(canvas, doc, 'pointermove', { x: 350, y: 200 });
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(canvas.isLassoArmed()).toBe(false);
  expect(svg.querySelector('.sf-lasso-overlay')).toBeNull();
});

// --- the wheel ---------------------------------------------------------------

test('wheel: a plain notch pans vertically by diagram-js\'s 0.75 x delta', async () => {
  const canvas = await load();
  const before = box(canvas);

  fireWheel(canvas, { deltaY: -240 });

  const after = box(canvas);
  // -0.75 x -240 = 180 screen px of content movement, downward: the viewBox rises.
  expect(after.y).toBeCloseTo(before.y - 180, 6);
  expect(after.x).toBeCloseTo(before.x, 6);
  expect(after.width).toBeCloseTo(before.width, 6);
});

test('wheel: deltaX pans horizontally, and Shift maps a vertical wheel onto x', async () => {
  const canvas = await load();
  const start = box(canvas);

  fireWheel(canvas, { deltaX: -100, deltaY: 0 });
  expect(box(canvas).x).toBeCloseTo(start.x - 75, 6);
  expect(box(canvas).y).toBeCloseTo(start.y, 6);

  const mid = box(canvas);
  fireWheel(canvas, { deltaY: -100, shiftKey: true });
  expect(box(canvas).x).toBeCloseTo(mid.x - 75, 6);
  expect(box(canvas).y).toBeCloseTo(mid.y, 6);
});

test('Ctrl+wheel zooms one half-step about the cursor (1 -> 1.16158640)', async () => {
  const canvas = await load();
  const before = box(canvas);
  // jsdom reports a zero-size container, so the viewport's scale reads 1 and the
  // step is applied to the viewBox width — the same ratio, measurable.
  fireWheel(canvas, { deltaY: -240, ctrlKey: true });

  const after = box(canvas);
  expect(before.width / after.width).toBeCloseTo(1.16158640, 6);
  expect(before.height / after.height).toBeCloseTo(1.16158640, 6);

  // …and the other way.
  const zoomedIn = box(canvas);
  fireWheel(canvas, { deltaY: 240, ctrlKey: true });
  expect(box(canvas).width / zoomedIn.width).toBeCloseTo(1.16158640, 6);
});

test('wheel: a delta too small to matter neither pans nor zooms twice', async () => {
  const canvas = await load();
  const before = box(canvas);
  // |delta| = 0.75 * 0.02 * 1 = 0.015, under diagram-js's 0.1 threshold: nothing yet.
  fireWheel(canvas, { deltaY: -1, ctrlKey: true });
  expect(box(canvas).width).toBeCloseTo(before.width, 6);
  // …but the accumulation is kept, so a run of small notches eventually steps.
  for (let i = 0; i < 10; i += 1) fireWheel(canvas, { deltaY: -1, ctrlKey: true });
  expect(box(canvas).width).toBeLessThan(before.width);
});
