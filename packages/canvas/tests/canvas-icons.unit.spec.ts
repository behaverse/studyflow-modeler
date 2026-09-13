import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { Canvas } from '@canvas/index.ts';
import type { IconDef } from '@canvas/index.ts';
import { buildCatalog, getCatalog, setCatalog } from '@core/notation';
import { fromLinkml, parseLinkml } from '@core/notation/linkml';

import { installDocument, loadCanvas } from './canvasHarness';
import { loadSchemaModels, schemaPackages } from '@tests/schemas';

/**
 * Icons as the renderer draws them. The host's `iconResolver` answers a key (a BPMN
 * local name, a marker, an iconify class) with a glyph body, an image, a class, or
 * `null` for "no glyph", and the renderer draws real SVG wherever the answer allows,
 * so an exported document paints without the app's stylesheet.
 */

type Resolver = (key: string, bo?: any) => IconDef | null | undefined;

/** One user task (its type icon is the top-left glyph) plus a looping task (a marker glyph). */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    id="Defs_I" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_I" isExecutable="false">
    <bpmn:userTask id="Task_1" name="Ask" />
    <bpmn:task id="Task_2" name="Repeat">
      <bpmn:standardLoopCharacteristics />
    </bpmn:task>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_I">
    <bpmndi:BPMNPlane id="Plane_I" bpmnElement="Process_I">
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="100" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="260" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const GLYPH = '<path d="M4 4h16v16H4z" fill="currentColor"/>';
const GLYPH_DEF: IconDef = { content: GLYPH, viewBox: '0 0 24 24' };

async function load(iconResolver?: Resolver): Promise<Canvas> {
  return (await loadCanvas(XML, { iconResolver })).canvas;
}

/** The `<g>` the renderer drew for `id`. */
function graphics(canvas: Canvas, id: string): SVGGElement {
  const g = canvas.getGraphics(id);
  if (!g) throw new Error(`no graphics for ${id}`);
  return g;
}

/** The icon keys drawn inside `id`'s `<g>`, in paint order. */
function iconKeys(canvas: Canvas, id: string): (string | null)[] {
  return [...graphics(canvas, id).querySelectorAll('[data-icon-key]')].map((el) => el.getAttribute('data-icon-key'));
}

test('the resolver\'s answer decides how a type glyph is drawn, and whether at all', async () => {
  // A `data:` image draws as itself: an `<image>` runs no script, whatever document it came in.
  const href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${GLYPH}</svg>`)}`;
  const CASES: [label: string, resolver: Resolver, drawn: string | null, exported?: string][] = [
    ['inline content: a nested <svg> with its paths', () => GLYPH_DEF, 'svg.sf-icon > path[d="M4 4h16v16H4z"]', 'M4 4h16v16H4z'],
    ['an image URL: an <image>', () => ({ href }), `image.sf-icon[href="${href}"]`, `href="${href}"`],
    ['a class the stylesheet does not know: a foreignObject for the host to paint', () => ({ cssClass: 'iconify bi--person' }), 'foreignObject.icon-container > div[data-icon-class="iconify bi--person"]'],
    // `null` is the app's answer for a type BPMN draws no glyph for (a sub-process, a call activity).
    ['null: nothing', (key) => (key === 'loop' ? GLYPH_DEF : null), null],
  ];
  for (const [label, resolver, drawn, exported] of CASES) {
    const canvas = await load(resolver);
    expect(iconKeys(canvas, 'Task_1'), label).toEqual(drawn ? ['UserTask'] : []);
    if (drawn) expect(graphics(canvas, 'Task_1').querySelector(drawn), label).not.toBeNull();
    if (exported) expect(canvas.toSVG(), label).toContain(exported);
    // The answer is per key: the loop marker, asked for separately, is drawn whatever the type's answer was.
    expect(iconKeys(canvas, 'Task_2'), label).toContain('loop');
  }
});

test('a marker glyph goes through the same resolver, stamped with its key, in the element\'s colour', async () => {
  const canvas = await load(() => GLYPH_DEF);
  // A plain task draws the glyph the resolver names for `Task`, then its loop marker. The key is a
  // marker's identity: two markers can share their paths (parallel and sequential differ by a rotation).
  expect(iconKeys(canvas, 'Task_2')).toEqual(['Task', 'loop']);
  const path = graphics(canvas, 'Task_2').querySelector('svg.sf-icon[data-icon-key="loop"] path')!;
  // Real geometry in the SVG namespace, with `currentColor` written as the muted ink, so a
  // document opened anywhere paints the glyph.
  expect(path.namespaceURI).toBe('http://www.w3.org/2000/svg');
  expect(path.getAttribute('fill')).toBe('#78716c');
  expect(canvas.toSVG()).not.toContain('currentColor');
});

