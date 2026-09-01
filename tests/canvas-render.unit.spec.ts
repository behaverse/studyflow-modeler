import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import { choreographyBandHeight } from '@canvas/render/shapes.ts';

import { freshModdle, installDocument, loadCanvas } from './canvasHarness';
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

// A single jsdom document backs every render; the canvas is presentation-agnostic
// and only needs a DOM to mint SVG nodes into.
installDocument();

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

    // (c) One line per BPMNEdge, through its di:waypoint list.
    //
    // A `<path>`, not the `<polyline>` this asserted through P5: diagram-js draws
    // connections with ROUNDED corner bends, so the parity round cut arcs into the
    // corners (`render/renderer.ts drawEdge`, edge-videos `edgemake/frame_02`). The
    // waypoint list itself is unchanged — it is kept verbatim in `data-waypoints`,
    // which is what this compares, so the DI-mirrors-the-drawing contract is exactly
    // as strict as it was.
    const lines = root.querySelectorAll('path.sf-connection-line');
    expect(lines.length, `${filename}: one connection <path> per BPMNEdge`).toBe(
      edges.length,
    );
    for (const di of edges) {
      const id = di.bpmnElement?.id as string;
      const g = canvas.getGraphics(id);
      expect(g, `${filename}: edge ${id} has a rendered group`).toBeTruthy();
      const line = g!.querySelector('path.sf-connection-line');
      expect(line, `${filename}: edge ${id} draws a connection path`).toBeTruthy();
      const expected = (di.waypoint ?? [])
        .map((wp: any) => `${wp.x},${wp.y}`)
        .join(' ');
      expect(line!.getAttribute('data-waypoints')).toBe(expected);
      // The drawn geometry still STARTS at the first waypoint, whatever the
      // corners in between do (arcs are cut out of a corner, never added around it).
      const first = (di.waypoint ?? [])[0];
      const at = (value: number): number => Math.round(value * 1000) / 1000;
      expect(line!.getAttribute('d')).toMatch(
        new RegExp(`^M ${at(first.x)} ${at(first.y)}\\b`),
      );
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

// --- artifact captions -------------------------------------------------------

/** Render one example and hand back its canvas. */
async function render(filename: string): Promise<Canvas> {
  return (await loadCanvas(exampleXml(filename))).canvas;
}

/** The `<text>` lines the renderer drew inside an element's `<g>`. */
function textsOf(canvas: Canvas, id: string): string[] {
  const g = canvas.getGraphics(id);
  return g ? Array.from(g.querySelectorAll('text')).map((t) => t.textContent ?? '') : [];
}

test('a group is captioned from its categoryValue, centred on the top of the frame', async () => {
  const canvas = await render('kitchensink.studyflow.png');
  // The caption is NOT the group's `name` (it has none): BPMN keeps it on the
  // referenced `bpmn:CategoryValue`, which is where bpmn-js reads it from too.
  expect(textsOf(canvas, 'Group_BpmnEvents')).toEqual(['BPMN · Events']);
  expect(textsOf(canvas, 'Group_BpmnGateways')).toEqual(['BPMN · Gateways']);
  expect(textsOf(canvas, 'Group_Exec')).toEqual(['exec · Execution & scope']);

  const group = canvas.getScene()!.elementsById.get('Group_BpmnEvents') as any;
  const text = canvas.getGraphics('Group_BpmnEvents')!.querySelector('text')!;
  // Node-local coordinates: horizontally centred, 10 below the top edge — bpmn-js's
  // `getExternalLabelMid` special-case for a group.
  expect(Number(text.getAttribute('x'))).toBeCloseTo(group.width / 2, 6);
  expect(text.getAttribute('y')).toBe('10');
  expect(text.getAttribute('text-anchor')).toBe('middle');
});

test('a text annotation draws its `text`, wrapped — not its `name`', async () => {
  const canvas = await render('kitchensink.studyflow.png');
  const lines = textsOf(canvas, 'Bd_Annotation');
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.join(' ')).toBe('A free-form note. Groups (these labelled bands) are artifacts too.');
  // The name is a placeholder BPMN does not display; drawing it was the bug.
  expect(lines.join(' ')).not.toContain('Text annotation');
  const first = canvas.getGraphics('Bd_Annotation')!.querySelector('text')!;
  // Top-left inside the bracket, inset by bpmn-js's TEXT_ANNOTATION_PADDING.
  expect(first.getAttribute('x')).toBe('7');
  expect(first.getAttribute('text-anchor')).toBeNull();
});

/**
 * Every type the rules call a data shape must also DRAW as one. `bpmn:DataStore`
 * was in the rules' set (so associations could be drawn to it) but not the
 * renderer's, so it fell through to the unknown-vocabulary rect — and the cropper's
 * data-store branch, which lives under the `'data'` category, was unreachable.
 */
