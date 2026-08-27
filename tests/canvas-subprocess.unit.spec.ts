import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import { EXPANDED_SUBPROCESS_SIZE } from '@canvas/interaction/create.ts';
import { COLLAPSED_SUBPROCESS_SIZE } from '@canvas/model/expand.ts';
import type { SceneElement, SceneNode } from '@canvas/model/scene.ts';

import { exampleXml } from './utils';

import { freshModdle, installDocument, loadCanvas, jsdomWindow, type Loaded } from './canvasHarness';

/**
 * P5 expand/collapse writeback (design §1 "expand/collapse subprocess →
 * `BPMNShape.isExpanded` (+ reveal/hide nested plane)" and "gateway marker →
 * `BPMNShape.isMarkerVisible`", §6 P5).
 *
 * The fixture is a real shipped diagram, `sklearn_pipeline`, which carries all three
 * shapes of the problem at once:
 *
 * - `prepare_data` — an **inline-expanded** sub-process: `isExpanded="true"`, drawn
 *   650×290, its children's `BPMNShape`s sitting in the *root* plane.
 * - `select_model` / `evaluate_and_report` — **drilled-down** sub-processes:
 *   `isExpanded="false"`, each owning its own `bpmndi:BPMNDiagram` whose plane holds
 *   the children's DI in its own coordinate space (design §1 "Nested planes").
 * - `is_good_enough` — an exclusive gateway carrying `isMarkerVisible="true"`.
 *
 * The contract under test: a toggle writes ONE DI attribute (plus the shape's own
 * `dc:Bounds`) and nothing else. Collapsing HIDES — every contained business object
 * stays in `flowElements`, every contained `BPMNShape`/`BPMNEdge` stays in its plane,
 * and the nested `BPMNDiagram` stays in `definitions.diagrams` — so a no-op
 * collapse+expand round-trips to a byte-identical document. Every structural
 * assertion is made against `bpmn-moddle`'s `toXML` of the SAME live tree the canvas
 * edited (and a reload of it), never against the scene alone.
 */

installDocument();
const win = jsdomWindow();

const EXAMPLE = 'sklearn_pipeline.studyflow.png';

/** A minimal hand-built process, for the cases the example cannot express. */
const PLAIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_P" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_P" isExecutable="false">
    <bpmn:task id="Task_P" name="Plain" />
    <bpmn:exclusiveGateway id="Gate_P" name="Choose" />
    <bpmn:subProcess id="Sub_P" name="No flag" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_P">
    <bpmndi:BPMNPlane id="Plane_P" bpmnElement="Process_P">
      <bpmndi:BPMNShape id="Task_P_di" bpmnElement="Task_P">
        <dc:Bounds x="100" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gate_P_di" bpmnElement="Gate_P">
        <dc:Bounds x="300" y="115" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub_P_di" bpmnElement="Sub_P">
        <dc:Bounds x="450" y="100" width="120" height="90" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

function loadExample(): Promise<Loaded> {
  return loadCanvas(exampleXml(EXAMPLE));
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
function diShapes(definitions: any): Map<string, any> {
  const out = new Map<string, any>();
  for (const diagram of definitions.diagrams ?? []) {
    for (const pe of diagram.plane?.planeElement ?? []) {
      if (pe.bpmnElement?.id) out.set(pe.bpmnElement.id, pe);
    }
  }
  return out;
}

/** The business object of `id` anywhere in a (possibly reloaded) tree. */
function boOf(definitions: any, id: string): any {
  let found: any;
  const visit = (value: any, seen: Set<any>): void => {
    if (found || !value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, seen);
      return;
    }
    if (typeof value.$type !== 'string') return;
    if (value.id === id) {
      found = value;
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('$')) continue;
      visit(child, seen);
    }
  };
  visit(definitions, new Set());
  return found;
}

/** The `<bpmndi:BPMNShape …>` opening tag of a DI id, as serialized. */
function shapeTag(xml: string, diId: string): string {
  const match = xml.match(new RegExp(`<bpmndi:BPMNShape id="${diId}"[^>]*>`));
  expect(match, `no <bpmndi:BPMNShape id="${diId}"> in the serialized document`).not.toBeNull();
  return match![0];
}

