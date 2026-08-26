import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, LAYER_ORDER, setDocument } from '@canvas/index.ts';

import { loadSchemaModels } from './schemas';

/**
 * The background dot grid (P6b §3C) — the canvas's answer to `diagram-js-grid`.
 *
 * Three things matter and nothing else does: it looks like the other backend's grid
 * (a `#ccc` dot every 10 diagram units, tiled in user space so it holds still under
 * pan and zoom), it sits BEHIND everything the diagram draws, and it is chrome —
 * an import must not clear it and an export must not carry it.
 */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const dom = new JSDOM('<!doctype html><html><body></body></html>');
setDocument(dom.window.document as unknown as Document);

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
  const moddle = new BpmnModdle(structuredClone(packages)) as any;
  const { rootElement: definitions } = await moddle.fromXML(PROCESS_XML);
  const canvas = new Canvas();
  canvas.importDefinitions(definitions);
  return canvas;
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

    const moddle = new BpmnModdle(structuredClone(packages)) as any;
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
