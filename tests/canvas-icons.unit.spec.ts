import { expect, test } from '@playwright/test';

import type { Canvas } from '@canvas/index.ts';
import type { IconDef, SceneElement } from '@canvas/index.ts';

import { loadCanvas } from './canvasHarness';

/**
 * Native SVG icons at render time (parity addendum 6 §1).
 *
 * The canvas used to mount every app glyph as `<foreignObject><div class="i-…">`,
 * which paints only where the modeler's Tailwind/iconify pipeline is loaded — so an
 * exported document had to have its icons substituted afterwards
 * (`export/svgEmbedding.embedIconsInSvg`, now deleted). The injected
 * {@link IconResolver} may instead answer with a glyph BODY (`{ content, viewBox }`,
 * exactly the shape `export/iconSource.ts` fetches), and the renderer draws it as a
 * real nested `<svg>`.
 *
 * What this spec pins: the drawn form for each kind of resolver answer, that
 * `currentColor` is rewritten the way the old exporter rewrote it, and that a glyph
 * arriving later (the app's async icon cache) replaces the placeholder in place on a
 * re-draw — the two states a document can be serialized in.
 */

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

async function load(iconResolver?: (key: string, bo?: any) => IconDef | null | undefined): Promise<Canvas> {
  return (await loadCanvas(XML, { iconResolver })).canvas;
}

/** The `<g>` the renderer drew for `id`. */
function graphics(canvas: Canvas, id: string): SVGGElement {
  const g = canvas.getGraphics(id);
  if (!g) throw new Error(`no graphics for ${id}`);
  return g;
}

test('a resolver returning inline content draws a real <svg> with paths, not a foreignObject', async () => {
  const canvas = await load(() => ({ content: GLYPH, viewBox: '0 0 24 24' }));

  const g = graphics(canvas, 'Task_1');
  expect(g.querySelectorAll('foreignObject')).toHaveLength(0);

  const icon = g.querySelector('svg.sf-icon');
  expect(icon).toBeTruthy();
  expect(icon!.getAttribute('viewBox')).toBe('0 0 24 24');
  // Real geometry, in the SVG namespace — an `<img>` rasterizer and a plain SVG
  // viewer both draw this; neither can do anything with a `<div class="i-…">`.
  const path = icon!.querySelector('path');
  expect(path).toBeTruthy();
  expect(path!.namespaceURI).toBe('http://www.w3.org/2000/svg');
  expect(path!.getAttribute('d')).toBe('M4 4h16v16H4z');

  // …and it survives export, which is the whole point of drawing it this way.
  const svg = canvas.toSVG();
  expect(svg).toContain('M4 4h16v16H4z');
  expect(svg).not.toContain('foreignObject');
});

test('an unresolved class falls back to the foreignObject placeholder', async () => {
  const canvas = await load(() => ({ cssClass: 'iconify bi--person' }));

  const g = graphics(canvas, 'Task_1');
  expect(g.querySelectorAll('svg.sf-icon')).toHaveLength(0);

  const placeholder = g.querySelector('foreignObject.icon-container');
  expect(placeholder).toBeTruthy();
  expect(placeholder!.querySelector('div')!.getAttribute('data-icon-class')).toBe('iconify bi--person');
});

test('a marker glyph is drawn inline too, and `currentColor` takes the element colour', async () => {
  const canvas = await load(() => ({ content: GLYPH, viewBox: '0 0 24 24' }));

  // The loop marker sits bottom-centre on `Task_2`; it goes through the same resolver.
  // Named by KEY, because a plain `bpmn:Task` now also carries a top-left type glyph
  // whenever the host's resolver names one, and that one is drawn first.
  const marker = graphics(canvas, 'Task_2').querySelector('svg.sf-icon[data-icon-key="loop"]');
  expect(marker).toBeTruthy();
  // The default stroke colour, substituted the way `embedIconsInSvg` substituted it:
  // a document opened anywhere paints the glyph, with no `currentColor` to inherit.
  expect(marker!.querySelector('path')!.getAttribute('fill')).toBe('#22242A');
  expect(canvas.toSVG()).not.toContain('currentColor');
});