/** The `<dc:Bounds …>` that follows a DI id, as serialized. */
function boundsTag(xml: string, diId: string): string {
  const match = xml.match(
    new RegExp(`<bpmndi:BPMNShape id="${diId}"[^>]*>\\s*<dc:Bounds[^>]*/>`),
  );
  expect(match, `no <dc:Bounds> under "${diId}"`).not.toBeNull();
  return match![0].slice(match![0].indexOf('<dc:Bounds'));
}

// --- scene / DOM readers ------------------------------------------------------

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function ids(elements: readonly SceneElement[]): string[] {
  return elements.map((element) => element.id).sort();
}

/** Whether the element's rendered `<g>` is hidden (`display="none"`). */
function isDrawnHidden(canvas: Canvas, id: string): boolean {
  const g = canvas.getGraphics(id);
  expect(g, `${id} has no rendered group`).toBeTruthy();
  return g!.getAttribute('display') === 'none';
}

/** All glyph text drawn inside an element's `<g>` (markers included). */
function glyphs(canvas: Canvas, id: string): string {
  const g = canvas.getGraphics(id);
  return Array.from(g?.querySelectorAll('text') ?? [])
    .map((t) => t.textContent ?? '')
    .join('');
}

/** Every descendant id of a container, as the scene sees it. */
function descendants(canvas: Canvas, id: string): string[] {
  const out: string[] = [];
  const visit = (n: SceneNode): void => {
    for (const child of n.children) {
      out.push(child.id);
      if (child.kind === 'node') visit(child);
    }
  };
  visit(node(canvas, id));
  return out.sort();
}

interface Pt { x: number; y: number; }

function fireMouse(canvas: Canvas, type: string, diagram: Pt): void {
  const screen = canvas.getViewport().toScreen(diagram);
  canvas.getSvg().dispatchEvent(new win.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: screen.x,
    clientY: screen.y,
    button: 0,
  }));
}

function center(n: SceneNode): Pt {
  return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
}

// --- the fixture is what we think it is ---------------------------------------

test('the sklearn_pipeline example carries an inline-expanded and two drilled-down sub-processes', async () => {
  const loaded = await loadExample();
  const { canvas, definitions } = loaded;

  expect(definitions.diagrams).toHaveLength(3);
  expect(canvas.getScene()!.planes).toHaveLength(3);

  const prepare = node(canvas, 'prepare_data');
  expect(prepare.type).toBe('bpmn:SubProcess');
  expect(prepare.isExpanded).toBe(true);
  expect([prepare.x, prepare.y, prepare.width, prepare.height]).toEqual([160, 170, 650, 290]);

  const select = node(canvas, 'select_model');
  expect(select.isExpanded).toBe(false);
  expect([select.x, select.y, select.width, select.height]).toEqual([1204, 230, 100, 80]);

  // The importer splices a nested plane's contents under the sub-process that owns
  // the plane, so `children` covers both layouts.
  expect(descendants(canvas, 'prepare_data')).toContain('select_features');
  expect(descendants(canvas, 'select_model')).toContain('build_pipeline');

  expect(canvas.canExpand(prepare)).toBe(true);
  expect(canvas.canExpand(node(canvas, 'is_good_enough'))).toBe(false);
});

// --- collapsing ----------------------------------------------------------------