// --- `meta.glyph` ----------------------------------------------------------------

/** A fixture schema: a task type whose `code` attribute is drawn over its icon. */
const GLYPH_SCHEMA = `
id: http://example.org/schemas/glyph/v1
name: glyph
default_prefix: glyph
default_range: string
prefixes:
  linkml: https://w3id.org/linkml/
  glyph: http://example.org/schemas/glyph/v1/
  bpmn: http://www.omg.org/spec/BPMN/20100524/MODEL
imports:
  - linkml:types
classes:
  Step:
    implements:
      - bpmn:Task
    annotations:
      glyph: code
    attributes:
      code: {}
`;

const GLYPH_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:glyph="http://example.org/schemas/glyph/v1"
    id="Defs_S" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_S" isExecutable="false">
    <bpmn:task id="Short"><bpmn:extensionElements><glyph:step code="nb" /></bpmn:extensionElements></bpmn:task>
    <bpmn:task id="Long"><bpmn:extensionElements><glyph:step code="SART" /></bpmn:extensionElements></bpmn:task>
    <bpmn:task id="Unset"><bpmn:extensionElements><glyph:step /></bpmn:extensionElements></bpmn:task>
    <bpmn:task id="Plain" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_S">
    <bpmndi:BPMNPlane id="Plane_S" bpmnElement="Process_S">
      <bpmndi:BPMNShape id="Short_di" bpmnElement="Short"><dc:Bounds x="100" y="100" width="120" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Long_di" bpmnElement="Long"><dc:Bounds x="260" y="100" width="120" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Unset_di" bpmnElement="Unset"><dc:Bounds x="420" y="100" width="120" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Plain_di" bpmnElement="Plain"><dc:Bounds x="580" y="100" width="120" height="80" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('the attribute a type\'s `meta.glyph` names is drawn over its icon, upper-cased, smaller when long', async () => {
  // One icon for a family of types does not say which member a shape is (a battery of
  // assessments is a row of identical hexagons); the glyph does.
  const models = [...loadSchemaModels(), ...fromLinkml([parseLinkml(GLYPH_SCHEMA, 'glyph.linkml.yaml')])];
  const shipped = getCatalog();
  setCatalog(buildCatalog(models));
  try {
    installDocument();
    const { rootElement } = await new BpmnModdle(schemaPackages(models) as any).fromXML(GLYPH_XML);
    const canvas = new Canvas({ iconResolver: () => GLYPH_DEF });
    canvas.importDefinitions(rootElement);
    const glyphOf = (id: string) => graphics(canvas, id).querySelector('text.sf-icon-text');

    expect(glyphOf('Short')?.textContent).toBe('NB');
    // Beside the type icon, not instead of it.
    expect(iconKeys(canvas, 'Short')).toEqual(['Task']);
    expect(glyphOf('Long')?.textContent).toBe('SART');
    expect(Number(glyphOf('Long')!.getAttribute('font-size'))).toBeLessThan(Number(glyphOf('Short')!.getAttribute('font-size')));
    expect(glyphOf('Unset'), 'no value, no glyph').toBeNull();
    expect(glyphOf('Plain'), 'a type without meta.glyph').toBeNull();
  } finally {
    setCatalog(shipped);
  }
});

// --- gateways, events, data ---------------------------------------------------------

/** An exclusive gateway plus an end event carrying an error definition. */
const GATEWAY_EVENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    id="Defs_G" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_G" isExecutable="false">
    <bpmn:exclusiveGateway id="Gateway_1" />
    <bpmn:endEvent id="End_1">
      <bpmn:errorEventDefinition id="ErrorDef_1" />
    </bpmn:endEvent>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_G">
    <bpmndi:BPMNPlane id="Plane_G" bpmnElement="Process_G">
      <bpmndi:BPMNShape id="Gateway_1_di" bpmnElement="Gateway_1" isMarkerVisible="true">
        <dc:Bounds x="100" y="100" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="200" y="107" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('a gateway draws the glyph the resolver names, else its own marker, never a placeholder', async () => {
  const named = await loadCanvas(GATEWAY_EVENT_XML, { iconResolver: (key) => (key === 'ExclusiveGateway' ? GLYPH_DEF : undefined) });
  expect(iconKeys(named.canvas, 'Gateway_1')).toEqual(['ExclusiveGateway']);

  const own = await loadCanvas(GATEWAY_EVENT_XML, {});
  expect(graphics(own.canvas, 'Gateway_1').querySelectorAll('path').length).toBeGreaterThan(0);
  expect(iconKeys(own.canvas, 'Gateway_1')).toEqual([]);
});