test('a glyph arriving later replaces the placeholder on a re-draw', async () => {
  // The app's icon cache is asynchronous: the first paint gets the CSS class, and the
  // resolved body only exists a network round trip later (`draw/iconCache.ts`).
  let resolved = false;
  const canvas = await load(() => (
    resolved ? { content: GLYPH, viewBox: '0 0 24 24' } : { cssClass: 'iconify bi--person' }
  ));

  expect(graphics(canvas, 'Task_1').querySelectorAll('foreignObject.icon-container')).toHaveLength(1);

  resolved = true;
  const task = canvas.getScene()!.elementsById.get('Task_1')!;
  canvas.redrawElements([task as SceneElement]);

  const g = graphics(canvas, 'Task_1');
  expect(g.querySelectorAll('foreignObject')).toHaveLength(0);
  expect(g.querySelectorAll('svg.sf-icon')).toHaveLength(1);
  // A re-draw is a paint, not an edit: the document is untouched.
  expect(canvas.getScene()!.revision).toBe(0);
});

test('every drawn glyph carries the icon KEY it was asked for', async () => {
  // The identity of a marker is its key, not its geometry: `MARKER_ICONS.parallel`
  // and `MARKER_ICONS.sequential` are the SAME hamburger paths and differ only by a
  // `rotate(90 …)` wrapper the app bakes in, so a selector matching on `d` cannot
  // tell them apart and any assertion written that way passes vacuously. Stamping
  // the key is what lets the loop-marker e2e distinguish the four repetition states
  // (`tests/modeler.loop.spec.ts`), and it puts the resolved glyph on the same
  // footing as the placeholder, which has always carried one.
  const canvas = await load(() => ({ content: GLYPH, viewBox: '0 0 24 24' }));

  expect(graphics(canvas, 'Task_1').querySelector('svg.sf-icon')!.getAttribute('data-icon-key'))
    .toBe('UserTask');
  // A plain `bpmn:Task` draws BOTH: the type glyph the resolver named for the key
  // `Task` (which is how a studyflow extension type's icon reaches an untyped task)
  // and its own loop marker.
  expect([...graphics(canvas, 'Task_2').querySelectorAll('svg.sf-icon')]
    .map((el) => el.getAttribute('data-icon-key')))
    .toEqual(['Task', 'loop']);

  // The class placeholder answers to the same attribute, so one selector spans both
  // states of the app's async icon cache.
  const pending = await load(() => ({ cssClass: 'iconify bi--person' }));
  expect(graphics(pending, 'Task_1').querySelector('foreignObject')!.getAttribute('data-icon-key'))
    .toBe('UserTask');
});

// --- behaverse scene glyph ---------------------------------------------------

/**
 * Behaverse tasks: a two-letter scene (`NB`), a long one (`SART`), and the
 * not-chosen-yet sentinel. The scene lives on the `cognitive:behaverseTask`
 * extension; `instrument` is the schema default `behaverse`, never written out.
 */
const BEHAVERSE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive"
    id="Defs_B" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_B" isExecutable="false">
    <bpmn:task id="Task_NB" name="N-Back">
      <bpmn:extensionElements><cognitive:behaverseTask behaverseScene="NB" /></bpmn:extensionElements>
    </bpmn:task>
    <bpmn:task id="Task_SART" name="SART">
      <bpmn:extensionElements><cognitive:behaverseTask behaverseScene="SART" /></bpmn:extensionElements>
    </bpmn:task>
    <bpmn:task id="Task_None" name="Not chosen">
      <bpmn:extensionElements><cognitive:behaverseTask behaverseScene="undefined" /></bpmn:extensionElements>
    </bpmn:task>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_B">
    <bpmndi:BPMNPlane id="Plane_B" bpmnElement="Process_B">
      <bpmndi:BPMNShape id="Task_NB_di" bpmnElement="Task_NB">
        <dc:Bounds x="100" y="100" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_SART_di" bpmnElement="Task_SART">
        <dc:Bounds x="260" y="100" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_None_di" bpmnElement="Task_None">
        <dc:Bounds x="420" y="100" width="120" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** The scene glyph drawn inside an element's `<g>`, if any. */
function sceneGlyph(canvas: Canvas, id: string): SVGTextElement | null {
  return graphics(canvas, id).querySelector('text.sf-icon-text');
}

