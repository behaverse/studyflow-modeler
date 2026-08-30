import { expect, test } from '@playwright/test';

import type { Canvas } from '@canvas/index.ts';
import { LAYER_ORDER } from '@canvas/view/layers.ts';

import { freshModdle, loadCanvas, pointerDown, pointerMove, pointerUp } from './canvasHarness';

/**
 * The background dot grid (P6b §3C) — the canvas's answer to `diagram-js-grid`.
 *
 * Three things matter and nothing else does: it looks like the other backend's grid
 * (a `#ccc` dot every 10 diagram units, tiled in user space so it holds still under
 * pan and zoom), it sits BEHIND everything the diagram draws, and it is chrome —
 * an import must not clear it and an export must not carry it.
 */

const PROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:task id="Task_1" name="Task" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(): Promise<Canvas> {
  return (await loadWithDefinitions()).canvas;
}

async function loadWithDefinitions(): Promise<{ canvas: Canvas; definitions: any }> {
  // No options: every default is the shipped one, which is the point of the
  // grid-snapping block below.
  return loadCanvas(PROCESS_XML);
}

/** The `<rect>` the grid pattern is painted into, if it is currently painted. */
function gridRect(canvas: Canvas): Element | null {
  return canvas.getSvg().querySelector('[data-layer="grid"] rect');
}

test.describe('background grid', () => {
  test('the grid layer is the bottom of the stack', () => {
    // Everything the diagram draws must sit on top of it.
    expect(LAYER_ORDER[0]).toBe('grid');
  });

  test('is off until asked for, and mints no <defs> entry before then', async () => {
    const canvas = await load();

    expect(canvas.isGridVisible()).toBe(false);
    expect(gridRect(canvas)).toBeNull();
    // The render goldens serialize a canvas that never turns the grid on; a pattern
    // minted eagerly would land in every one of them.
    expect(canvas.getSvg().querySelector('[data-grid-pattern]')).toBeNull();
  });

  test('paints a 10x10 user-space pattern of 1px #ccc dots', async () => {
    const canvas = await load();
    canvas.setGridVisible(true);

    expect(canvas.isGridVisible()).toBe(true);
    const pattern = canvas.getSvg().querySelector('defs [data-grid-pattern]')!;
    expect(pattern.getAttribute('width')).toBe('10');
    expect(pattern.getAttribute('height')).toBe('10');
    // User space, not the bounding box: the dots are anchored to the diagram origin,
    // so panning and zooming (which move the root `viewBox`) slide them with the
    // diagram instead of stretching them.
    expect(pattern.getAttribute('patternUnits')).toBe('userSpaceOnUse');

    const dot = pattern.querySelector('circle')!;
    expect(dot.getAttribute('r')).toBe('0.5');
    expect(dot.getAttribute('fill')).toBe('rgb(204, 204, 204)');

    const rect = gridRect(canvas)!;
    expect(rect.getAttribute('fill')).toBe(`url(#${pattern.getAttribute('id')})`);
  });

  test('toggles off and on again, reusing the same pattern', async () => {
    const canvas = await load();
    canvas.setGridVisible(true);
    const first = canvas.getSvg().querySelector('[data-grid-pattern]')!.getAttribute('id');

    canvas.setGridVisible(false);
    expect(canvas.isGridVisible()).toBe(false);
    expect(gridRect(canvas)).toBeNull();

    canvas.setGridVisible(true);
    expect(gridRect(canvas)).toBeTruthy();
    expect(canvas.getSvg().querySelectorAll('[data-grid-pattern]')).toHaveLength(1);
    expect(canvas.getSvg().querySelector('[data-grid-pattern]')!.getAttribute('id')).toBe(first);
  });

  test('survives an import, which clears every other layer', async () => {
    const canvas = await load();
    canvas.setGridVisible(true);

    const moddle = freshModdle();
    const { rootElement } = await moddle.fromXML(PROCESS_XML);
    canvas.importDefinitions(rootElement);

    // "Show grid" is a preference of the window, not of the document.
    expect(canvas.isGridVisible()).toBe(true);
    expect(gridRect(canvas)).toBeTruthy();
  });

  test('never reaches an exported SVG — neither the tiles nor the pattern', async () => {
    const canvas = await load();
    canvas.setGridVisible(true);

    const svg = canvas.toSVG();
    expect(svg).not.toContain('data-grid-pattern');
    expect(svg).not.toContain('data-layer="grid"');
    // The drawing itself is still there.
    expect(svg).toContain('data-element-id="Task_1"');
  });
});

/**
 * Snapping to the grid — the OTHER grid (parity spec addendum 7). One is what the
 * user sees, the other is what a drag does, and they are independent: diagram-js
 * paints its dots unconditionally while grid snapping is its own module, and this
 * canvas keeps the same split. The full composition with element-alignment snapping
 * lives in `canvas-snapping.unit.spec.ts`; what is under test here is the default
 * and the DI it writes.
 */
test.describe('grid snapping', () => {
  /** The `dc:Bounds` of a shape, read off the live moddle tree. */
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

  test('a dropped shape lands on multiples of 10 with no options passed — DI included', async () => {
    const { canvas, definitions } = await loadWithDefinitions();
    expect(canvas.isSnapToGrid(), 'grid snapping ships on').toBe(true);

    const task = canvas.getScene()!.elementsById.get('Task_1') as any;
    const from = { x: task.x + task.width / 2, y: task.y + task.height / 2 };
    const to = { x: from.x + 23, y: from.y - 16 };
    pointerDown(canvas, from);
    pointerMove(canvas, to);
    pointerUp(canvas, to);

    // 200 + 23 → 220, 80 - 16 → 60. The raw pointer would have said 223 / 64.
    const landed = boundsOf(definitions, 'Task_1');
    expect(landed).toEqual({ x: 220, y: 60 });
    expect(landed.x % 10).toBe(0);
    expect(landed.y % 10).toBe(0);
  });

  test('is independent of the visible dot grid — neither switch moves the other', async () => {
    const canvas = await load();
    expect(canvas.isGridVisible()).toBe(false);
    expect(canvas.isSnapToGrid()).toBe(true);

    canvas.setGridVisible(true);
    expect(canvas.isSnapToGrid(), 'showing the dots snaps nothing').toBe(true);

    canvas.setSnapToGrid(false);
    expect(canvas.isGridVisible(), 'and dropping the snap hides nothing').toBe(true);
    expect(gridRect(canvas)).toBeTruthy();
  });
});