test('collapsing an expanded sub-process writes isExpanded="false" and hides — never deletes — its contents', async () => {
  const loaded = await loadExample();
  const { canvas, definitions } = loaded;
  const scene = canvas.getScene()!;
  const prepare = node(canvas, 'prepare_data');
  const contents = descendants(canvas, 'prepare_data');
  expect(contents.length).toBeGreaterThan(5);

  const before = await toXML(loaded);
  const flowsBefore = (boOf(definitions, 'prepare_data').flowElements ?? []).map((el: any) => el.id);
  const planeElementsBefore = definitions.diagrams[0].plane.planeElement.length;
  const revision = scene.revision;

  expect(canvas.setExpanded(prepare, false)).toBe(true);

  // (1) The DI flag and the collapsed footprint, in the LIVE tree.
  expect(prepare.isExpanded).toBe(false);
  expect(diShapes(definitions).get('prepare_data').isExpanded).toBe(false);
  expect([prepare.width, prepare.height])
    .toEqual([COLLAPSED_SUBPROCESS_SIZE.width, COLLAPSED_SUBPROCESS_SIZE.height]);
  expect([prepare.x, prepare.y]).toEqual([160, 170]); // the top-left corner stays put
  expect(scene.revision).toBeGreaterThan(revision);

  // (2) Collapse HIDES. Nothing left `flowElements`, nothing left the plane.
  expect((boOf(definitions, 'prepare_data').flowElements ?? []).map((el: any) => el.id))
    .toEqual(flowsBefore);
  expect(definitions.diagrams[0].plane.planeElement).toHaveLength(planeElementsBefore);
  for (const id of contents) {
    expect(scene.elementsById.has(id), `${id} survives the collapse`).toBe(true);
    expect(diShapes(definitions).has(id), `${id} keeps its DI`).toBe(true);
  }

  // (3) …and is drawn hidden, with the ⊞ marker on the container.
  for (const id of contents) expect(isDrawnHidden(canvas, id), `${id} is drawn`).toBe(true);
  expect(isDrawnHidden(canvas, 'prepare_data')).toBe(false);
  expect(glyphs(canvas, 'prepare_data')).toContain('⊞');

  // (4) The serialized document says exactly that, and survives a reload.
  const { xml, reloaded } = await roundTrip(loaded);
  expect(shapeTag(xml, 'Prepare_di')).toContain('isExpanded="false"');
  expect(boundsTag(xml, 'Prepare_di')).toContain('width="100"');
  expect(boundsTag(xml, 'Prepare_di')).toContain('height="80"');
  expect(xml).toContain('<bpmn:serviceTask id="select_features"');
  expect(diShapes(reloaded).get('prepare_data').isExpanded).toBe(false);
  expect((boOf(reloaded, 'prepare_data').flowElements ?? []).map((el: any) => el.id))
    .toEqual(flowsBefore);
  expect(reloaded.diagrams).toHaveLength(3);

  // (5) Only the one shape moved: every OTHER shape tag is byte-identical.
  for (const diId of ['Start_di', 'Select_di', 'Report_di', 'Select_Features_di']) {
    expect(shapeTag(xml, diId), diId).toBe(shapeTag(before, diId));
    expect(boundsTag(xml, diId), diId).toBe(boundsTag(before, diId));
  }
});

test('a hidden child is neither hit-testable nor a drop target', async () => {
  const { canvas } = await loadExample();
  const child = node(canvas, 'select_features');
  const at = center(child);

  expect(canvas.hitTest(at)?.id).toBe('select_features');
  canvas.setExpanded(node(canvas, 'prepare_data'), false);

  // The collapsed box no longer covers that point, and what it hides cannot be hit.
  expect(canvas.hitTest(at)).toBeUndefined();
  expect(canvas.hitTest(center(node(canvas, 'prepare_data')))?.id).toBe('prepare_data');
});

// --- expanding ------------------------------------------------------------------

test('expanding a drilled-down sub-process reveals its sub-plane contents and leaves the plane where it is', async () => {
  const loaded = await loadExample();
  const { canvas, definitions } = loaded;
  const select = node(canvas, 'select_model');
  const contents = descendants(canvas, 'select_model');

  // Its contents live in a nested plane and start out hidden.
  const nested = definitions.diagrams[1].plane;
  expect(nested.bpmnElement.id).toBe('select_model');
  expect(contents).toContain('cross_validate');
  for (const id of contents) expect(isDrawnHidden(canvas, id), id).toBe(true);
  expect(glyphs(canvas, 'select_model')).toContain('⊞');

  const nestedBefore = nested.planeElement.map((pe: any) => ({
    id: pe.bpmnElement?.id,
    bounds: pe.bounds ? { ...pe.bounds } : undefined,
  }));

  expect(canvas.setExpanded(select, true)).toBe(true);

  expect(select.isExpanded).toBe(true);
  expect(diShapes(definitions).get('select_model').isExpanded).toBe(true);
  // Nothing was remembered (the document came in collapsed), so it takes the default
  // expanded footprint.
  expect([select.width, select.height])
    .toEqual([EXPANDED_SUBPROCESS_SIZE.width, EXPANDED_SUBPROCESS_SIZE.height]);

  // Revealed, and drawn where their OWN DI puts them — the sub-plane is untouched.
  for (const id of contents) expect(isDrawnHidden(canvas, id), id).toBe(false);
  expect(glyphs(canvas, 'select_model')).not.toContain('⊞');
  expect(definitions.diagrams).toHaveLength(3);
  expect(nested.planeElement.map((pe: any) => ({
    id: pe.bpmnElement?.id,
    bounds: pe.bounds ? { ...pe.bounds } : undefined,
  }))).toEqual(nestedBefore);

  const { xml, reloaded } = await roundTrip(loaded);
  expect(shapeTag(xml, 'Select_di')).toContain('isExpanded="true"');
  expect(reloaded.diagrams).toHaveLength(3);
  expect(reloaded.diagrams[1].plane.bpmnElement.id).toBe('select_model');
  expect(diShapes(reloaded).get('build_pipeline').bounds.x).toBe(256);
});

