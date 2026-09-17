import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';

import { jsdomWindow, loadYaml, pointerDown, pointerMove, pointerUp } from './canvasHarness';

/**
 * Getting around the canvas: dragging empty canvas pans it, Shift+drag draws a
 * marquee, a plain wheel pans and `Ctrl`+wheel zooms.
 *
 * jsdom has no layout engine: `getBoundingClientRect` is all zeros, so screen and
 * diagram units are 1:1 and `getViewbox().scale` reads 1.
 */

const win = jsdomWindow();

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
      name: Task
      bounds: 200 80 100 80
    Flow_1:
      sourceRef: Start_1
      targetRef: Task_1
      waypoint: 136,118 200,120
`;

function load(): Canvas {
  const { canvas } = loadYaml(FIXTURE_YAML);
  return canvas;
}

function fireWheel(canvas: Canvas, init: WheelEventInit): void {
  canvas.getSvg().dispatchEvent(new win.WheelEvent('wheel', {
    bubbles: true, cancelable: true, deltaMode: 0, ...init,
  }));
}

const box = (canvas: Canvas) => canvas.getViewport().getViewbox();

// --- dragging empty canvas ---------------------------------------------------

test('empty canvas: a drag PANS the viewport', async () => {
  const canvas = load();
  const svg = canvas.getSvg();
  const before = box(canvas);
  const empty = { x: before.x + 10, y: before.y + 10 };
  expect(canvas.hitTest(empty), 'the gesture starts on empty space').toBeUndefined();

  pointerDown(canvas, empty);
  pointerMove(canvas, { x: empty.x + 120, y: empty.y + 80 });

  // The content follows the pointer: the viewBox moves the other way.
  const during = box(canvas);
  expect({ x: during.x, y: during.y }).toEqual({ x: before.x - 120, y: before.y - 80 });
  expect({ w: during.width, h: during.height }).toEqual({ w: before.width, h: before.height });
  // `grabbing` for as long as the pan runs (the idle `grab` is on `.sf-canvas`).
  expect(svg.classList.contains('sf-panning')).toBe(true);

  pointerUp(canvas, { x: empty.x + 120, y: empty.y + 80 });
  expect(svg.classList.contains('sf-panning')).toBe(false);
  expect(canvas.getSelection().get()).toEqual([]);
});

// --- the marquee ---------------------------------------------------------------

test('Shift+drag on empty canvas draws a marquee and selects what it encloses', async () => {
  const canvas = load();
  const svg = canvas.getSvg();
  const before = box(canvas);
  const from = { x: before.x + 10, y: before.y + 10 };
  const to = { x: 350, y: 200 };

  pointerDown(canvas, from, { shiftKey: true });
  pointerMove(canvas, to, { shiftKey: true });
  expect(svg.querySelector('.sf-marquee')).not.toBeNull();
  // A marquee does not pan.
  expect({ x: box(canvas).x, y: box(canvas).y }).toEqual({ x: before.x, y: before.y });
  pointerUp(canvas, to, { shiftKey: true });
  expect(canvas.getSelection().get().map((e) => e.id).sort()).toEqual(['Start_1', 'Task_1']);
  expect(svg.querySelector('.sf-marquee')).toBeNull();
});

// --- the wheel ---------------------------------------------------------------

test('a wheel pans by its delta, Shift turns it sideways, and Ctrl zooms exponentially in it', async () => {
  const canvas = load();
  // A pan moves the content with the wheel, so the viewBox moves the other way; a zoom
  // shrinks or grows the viewBox by a factor: `in` is the zoom-in factor of a notch of 240,
  // read off the first Ctrl case, so the step size stays the renderer's own.
  let zoomIn = 1;
  const CASES: [label: string, wheel: WheelEventInit, pan: { x: number; y: number } | null, factor: () => number][] = [
    ['a plain notch pans vertically', { deltaY: -240 }, { x: 0, y: -240 }, () => 1],
    ['deltaX pans horizontally', { deltaX: -100 }, { x: -100, y: 0 }, () => 1],
    ['Shift maps a vertical wheel onto x', { deltaY: -100, shiftKey: true }, { x: -100, y: 0 }, () => 1],
    ['Ctrl zooms in', { deltaY: -240, ctrlKey: true }, null, () => zoomIn],
    ['… and out by the same factor', { deltaY: 240, ctrlKey: true }, null, () => 1 / zoomIn],
    ['a bigger notch zooms further: exponential in the delta', { deltaY: -480, ctrlKey: true }, null, () => zoomIn * zoomIn],
  ];
  for (const [label, wheel, pan, factor] of CASES) {
    const before = box(canvas);
    fireWheel(canvas, wheel);
    const after = box(canvas);
    if (pan) {
      expect(after.x - before.x, label).toBeCloseTo(pan.x, 6);
      expect(after.y - before.y, label).toBeCloseTo(pan.y, 6);
    }
    if (label === 'Ctrl zooms in') {
      zoomIn = before.width / after.width;
      expect(zoomIn, label).toBeGreaterThan(1);
    }
    expect(before.width / after.width, label).toBeCloseTo(factor(), 6);
    expect(before.height / after.height, label).toBeCloseTo(factor(), 6);
  }
});
