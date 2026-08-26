import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, setDocument } from '@canvas/index.ts';

import { loadSchemaModels } from './schemas';
import { exampleXml } from './utils';

/**
 * P1 read-only renderer (design §6): render every shipped example diagram to an SVG
 * string and assert it mirrors the DI. We parse the XML embedded in the example PNGs
 * with `bpmn-moddle` (the runner's path), build a scene, and render it into a jsdom
 * DOM — the canvas ships no rendering dependency, so any DOM `Document` drives it via
 * `setDocument`. For each example we assert: (a) an SVG serializes without throwing;
 * (b) one `<g class="sf-shape">` per `BPMNShape`, translated to its `dc:Bounds`;
 * (c) one `<polyline>` per `BPMNEdge` through its `di:waypoint`; (d) the serialized
 * SVG matches a per-example golden.
 *
 * Goldens live in `packages/canvas/tests/__golden__/` and are written on first run
 * (or when `UPDATE_GOLDENS=1`); the suite here uses no `toMatchSnapshot`, so this is
 * a plain read-compare-or-write against that directory.
 */

const GOLDEN_DIR = path.join(process.cwd(), 'packages/canvas/tests/__golden__');
const UPDATE = process.env.UPDATE_GOLDENS === '1';

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

function freshModdle(): any {
  return new BpmnModdle(structuredClone(packages)) as any;
}

// A single jsdom document backs every render; the canvas is presentation-agnostic
// and only needs a DOM to mint SVG nodes into.
const dom = new JSDOM('<!doctype html><html><body></body></html>');
setDocument(dom.window.document as unknown as Document);

/** Every `.studyflow.png` example, in directory order. */
function exampleFiles(): string[] {
  return readdirSync(path.join(process.cwd(), 'assets/examples'))
    .filter((f) => f.endsWith('.studyflow.png'))
    .sort();
}

/** Every DI shape and edge across every diagram/plane, in document order. */
function diItems(definitions: any): { shapes: any[]; edges: any[] } {
  const shapes: any[] = [];
  const edges: any[] = [];
  for (const diagram of definitions.diagrams ?? []) {
    const plane = diagram.plane;
    if (!plane) continue;
    for (const pe of plane.planeElement ?? []) {
      if (pe.$type === 'bpmndi:BPMNShape') shapes.push(pe);
      else if (pe.$type === 'bpmndi:BPMNEdge') edges.push(pe);
    }
  }
  return { shapes, edges };
}

/** Parse `translate(x, y)` off a group; a group at the origin carries no transform. */
function translateOf(g: Element | undefined): { x: number; y: number } {
  const t = g?.getAttribute('transform') ?? '';
  const m = t.match(/translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
}

const files = exampleFiles();

test('canvas render: exactly 18 studyflow example diagrams are present', () => {
  expect(files.length).toBe(18);
});

for (const filename of files) {
  test(`${filename}: renders to SVG mirroring its DI, matches golden`, async () => {
    const moddle = freshModdle();
    const { rootElement: definitions } = await moddle.fromXML(exampleXml(filename));

    const { shapes, edges } = diItems(definitions);

    // DI presence: the canvas never invents layout (design §0/§6). If an example
    // genuinely lacks DI, skip it and log which — do not fail.
    if (shapes.length === 0 && edges.length === 0) {
      test.skip(true, `${filename}: no DiagramInterchange present — skipped`);
      return;
    }

    // (a) A full render + serialize does not throw.
    const warnings: string[] = [];
    const canvas = new Canvas({ onWarning: (w: string) => warnings.push(w) });
    canvas.importDefinitions(definitions);
    const svg = canvas.toSVG();
    expect(svg, `${filename}: produces an SVG string`).toContain('<svg');
    expect(svg.length, `${filename}: SVG is non-empty`).toBeGreaterThan(0);

    const root = canvas.getSvg();

    // (b) One shape group per BPMNShape, translated to its dc:Bounds origin.
    const shapeGroups = root.querySelectorAll('g.sf-shape');
    expect(shapeGroups.length, `${filename}: one <g.sf-shape> per BPMNShape`).toBe(
      shapes.length,
    );
    for (const shape of shapes) {
      const id = shape.bpmnElement?.id as string;
      const g = canvas.getGraphics(id);
      expect(g, `${filename}: shape ${id} has a rendered group`).toBeTruthy();
      expect(g!.getAttribute('data-element-type')).toBe(shape.bpmnElement.$type);
      expect(translateOf(g), `${filename}: shape ${id} sits at its DI bounds`).toEqual({
        x: shape.bounds.x,
        y: shape.bounds.y,
      });
    }

    // (c) One polyline per BPMNEdge, through its di:waypoint list.
    const polylines = root.querySelectorAll('polyline');
    expect(polylines.length, `${filename}: one <polyline> per BPMNEdge`).toBe(
      edges.length,
    );
    for (const di of edges) {
      const id = di.bpmnElement?.id as string;
      const g = canvas.getGraphics(id);
      expect(g, `${filename}: edge ${id} has a rendered group`).toBeTruthy();
      const line = g!.querySelector('polyline');
      expect(line, `${filename}: edge ${id} draws a polyline`).toBeTruthy();
      const expected = (di.waypoint ?? [])
        .map((wp: any) => `${wp.x},${wp.y}`)
        .join(' ');
      expect(line!.getAttribute('points')).toBe(expected);
    }

    // (d) Golden snapshot of the serialized SVG.
    if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
    const goldenPath = path.join(GOLDEN_DIR, `${filename}.svg`);
    if (UPDATE || !existsSync(goldenPath)) {
      writeFileSync(goldenPath, svg, 'utf8');
    } else {
      const golden = readFileSync(goldenPath, 'utf8');
      expect(svg, `${filename}: SVG matches golden (UPDATE_GOLDENS=1 to refresh)`).toBe(
        golden,
      );
    }
  });
}