test('expanding restores the exact footprint the collapse took away', async () => {
  const { canvas } = await loadExample();
  const prepare = node(canvas, 'prepare_data');

  canvas.setExpanded(prepare, false);
  expect([prepare.width, prepare.height]).toEqual([100, 80]);
  canvas.setExpanded(prepare, true);
  expect([prepare.x, prepare.y, prepare.width, prepare.height]).toEqual([160, 170, 650, 290]);
});

// --- the round trip ---------------------------------------------------------------

test('a no-op collapse+expand leaves the document byte-identical', async () => {
  const loaded = await loadExample();
  const { canvas } = loaded;
  const before = await toXML(loaded);

  expect(canvas.setExpanded(node(canvas, 'prepare_data'), false)).toBe(true);
  expect(await toXML(loaded)).not.toBe(before);
  expect(canvas.setExpanded(node(canvas, 'prepare_data'), true)).toBe(true);

  expect(await toXML(loaded)).toBe(before);
});

test('a no-op expand+collapse of a drilled-down sub-process leaves the document byte-identical', async () => {
  const loaded = await loadExample();
  const { canvas } = loaded;
  const before = await toXML(loaded);

  expect(canvas.setExpanded(node(canvas, 'select_model'), true)).toBe(true);
  expect(canvas.setExpanded(node(canvas, 'select_model'), false)).toBe(true);

  expect(await toXML(loaded)).toBe(before);
});

// --- the gateway marker flag -------------------------------------------------------

test('a gateway marker toggles through to isMarkerVisible in toXML', async () => {
  const loaded = await loadExample();
  const { canvas, definitions } = loaded;
  const gate = node(canvas, 'is_good_enough');
  const before = await toXML(loaded);

  expect(gate.type).toBe('bpmn:ExclusiveGateway');
  expect(gate.isMarkerVisible).toBe(true);
  expect(glyphs(canvas, 'is_good_enough')).toContain('×');

  expect(canvas.setMarkerVisible(gate, false)).toBe(true);
  expect(diShapes(definitions).get('is_good_enough').isMarkerVisible).toBe(false);
  expect(glyphs(canvas, 'is_good_enough')).not.toContain('×');

  const { xml, reloaded } = await roundTrip(loaded);
  expect(shapeTag(xml, 'Good_Enough_di')).toContain('isMarkerVisible="false"');
  expect(diShapes(reloaded).get('is_good_enough').isMarkerVisible).toBe(false);

  // Setting it back restores the document exactly; a repeat write changes nothing.
  expect(canvas.setMarkerVisible(gate, true)).toBe(true);
  expect(await toXML(loaded)).toBe(before);
  expect(canvas.setMarkerVisible(gate, true)).toBe(false);
  expect(await toXML(loaded)).toBe(before);
});

test('a gateway with no isMarkerVisible attribute gains one on the first toggle', async () => {
  const loaded = await loadCanvas(PLAIN_XML);
  const { canvas, definitions } = loaded;
  const gate = node(canvas, 'Gate_P');

  expect(gate.isMarkerVisible).toBeUndefined();
  expect(canvas.setMarkerVisible(gate, true)).toBe(true);
  expect(diShapes(definitions).get('Gate_P').isMarkerVisible).toBe(true);
  expect(shapeTag(await toXML(loaded), 'Gate_P_di')).toContain('isMarkerVisible="true"');
});

// --- the canvas surface -------------------------------------------------------------