test('an event\'s centre takes its definition\'s symbol, else its own type\'s, and a badge then moves to the rim', async () => {
  // `End_1` is an end event with an error definition.
  const CASES: [label: string, resolver: Resolver, centre: string[]][] = [
    ['the resolver knows the definition', (key) => (key === 'ErrorEventDefinition' ? GLYPH_DEF : undefined), ['ErrorEventDefinition']],
    ['it knows only the event type (a schema event type\'s icon)', (key) => (key === 'EndEvent' ? GLYPH_DEF : undefined), ['EndEvent']],
    ['it knows neither: the circle stays bare', () => undefined, []],
  ];
  for (const [label, resolver, centre] of CASES) {
    const { canvas } = await loadCanvas(GATEWAY_EVENT_XML, { iconResolver: resolver });
    expect(iconKeys(canvas, 'End_1'), label).toEqual(centre);
  }

  // An attribute badge (`studyflow:redirectTo`) takes a bare event's centre; with a symbol there it sits top-right.
  const xml = GATEWAY_EVENT_XML
    .replace('xmlns:bpmn=', 'xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:bpmn=')
    .replace('<bpmn:endEvent id="End_1">', '<bpmn:endEvent id="End_1" studyflow:redirectTo="https://example.org/done">');
  const { canvas } = await loadCanvas(xml, { iconResolver: () => GLYPH_DEF });
  const g = graphics(canvas, 'End_1');
  const symbol = g.querySelector('svg.sf-icon[data-icon-key="ErrorEventDefinition"]')!;
  const badge = g.querySelector('svg.sf-icon[data-icon-key="iconify ph--sign-out"]')!;
  expect(symbol.getAttribute('x')).toBe('8');
  expect(Number(badge.getAttribute('x'))).toBeGreaterThan(8);
  expect(Number(badge.getAttribute('y'))).toBeLessThan(8);
});

/**
 * Data glyphs (`renderer.drawDataIcons`): a data store draws the icon its dataset
 * format's literal declares, a typed data object its type's glyph, and a plain data
 * reference none — the shape is the notation.
 */
const DATA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1"
    id="Defs_D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_D" isExecutable="false">
    <bpmn:dataStoreReference id="Store_bids" name="BIDS">
      <bpmn:extensionElements><studyflow:dataset format="bids" /></bpmn:extensionElements>
    </bpmn:dataStoreReference>
    <bpmn:dataStoreReference id="Store_psychds" name="Psych-DS">
      <bpmn:extensionElements><studyflow:dataset format="psych-ds" /></bpmn:extensionElements>
    </bpmn:dataStoreReference>
    <bpmn:dataObjectReference id="Obj_table" name="Table">
      <bpmn:extensionElements><studyflow:table /></bpmn:extensionElements>
    </bpmn:dataObjectReference>
    <bpmn:dataObjectReference id="Obj_plain" name="Plain" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_D">
    <bpmndi:BPMNPlane id="Plane_D" bpmnElement="Process_D">
      <bpmndi:BPMNShape id="Store_bids_di" bpmnElement="Store_bids">
        <dc:Bounds x="100" y="100" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Store_psychds_di" bpmnElement="Store_psychds">
        <dc:Bounds x="200" y="100" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Obj_table_di" bpmnElement="Obj_table">
        <dc:Bounds x="300" y="100" width="36" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Obj_plain_di" bpmnElement="Obj_plain">
        <dc:Bounds x="400" y="100" width="36" height="50" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** Stands in for the modeler's resolver in the data cases: a class draws, a typed element draws. */
function dataResolver(key: string, bo?: any): IconDef | null | undefined {
  if (key.startsWith('iconify ')) return GLYPH_DEF;
  if (bo?.extensionElements) return GLYPH_DEF;
  return null;
}

test('a data store draws its format\'s icon, a typed data object its type\'s, a plain one none', async () => {
  const { canvas } = await loadCanvas(DATA_XML, { iconResolver: dataResolver });
  const CASES: [label: string, id: string, keys: string[]][] = [
    ['BIDS: the bundled logotype', 'Store_bids', ['bids-dataset-icon']],
    ['Psych-DS: the class its format literal names', 'Store_psychds', ['iconify ph--flask']],
    ['a table: its type glyph', 'Obj_table', ['DataObjectReference']],
    ['a plain data object', 'Obj_plain', []],
  ];
  for (const [label, id, keys] of CASES) expect(iconKeys(canvas, id), label).toEqual(keys);
  // The bundled logotype is painted in the muted ink, like every other glyph.
  expect(graphics(canvas, 'Store_bids').querySelector('g[data-icon-key="bids-dataset-icon"] path')!.getAttribute('fill')).toBe('#78716c');
});