test('a behaverse task draws its scene abbreviation over the hex icon', async () => {
  // The two-letter glyph is a hardcoded display convention of the behaverse
  // instrument (`draw/Renderer.drawActivity` before the canvas migration): the hex
  // icon alone does not say WHICH assessment a task runs, and every shipped battery
  // is a row of otherwise identical hexagons.
  const canvas = await loadCanvas(BEHAVERSE_XML, {
    iconResolver: () => ({ content: GLYPH, viewBox: '0 0 24 24' }),
  }).then((loaded) => loaded.canvas);

  const glyph = sceneGlyph(canvas, 'Task_NB')!;
  expect(glyph).toBeTruthy();
  expect(glyph.textContent).toBe('NB');
  // The recovered `MARKER_2CHAR` placement: fixed baseline coordinates, monospace
  // and bold, in the element's own stroke colour.
  expect(glyph.getAttribute('x')).toBe('9');
  expect(glyph.getAttribute('y')).toBe('20');
  expect(glyph.getAttribute('font-size')).toBe('11');
  expect(glyph.getAttribute('font-weight')).toBe('bold');
  expect(glyph.getAttribute('font-family')).toContain('monospace');
  expect(glyph.getAttribute('fill')).toBe('#22242A');

  // It sits ALONGSIDE the hex, not instead of it.
  expect(graphics(canvas, 'Task_NB').querySelectorAll('svg.sf-icon')).toHaveLength(1);
});

test('a long scene takes the small placement, and widens the icon behind it', async () => {
  const canvas = await loadCanvas(BEHAVERSE_XML, {
    iconResolver: () => ({ content: GLYPH, viewBox: '0 0 24 24' }),
  }).then((loaded) => loaded.canvas);

  const glyph = sceneGlyph(canvas, 'Task_SART')!;
  expect(glyph.textContent).toBe('SART');
  // `MARKER_LONG`: four monospace characters at 8px, which is already the box width.
  expect(glyph.getAttribute('x')).toBe('8.5');
  expect(glyph.getAttribute('y')).toBe('21');
  expect(glyph.getAttribute('font-size')).toBe('8');

  // …and the hex grows to hold them, the way `ICON_SIZE_LARGE` grew it. A two-letter
  // scene leaves the icon at its usual size.
  const sizeOf = (id: string): string | null =>
    graphics(canvas, id).querySelector('svg.sf-icon')!.getAttribute('width');
  expect(sizeOf('Task_SART')).toBe('26');
  expect(sizeOf('Task_NB')).toBe('22');
});

test('the not-chosen-yet scene draws no glyph at all', async () => {
  // `undefined` is the sentinel a behaverse task carries before an assessment is
  // picked (the runner reads it the same way, `nodes/behaverse/parser.ts`). Drawing
  // it would put the literal word "UNDE" on the shape.
  const canvas = await loadCanvas(BEHAVERSE_XML, {
    iconResolver: () => ({ content: GLYPH, viewBox: '0 0 24 24' }),
  }).then((loaded) => loaded.canvas);

  expect(sceneGlyph(canvas, 'Task_None')).toBeNull();
  // The hex icon itself is untouched — only the abbreviation is suppressed.
  expect(graphics(canvas, 'Task_None').querySelectorAll('svg.sf-icon')).toHaveLength(1);
  // A non-behaverse task never had one to begin with.
  const plain = await load(() => ({ content: GLYPH, viewBox: '0 0 24 24' }));
  expect(sceneGlyph(plain, 'Task_1')).toBeNull();
});

test('a resolver answering `null` draws nothing at all — not a placeholder box', async () => {
  // `undefined` means "I don't know this key", and the placeholder is the honest
  // answer to that. `null` means "this key HAS no glyph", which is the app's answer
  // for a container activity: `bpmn:SubProcess`, `bpmn:CallActivity`,
  // `bpmn:Transaction` and `bpmn:AdHocSubProcess` carry no top-left type icon in
  // BPMN at all, and were exporting a faint box with a letter in it forever
  // (addendum 6 §5 — the exported SVG is supposed to hold real icon paths).
  const known = await load((key) => (key === 'loop' ? { content: GLYPH, viewBox: '0 0 24 24' } : null));

  expect(graphics(known, 'Task_1').querySelectorAll('.sf-icon-placeholder')).toHaveLength(0);
  expect(graphics(known, 'Task_1').querySelectorAll('svg.sf-icon')).toHaveLength(0);
  // …and the marker it DID know is unaffected: `null` is per-key, not a global mute.
  expect(graphics(known, 'Task_2').querySelectorAll('svg.sf-icon')).toHaveLength(1);

  // `undefined` still placeholders, so a resolver-less canvas is unchanged.
  const unknown = await load(() => undefined);
  expect(graphics(unknown, 'Task_1').querySelectorAll('.sf-icon-placeholder')).toHaveLength(1);
});