test('only expandable types toggle; everything else is refused and writes nothing', async () => {
  const loaded = await loadCanvas(PLAIN_XML);
  const { canvas } = loaded;
  const before = await toXML(loaded);
  const revision = canvas.getScene()!.revision;

  const task = node(canvas, 'Task_P');
  expect(canvas.canExpand(task)).toBe(false);
  expect(canvas.setExpanded(task, false)).toBe(false);
  expect(canvas.toggleExpanded(node(canvas, 'Gate_P'))).toBe(false);

  expect(canvas.getScene()!.revision).toBe(revision);
  expect(await toXML(loaded)).toBe(before);
});

test('`resize: false` flips the flag and leaves the footprint alone', async () => {
  const loaded = await loadCanvas(PLAIN_XML);
  const { canvas, definitions } = loaded;
  const sub = node(canvas, 'Sub_P');

  // A `BPMNShape` with no `isExpanded` reads as expanded (as the renderer draws it).
  expect(sub.isExpanded).toBeUndefined();
  expect(canvas.setExpanded(sub, false, { resize: false })).toBe(true);

  expect([sub.width, sub.height]).toEqual([120, 90]);
  expect(diShapes(definitions).get('Sub_P').isExpanded).toBe(false);
  const xml = await toXML(loaded);
  expect(shapeTag(xml, 'Sub_P_di')).toContain('isExpanded="false"');
  expect(boundsTag(xml, 'Sub_P_di')).toContain('width="120"');
});

test('writing the flag onto an already-expanded shape leaves its footprint alone', async () => {
  const loaded = await loadCanvas(PLAIN_XML);
  const { canvas, definitions } = loaded;
  const sub = node(canvas, 'Sub_P');

  // `Sub_P_di` omits `isExpanded`, which every reader here takes as expanded; making
  // that explicit is not an "open me up", so the shape keeps the size the document
  // gave it.
  expect(canvas.setExpanded(sub, true)).toBe(true);
  expect([sub.width, sub.height]).toEqual([120, 90]);
  const xml = await toXML(loaded);
  expect(shapeTag(xml, 'Sub_P_di')).toContain('isExpanded="true"');
  expect(boundsTag(xml, 'Sub_P_di')).toContain('width="120"');
  expect(diShapes(definitions).get('Sub_P').isExpanded).toBe(true);
});

test('toggleExpanded flips whichever way the shape currently sits', async () => {
  const { canvas } = await loadExample();
  const select = node(canvas, 'select_model');

  expect(canvas.toggleExpanded(select)).toBe(true);
  expect(select.isExpanded).toBe(true);
  expect(canvas.toggleExpanded(select)).toBe(true);
  expect(select.isExpanded).toBe(false);
});

test('double-clicking a sub-process toggles it instead of opening the label editor', async () => {
  const { canvas } = await loadExample();
  const select = node(canvas, 'select_model');

  fireMouse(canvas, 'dblclick', center(select));
  expect(select.isExpanded).toBe(true);
  expect(canvas.getLabelEditing().isActive()).toBe(false);
  expect(canvas.getSelection().get().map((el) => el.id)).toEqual(['select_model']);

  // A plain activity keeps the rename gesture.
  fireMouse(canvas, 'dblclick', center(node(canvas, 'select_features')));
  expect(canvas.getLabelEditing().isActive()).toBe(true);
  expect(canvas.getLabelEditing().getValue()).toBe('select_features');
});

test('the double-click affordance can be switched off', async () => {
  const { canvas } = await loadCanvas(exampleXml(EXAMPLE), { toggleExpandOnDoubleClick: false });

  const select = node(canvas, 'select_model');
  fireMouse(canvas, 'dblclick', center(select));
  expect(select.isExpanded).toBe(false);
  expect(canvas.getLabelEditing().isActive()).toBe(true);
});

test('a collapse fires one revision bump and one element.changed for the container', async () => {
  const { canvas } = await loadExample();
  const changed: string[] = [];
  canvas.getEventBus().on<{ element: SceneElement }>('element.changed', (e) => changed.push(e.element.id));
  const scene = canvas.getScene()!;
  const revision = scene.revision;

  canvas.setExpanded(node(canvas, 'prepare_data'), false);

  expect(scene.revision).toBe(revision + 1);
  expect(ids(changed.map((id) => scene.elementsById.get(id) as SceneElement))).toEqual(['prepare_data']);
});
