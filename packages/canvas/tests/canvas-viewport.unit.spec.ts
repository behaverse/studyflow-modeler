import { expect, test } from '@playwright/test';

import { Canvas, Study, type Insets } from '@canvas/index.ts';

import { hitAt, installDocument, jsdomWindow, loadYaml, pointerDown, pointerMove, pointerUp, svgOf } from './canvasHarness';

/**
 * Getting around the canvas: dragging empty canvas pans it, Shift+drag draws a
 * marquee, a plain wheel pans and `Ctrl`+wheel zooms.
 *
 * jsdom has no layout engine: `getBoundingClientRect` is all zeros, so screen and
 * diagram units are 1:1 and `viewbox.scale` reads 1.
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
  svgOf(canvas).dispatchEvent(new win.WheelEvent('wheel', {
    bubbles: true, cancelable: true, deltaMode: 0, ...init,
  }));
}

const box = (canvas: Canvas) => canvas.viewbox;

// --- dragging empty canvas ---------------------------------------------------

test('empty canvas: a drag PANS the viewport', async () => {
  const canvas = load();
  const svg = svgOf(canvas);
  const before = box(canvas);
  const empty = { x: before.x + 10, y: before.y + 10 };
  expect(hitAt(canvas, empty), 'the gesture starts on empty space').toBeUndefined();

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
  expect(canvas.selection).toEqual([]);
});

// --- the marquee ---------------------------------------------------------------

test('Shift+drag on empty canvas draws a marquee and selects what it encloses', async () => {
  const canvas = load();
  const svg = svgOf(canvas);
  const before = box(canvas);
  const from = { x: before.x + 10, y: before.y + 10 };
  const to = { x: 350, y: 200 };

  pointerDown(canvas, from, { shiftKey: true });
  pointerMove(canvas, to, { shiftKey: true });
  expect(svg.querySelector('.sf-marquee')).not.toBeNull();
  // A marquee does not pan.
  expect({ x: box(canvas).x, y: box(canvas).y }).toEqual({ x: before.x, y: before.y });
  pointerUp(canvas, to, { shiftKey: true });
  expect([...canvas.selection].sort()).toEqual(['Start_1', 'Task_1']);
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

// --- a host's own UI over the view --------------------------------------------------

/** The fixture in a view 400 × 600 at the page's origin (jsdom lays nothing out), with the host's UI covering `insets`. */
function covered(insets: Insets): Canvas {
  const container = installDocument().createElement('div');
  Object.defineProperties(container, { clientWidth: { value: 400 }, clientHeight: { value: 600 } });
  container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600 }) as DOMRect;
  return new Canvas(container, Study.fromDefinitions(loadYaml(FIXTURE_YAML).definitions), { insets: () => insets });
}

test('a fit and a reveal keep the diagram inside what the host\'s own UI leaves of the view', async () => {
  // The diagram runs from the start event's left edge to the task's right edge, and the task spans its height.
  const drawn = (canvas: Canvas) => {
    const start = canvas.screenBox('Start_1')!;
    const task = canvas.screenBox('Task_1')!;
    return { left: start.x, right: task.x + task.width, top: task.y, bottom: task.y + task.height };
  };
  const CASES: [label: string, insets: Insets, free: { left: number; right: number; top: number; bottom: number }][] = [
    ['nothing covered', {}, { left: 0, right: 400, top: 0, bottom: 600 }],
    ['a palette on the left', { left: 150 }, { left: 150, right: 400, top: 0, bottom: 600 }],
    ['a bar above and a panel below', { top: 100, bottom: 300 }, { left: 0, right: 400, top: 100, bottom: 300 }],
    ['insets that would leave nothing across are ignored across', { left: 300, right: 200 }, { left: 0, right: 400, top: 0, bottom: 600 }],
  ];
  for (const [label, insets, free] of CASES) {
    const at = drawn(covered(insets));
    expect(at.left, label).toBeGreaterThanOrEqual(free.left);
    expect(at.right, label).toBeLessThanOrEqual(free.right);
    expect(at.top, label).toBeGreaterThanOrEqual(free.top);
    expect(at.bottom, label).toBeLessThanOrEqual(free.bottom);
    // Centred in what is left.
    expect((at.left + at.right) / 2, label).toBeCloseTo((free.left + free.right) / 2, 6);
    expect((at.top + at.bottom) / 2, label).toBeCloseTo((free.top + free.bottom) / 2, 6);
  }

  const beside = covered({ left: 150 });
  beside.reveal('Task_1');
  const task = beside.screenBox('Task_1')!;
  expect(task.x + task.width / 2).toBeCloseTo(275, 6);
});

test('an appended shape the view does not show is panned into it, the least that shows it whole', async () => {
  // The fit leaves Task_1 near the view's right edge: what follows it lands past that edge.
  const canvas = covered({});
  const result = canvas.append('Task_1', { type: 'bpmn:Task' });
  const made = canvas.screenBox(result.id!)!;
  expect(made.x).toBeGreaterThanOrEqual(0);
  expect(made.x + made.width).toBeLessThanOrEqual(400);
  // The least pan: it now sits just inside the right edge, the margin away.
  expect(made.x + made.width).toBeCloseTo(380, 6);
});
