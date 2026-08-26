import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, setDocument } from '@canvas/index.ts';
import { normalizeColor, readColors, COLOR_PROPERTIES } from '@canvas/model/color.ts';
import type { SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import type { ElementChangedEvent } from '@canvas/model/writeback.ts';

import { loadSchemaModels } from './schemas';
import { exampleXml } from './utils';

/**
 * P5 colour writeback (design §1 "colour (studyflow uses the bpmn.io colour
 * extension) → BO `di.fill`/`di.stroke` attrs", §6 P5).
 *
 * bpmn.io stores element colour on the **DI**, in two parallel vocabularies that
 * `bpmn-js`'s own `SetColorHandler` always writes together:
 *
 * - current: `color:background-color` / `color:border-color`
 * - legacy:  `bioc:fill` / `bioc:stroke`
 *
 * The shipped `consort2025`, `spirit2025` and `sklearn_pipeline` examples all carry
 * the four attributes, the modeler's drawio exporter reads either
 * (`packages/modeler/src/export/drawio.ts`), and the canvas renderer reads either —
 * so a colour the canvas writes must be indistinguishable from one those examples
 * were saved with. That is what this spec pins: `toXML` of the SAME live tree the
 * canvas edited, plus a reload of it.
 */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const dom = new JSDOM('<!doctype html><html><body></body></html>');
setDocument(dom.window.document as unknown as Document);

function freshModdle(): any {
  return new BpmnModdle(structuredClone(packages)) as any;
}

/** A pre-coloured example: `consort2025` carries all four attributes on real shapes. */
const COLORED_EXAMPLE = 'consort2025.studyflow.png';

/** An uncoloured document — no `bioc`/`color` namespace declared at all. */
const PLAIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_P" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_P" isExecutable="false">
    <bpmn:startEvent id="Start_1">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_1" name="Work">
      <bpmn:incoming>Flow_1</bpmn:incoming>
    </bpmn:task>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_P">
    <bpmndi:BPMNPlane id="Plane_P" bpmnElement="Process_P">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="220" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" />
        <di:waypoint x="220" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

interface Loaded {
  canvas: Canvas;
  definitions: any;
  moddle: any;
}

async function load(xml: string): Promise<Loaded> {
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(xml);
  const canvas = new Canvas();
  canvas.importDefinitions(definitions);
  return { canvas, definitions, moddle };
}

// --- live-tree readers (never the scene) -------------------------------------

async function toXML(loaded: Loaded): Promise<string> {
  const { xml } = await loaded.moddle.toXML(loaded.definitions);
  return xml;
}

async function roundTrip(loaded: Loaded): Promise<{ xml: string; reloaded: any }> {
  const xml = await toXML(loaded);
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  return { xml, reloaded };
}

/** Every `bpmndi:BPMNShape`/`BPMNEdge` of every plane, keyed by the id it depicts. */
function diElements(definitions: any): Map<string, any> {
  const out = new Map<string, any>();
  for (const diagram of definitions.diagrams ?? []) {
    for (const pe of diagram.plane?.planeElement ?? []) {
      if (pe.bpmnElement?.id) out.set(pe.bpmnElement.id, pe);
    }
  }
  return out;
}

/** The opening tag of a DI element, as serialized. */
function diTag(xml: string, diId: string): string {
  const match = xml.match(new RegExp(`<bpmndi:BPMN(?:Shape|Edge) id="${diId}"[^>]*>`));
  expect(match, `no DI element with id="${diId}" in the serialized document`).not.toBeNull();
  return match![0];
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function edge(canvas: Canvas, id: string): SceneEdge {
  return canvas.getScene()!.elementsById.get(id) as SceneEdge;
}

/** The `fill`/`stroke` a shape's drawn `<g>` uses (the renderer reads the DI). */
function drawn(canvas: Canvas, id: string): { fill: string | null; stroke: string | null } {
  const g = canvas.getGraphics(id)!;
  const painted = g.querySelector('rect, circle, polyline, path')!;
  return { fill: painted.getAttribute('fill'), stroke: painted.getAttribute('stroke') };
}

// --- normalization -----------------------------------------------------------

test('colours normalize to the #rrggbb form bpmn.io stores', () => {
  expect(normalizeColor('#AABBCC')).toBe('#aabbcc');
  expect(normalizeColor('#abc')).toBe('#aabbcc');
  expect(normalizeColor('rgb(255, 0, 128)')).toBe('#ff0080');
  // Falsy means "clear this colour", not "invalid".
  expect(normalizeColor(undefined)).toBeUndefined();
  expect(normalizeColor(null)).toBeUndefined();
  expect(normalizeColor('')).toBeUndefined();
  // Anything a headless package cannot resolve is refused loudly, as bpmn-js does.
  expect(() => normalizeColor('fuchsia')).toThrow(/invalid color value/);
  expect(() => normalizeColor('rgba(1, 2, 3, 0.4)')).toThrow(/invalid color value/);
});

// --- writing a colour --------------------------------------------------------

test('setColor writes both the current and the legacy bpmn.io attributes on the DI', async () => {
  const loaded = await load(PLAIN_XML);
  const { canvas } = loaded;
  const task = node(canvas, 'Task_1');

  expect(canvas.setColor(task, { fill: '#f1d0cd', stroke: '#ac5a54' }).map((e) => e.id))
    .toEqual(['Task_1']);

  // Both vocabularies, on the live DI object the scene was imported from.
  for (const name of [...COLOR_PROPERTIES.fill]) {
    expect((task.di as any).get(name), name).toBe('#f1d0cd');
  }
  for (const name of [...COLOR_PROPERTIES.stroke]) {
    expect((task.di as any).get(name), name).toBe('#ac5a54');
  }

  const { xml, reloaded } = await roundTrip(loaded);
  // The serialized tag looks exactly like a shipped coloured example's.
  const tag = diTag(xml, 'Task_1_di');
  expect(tag).toContain('bioc:fill="#f1d0cd"');
  expect(tag).toContain('bioc:stroke="#ac5a54"');
  expect(tag).toContain('color:background-color="#f1d0cd"');
  expect(tag).toContain('color:border-color="#ac5a54"');
  // …and the namespaces it needs were declared, though the source had neither.
  expect(xml).toContain('xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0"');
  expect(xml).toContain('xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0"');

  const reloadedDi = diElements(reloaded).get('Task_1');
  expect(reloadedDi.get('bioc:fill')).toBe('#f1d0cd');
  expect(reloadedDi.get('color:border-color')).toBe('#ac5a54');
  // Nothing landed on the business object — colour is DI-only.
  expect(xml).toContain('<bpmn:task id="Task_1" name="Work">');
});

test('a coloured element is re-drawn in its new colours', async () => {
  const { canvas } = await load(PLAIN_XML);
  const task = node(canvas, 'Task_1');
  const before = drawn(canvas, 'Task_1');

  canvas.setColor(task, { fill: '#dbe8f5', stroke: '#4a6f9c' });

  const after = drawn(canvas, 'Task_1');
  expect(after.fill).toBe('#dbe8f5');
  expect(after.stroke).toBe('#4a6f9c');
  expect(after.fill).not.toBe(before.fill);
  expect(readColors(task)).toEqual({ fill: '#dbe8f5', stroke: '#4a6f9c' });
});

test('setColor over a batch is one revision bump and one element.changed each', async () => {
  const loaded = await load(PLAIN_XML);
  const { canvas } = loaded;
  const changed: ElementChangedEvent[] = [];
  canvas.getEventBus().on<ElementChangedEvent>('element.changed', (e) => changed.push(e));

  const elements: SceneElement[] = [node(canvas, 'Task_1'), node(canvas, 'Start_1')];
  expect(canvas.setColor(elements, { stroke: '#3f7a4a' }).map((e) => e.id))
    .toEqual(['Task_1', 'Start_1']);

  expect(changed.map((e) => e.element.id)).toEqual(['Task_1', 'Start_1']);
  expect(canvas.getScene()!.revision).toBe(1);
  const { xml } = await roundTrip(loaded);
  expect(diTag(xml, 'Task_1_di')).toContain('bioc:stroke="#3f7a4a"');
  expect(diTag(xml, 'Start_1_di')).toContain('bioc:stroke="#3f7a4a"');
});

test('a connection takes a stroke only — never a fill', async () => {
  const loaded = await load(PLAIN_XML);
  const { canvas } = loaded;
  const flow = edge(canvas, 'Flow_1');

  expect(canvas.setColor(flow, { fill: '#f1d0cd', stroke: '#ac5a54' }).map((e) => e.id))
    .toEqual(['Flow_1']);

  const { xml } = await roundTrip(loaded);
  const tag = diTag(xml, 'Flow_1_di');
  expect(tag).toContain('bioc:stroke="#ac5a54"');
  expect(tag).toContain('color:border-color="#ac5a54"');
  expect(tag).not.toContain('bioc:fill');
  expect(tag).not.toContain('background-color');
  // The drawn polyline follows.
  expect(drawn(canvas, 'Flow_1').stroke).toBe('#ac5a54');
});

test('an omitted field is left alone; a falsy one clears that colour', async () => {
  const loaded = await load(PLAIN_XML);
  const { canvas } = loaded;
  const before = await toXML(loaded);
  const task = node(canvas, 'Task_1');
  canvas.setColor(task, { fill: '#f1d0cd', stroke: '#ac5a54' });

  // `stroke` is not in the patch at all, so it survives a fill-only change.
  canvas.setColor(task, { fill: '#dbe8f5' });
  expect(readColors(task)).toEqual({ fill: '#dbe8f5', stroke: '#ac5a54' });

  // A falsy value removes the attribute outright, in both vocabularies.
  expect(canvas.setColor(task, { fill: null, stroke: undefined }).map((e) => e.id))
    .toEqual(['Task_1']);
  expect(readColors(task)).toEqual({});
  const xml = await toXML(loaded);
  expect(xml).not.toContain('bioc:');
  expect(xml).not.toContain('color:');
  // Clearing everything restores the document byte for byte.
  expect(xml).toBe(before);
});

test('re-applying the colour an element already has writes nothing', async () => {
  const loaded = await load(PLAIN_XML);
  const { canvas } = loaded;
  const task = node(canvas, 'Task_1');
  canvas.setColor(task, { fill: '#f1d0cd', stroke: '#ac5a54' });
  const after = await toXML(loaded);
  const revision = canvas.getScene()!.revision;

  // Same colours, and the same colours spelled differently.
  expect(canvas.setColor(task, { fill: '#f1d0cd', stroke: '#AC5A54' })).toEqual([]);
  expect(canvas.getScene()!.revision).toBe(revision);
  expect(await toXML(loaded)).toBe(after);
  // Clearing a colour that is already absent is a no-op too.
  expect(canvas.setColor(node(canvas, 'Start_1'), { fill: undefined })).toEqual([]);
  expect(await toXML(loaded)).toBe(after);
});

test('an invalid colour is refused before anything is written', async () => {
  const loaded = await load(PLAIN_XML);
  const { canvas } = loaded;
  const before = await toXML(loaded);
  expect(() => canvas.setColor(node(canvas, 'Task_1'), { fill: 'not-a-colour' }))
    .toThrow(/invalid color value/);
  expect(canvas.getScene()!.revision).toBe(0);
  expect(await toXML(loaded)).toBe(before);
});

// --- the pre-coloured examples ----------------------------------------------

test('a pre-coloured example survives an untouched round trip', async () => {
  const loaded = await load(exampleXml(COLORED_EXAMPLE));
  const { canvas } = loaded;
  const before = await toXML(loaded);

  // The fixture really is coloured, and the canvas reads it.
  const colored = [...canvas.getScene()!.elementsById.values()].filter(
    (el): el is SceneNode => el.kind === 'node' && !!readColors(el as SceneNode).fill,
  );
  expect(colored.length).toBeGreaterThan(0);
  expect(readColors(colored[0])).toEqual({ fill: '#f1d0cd', stroke: '#ac5a54' });
  // And it is what the shape is actually painted with.
  expect(drawn(canvas, colored[0].id).fill).toBe('#f1d0cd');

  // Importing and re-serializing changes nothing.
  expect(before).toContain('bioc:fill="#f1d0cd"');
  expect(await toXML(loaded)).toBe(before);
});

test('re-writing a pre-coloured element with its own colour is a no-op', async () => {
  const loaded = await load(exampleXml(COLORED_EXAMPLE));
  const { canvas } = loaded;
  const before = await toXML(loaded);
  const target = [...canvas.getScene()!.elementsById.values()].find(
    (el): el is SceneNode => el.kind === 'node' && !!readColors(el as SceneNode).fill,
  )!;

  const { fill, stroke } = readColors(target);
  expect(canvas.setColor(target, { fill, stroke })).toEqual([]);
  expect(canvas.getScene()!.revision).toBe(0);
  expect(await toXML(loaded)).toBe(before);
});

test('recolouring a pre-coloured element replaces all four attributes at once', async () => {
  const loaded = await load(exampleXml(COLORED_EXAMPLE));
  const { canvas } = loaded;
  const target = [...canvas.getScene()!.elementsById.values()].find(
    (el): el is SceneNode => el.kind === 'node' && !!readColors(el as SceneNode).fill,
  )!;
  const diId = (target.di as any).id as string;

  canvas.setColor(target, { fill: '#d9ecdc', stroke: '#3f7a4a' });

  const { xml, reloaded } = await roundTrip(loaded);
  const tag = diTag(xml, diId);
  expect(tag).toContain('bioc:fill="#d9ecdc"');
  expect(tag).toContain('bioc:stroke="#3f7a4a"');
  expect(tag).toContain('color:background-color="#d9ecdc"');
  expect(tag).toContain('color:border-color="#3f7a4a"');
  // No stale half of the old colour is left in either vocabulary on this element.
  expect(tag).not.toContain('#f1d0cd');
  expect(tag).not.toContain('#ac5a54');
  // Its siblings keep the colours the example shipped with.
  const reloadedDi = diElements(reloaded).get(target.id);
  expect(reloadedDi.get('bioc:fill')).toBe('#d9ecdc');
  expect(xml).toContain('bioc:fill="#f1d0cd"');
});