const DATA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_Data" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:dataStore id="Store_1" name="Vault" />
  <bpmn:process id="Process_Data" isExecutable="false">
    <bpmn:dataStoreReference id="StoreRef_1" name="Ref" dataStoreRef="Store_1" />
    <bpmn:dataObjectReference id="ObjRef_1" name="Obj" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_Data">
    <bpmndi:BPMNPlane id="Plane_Data" bpmnElement="Process_Data">
      <bpmndi:BPMNShape id="Store_1_di" bpmnElement="Store_1">
        <dc:Bounds x="100" y="100" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="StoreRef_1_di" bpmnElement="StoreRef_1">
        <dc:Bounds x="200" y="100" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="ObjRef_1_di" bpmnElement="ObjRef_1">
        <dc:Bounds x="300" y="100" width="36" height="50" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('a bare bpmn:DataStore draws as a cylinder, like a data store REFERENCE', async () => {
  const { canvas } = await loadCanvas(DATA_XML);
  const pathOf = (id: string): string => canvas.getGraphics(id)!.querySelector('path')!.getAttribute('d') ?? '';

  // A cylinder: the body path opens with the lid's elliptical arc.
  expect(pathOf('Store_1')).toContain('A');
  expect(pathOf('Store_1')).toBe(pathOf('StoreRef_1'));
  // …and it is NOT the unknown-vocabulary fallback, which is a rounded <rect>.
  expect(canvas.getGraphics('Store_1')!.querySelector('rect')).toBeNull();

  // A data OBJECT still draws as the dog-eared page (no arcs at all).
  expect(pathOf('ObjRef_1')).not.toContain('A');
});

test('a choreography task draws its name in the MIDDLE band, not on the divider', async () => {
  const canvas = await render('choreography_demo.studyflow.png');
  const task = canvas.getScene()!.elementsById.get('Consent') as any;
  const g = canvas.getGraphics('Consent')!;
  const name = Array.from(g.querySelectorAll('text')).find((t) => t.textContent === 'Give consent')!;
  // The name is drawn inside a nested group translated down by one band height, so
  // its EFFECTIVE y is the local y plus that shift.
  const shift = translateOf(name.parentElement as Element).y;
  expect(shift).toBeCloseTo(choreographyBandHeight(task.height), 6);
  // Dead centre of the 20…70 middle band — where `labelBounds` opens the editor —
  // rather than sitting on the top divider, which is where the un-nested draw put it.
  expect(shift + Number(name.getAttribute('y'))).toBeCloseTo(task.height / 2, 6);
});

/**
 * Two pools and the message flow between them — no shipped example carries one, and
 * BPMN gives it a notation of its own: "a dashed line with an OPEN CIRCLE at the
 * start and an open arrowhead at the end". The circle is what tells it apart from an
 * association, which is dashed too.
 */
const MESSAGE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_Msg" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_A" name="A" processRef="Process_A" />
    <bpmn:participant id="Pool_B" name="B" processRef="Process_B" />
    <bpmn:messageFlow id="Msg_1" sourceRef="Task_A" targetRef="Task_B" />
  </bpmn:collaboration>
  <bpmn:process id="Process_A" isExecutable="false"><bpmn:task id="Task_A" name="A" /></bpmn:process>
  <bpmn:process id="Process_B" isExecutable="false"><bpmn:task id="Task_B" name="B" /></bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_Msg">
    <bpmndi:BPMNPlane id="Plane_Msg" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_A_di" bpmnElement="Pool_A" isHorizontal="true">
        <dc:Bounds x="100" y="100" width="400" height="150" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_A_di" bpmnElement="Task_A">
        <dc:Bounds x="200" y="135" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Pool_B_di" bpmnElement="Pool_B" isHorizontal="true">
        <dc:Bounds x="100" y="300" width="400" height="150" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_B_di" bpmnElement="Task_B">
        <dc:Bounds x="200" y="335" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Msg_1_di" bpmnElement="Msg_1">
        <di:waypoint x="250" y="215" /><di:waypoint x="250" y="335" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('a message flow is dashed AND starts with the open circle BPMN gives it', async () => {
  const { canvas } = await loadCanvas(MESSAGE_XML);
  const line = canvas.getGraphics('Msg_1')!.querySelector('.sf-connection-line')!;

  expect(line.getAttribute('stroke-dasharray')).toBe('10,8');
  expect(line.getAttribute('marker-end')).toBe('url(#sf-arrow-message)');
  expect(line.getAttribute('marker-start')).toBe('url(#sf-marker-message-start)');

  // The marker is a real circle, filled with the canvas colour so the line does not
  // show through its middle — the same token the resize handles use, so it follows a
  // re-themed canvas.
  const marker = canvas.getSvg().querySelector('#sf-marker-message-start circle')!;
  expect(marker.getAttribute('r')).toBe('3.5');
  // Placed just past the docking point, not centred on it: the shape paints over the
  // edges at its depth, so a centred circle is half swallowed by its own source.
  expect(marker.parentElement!.getAttribute('refX')).toBe('2');
  expect(marker.getAttribute('fill')).toBe('var(--sf-canvas-fill-color)');
  expect(marker.getAttribute('stroke')).toBe('context-stroke');
});
