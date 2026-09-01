import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import { EXPANDED_SUBPROCESS_SIZE } from '@canvas/interaction/create.ts';
import { COLLAPSED_SUBPROCESS_SIZE } from '@canvas/model/expand.ts';
import type { SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';

import { exampleXml } from './utils';

import {
  freshModdle,
  installDocument,
  loadCanvas,
  jsdomWindow,
  pointerDown,
  pointerMove,
  pointerUp,
  type Loaded,
} from './canvasHarness';

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

test('expanding a drilled-down sub-process inlines its plane INTO the frame, keeping the interior layout', async () => {
  const loaded = await loadExample();
  const { canvas, definitions } = loaded;
  const select = node(canvas, 'select_model');
  const contents = descendants(canvas, 'select_model');

  // Its contents live in a nested plane, at coordinates that have nothing to do with
  // the container: the frame sits at 1204,230 and `build_pipeline` at 256,160. Simply
  // un-hiding them would scatter the interior a thousand units across the diagram —
  // which is why an expand RE-BASES the plane instead of merely revealing it.
  const nested = definitions.diagrams[1].plane;
  expect(nested.bpmnElement.id).toBe('select_model');
  expect(contents).toContain('cross_validate');
  for (const id of contents) expect(isDrawnHidden(canvas, id), id).toBe(true);
  expect(glyphs(canvas, 'select_model')).toContain('⊞');
  expect([select.x, select.y, select.width, select.height]).toEqual([1204, 230, 100, 80]);

  const before = new Map(contents.map((id) => {
    const el = canvas.getScene()!.elementsById.get(id) as SceneNode;
    return [id, { x: el.x, y: el.y }];
  }));

  expect(canvas.setExpanded(select, true)).toBe(true);

  expect(select.isExpanded).toBe(true);
  expect(diShapes(definitions).get('select_model').isExpanded).toBe(true);
  // The frame is fitted to what it now holds, not to the flat default: the default
  // 350×200 would crop an interior that measures 752×182.
  expect(select.width).toBeGreaterThan(EXPANDED_SUBPROCESS_SIZE.width);
  expect([select.x, select.y]).toEqual([1204, 230]);

  // Revealed, INSIDE the frame, and rigidly: one translation for the whole interior,
  // so every pairwise offset the author drew is preserved bit for bit.
  const deltas = new Set<string>();
  for (const id of contents) {
    expect(isDrawnHidden(canvas, id), id).toBe(false);
    const el = canvas.getScene()!.elementsById.get(id) as SceneNode;
    if (el.kind !== 'node') continue;
    const was = before.get(id)!;
    deltas.add(`${el.x - was.x},${el.y - was.y}`);
    expect(el.x, id).toBeGreaterThanOrEqual(select.x);
    expect(el.y, id).toBeGreaterThanOrEqual(select.y);
    expect(el.x + el.width, id).toBeLessThanOrEqual(select.x + select.width);
    expect(el.y + el.height, id).toBeLessThanOrEqual(select.y + select.height);
  }
  expect(deltas.size, 'one delta for the whole interior').toBe(1);
  expect(glyphs(canvas, 'select_model')).not.toContain('⊞');

  // The document says the same: the nested `BPMNDiagram` is gone (its contents are
  // now `planeElement`s of the parent plane, exactly as an inline-expanded
  // sub-process files them), and `build_pipeline` is filed at its new coordinates.
  const { xml, reloaded } = await roundTrip(loaded);
  expect(shapeTag(xml, 'Select_di')).toContain('isExpanded="true"');
  expect(reloaded.diagrams).toHaveLength(2);
  expect(diShapes(reloaded).get('build_pipeline').bounds.x).toBe(1310);
  expect(reloaded.diagrams[0].plane.planeElement.some((pe: any) => pe.bpmnElement?.id === 'build_pipeline'))
    .toBe(true);
  // …and the business objects never moved: inlining is a DI edit only.
  expect((boOf(reloaded, 'select_model').flowElements ?? []).map((el: any) => el.id))
    .toContain('build_pipeline');
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
  // `Sub_P` owns no `BPMNDiagram` of its own, so it is a sub-process you open IN
  // PLACE. A collapsed one that DOES own a plane is a drill-down target instead, and
  // the double click navigates rather than expands (`canvas-plane.unit.spec.ts`);
  // `view/plane.ts` settles that in the capture phase, before this handler runs.
  const { canvas } = await loadCanvas(PLAIN_XML);
  const sub = node(canvas, 'Sub_P');

  fireMouse(canvas, 'dblclick', center(sub));
  expect(sub.isExpanded).toBe(false);
  expect(canvas.getLabelEditing().isActive()).toBe(false);
  expect(canvas.getSelection().get().map((el) => el.id)).toEqual(['Sub_P']);

  // A plain activity keeps the rename gesture.
  fireMouse(canvas, 'dblclick', center(node(canvas, 'Task_P')));
  expect(canvas.getLabelEditing().isActive()).toBe(true);
  expect(canvas.getLabelEditing().getValue()).toBe('Plain');
});

test('the double-click affordance can be switched off', async () => {
  const { canvas } = await loadCanvas(PLAIN_XML, { toggleExpandOnDoubleClick: false });

  const sub = node(canvas, 'Sub_P');
  fireMouse(canvas, 'dblclick', center(sub));
  expect(sub.isExpanded).toBeUndefined();
  expect(canvas.getLabelEditing().isActive()).toBe(true);
});

test('a collapse fires one revision bump for the container and the edges it re-docked', async () => {
  const { canvas } = await loadExample();
  const changed: string[] = [];
  const batches: string[][] = [];
  canvas.getEventBus().on<{ element: SceneElement }>('ElementChanged', (e) => changed.push(e.element.id));
  canvas.getEventBus().on<{ elements: SceneElement[] }>(
    'ElementsChanged',
    (e) => batches.push(e.elements.map((el) => el.id)),
  );
  const scene = canvas.getScene()!;
  const revision = scene.revision;

  canvas.setExpanded(node(canvas, 'prepare_data'), false);

  // ONE revision bump, and therefore ONE undo step: the flag, the shape's new
  // `dc:Bounds` and every re-docked incident waypoint land in the same
  // `Writeback.finish`. A follow-up `rerouteEdges` would have made it two.
  expect(scene.revision).toBe(revision + 1);
  expect(batches).toHaveLength(1);
  // The container plus exactly the edges docked to it — never its interior, which a
  // toggle must leave alone.
  expect(ids(changed.map((id) => scene.elementsById.get(id) as SceneElement)))
    .toEqual(['flow_prepare_done', 'flow_start', 'prepare_data']);
});

/**
 * A flow that CROSSES a sub-process boundary — an outside task connected to one
 * inside. BPMN does not allow this (a sequence flow belongs to one `flowElements`
 * level), and the editor no longer lets one be drawn or dragged into existence
 * (`rules/rules.ts canMove`) — but a document can still ARRIVE holding one: written
 * by another tool, hand-edited, or saved by an older build. It has to be drawn
 * sanely, and while the container is closed there is nothing on screen for the inner
 * end. The same treatment carries the artifact associations that legitimately DO
 * cross the boundary.
 *
 * The rule: an edge always names the inner element; the geometry follows what is
 * drawn. Closed, it docks on the frame; open, on the shape again — and the route the
 * document shipped comes back verbatim (`model/expand.ts restoreIncidentRouting`).
 */
const CROSSING_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_X" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_X" isExecutable="false">
    <bpmn:task id="Outside" name="Outside" />
    <bpmn:subProcess id="Sub_X" name="Sub">
      <bpmn:task id="Inner" name="Inner" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="Cross_1" sourceRef="Outside" targetRef="Inner" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_X">
    <bpmndi:BPMNPlane id="Plane_X" bpmnElement="Process_X">
      <bpmndi:BPMNShape id="Outside_di" bpmnElement="Outside">
        <dc:Bounds x="60" y="200" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub_X_di" bpmnElement="Sub_X" isExpanded="true">
        <dc:Bounds x="260" y="100" width="360" height="280" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Inner_di" bpmnElement="Inner">
        <dc:Bounds x="400" y="200" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Cross_1_di" bpmnElement="Cross_1">
        <di:waypoint x="160" y="240" /><di:waypoint x="400" y="240" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** Whether `point` is on the outline of `box` (within a hair). */
function onOutline(point: { x: number; y: number }, box: SceneNode): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const withinX = point.x >= box.x - 0.5 && point.x <= box.x + box.width + 0.5;
  const withinY = point.y >= box.y - 0.5 && point.y <= box.y + box.height + 0.5;
  return (withinX && (near(point.y, box.y) || near(point.y, box.y + box.height)))
    || (withinY && (near(point.x, box.x) || near(point.x, box.x + box.width)));
}

test('collapsing docks a flow that reaches inside onto the sub-process itself', async () => {
  const loaded = await loadCanvas(CROSSING_XML);
  const { canvas, definitions } = loaded;
  const sub = node(canvas, 'Sub_X');
  const cross = canvas.getScene()!.elementsById.get('Cross_1') as any;
  const open = cross.waypoints.map((p: any) => ({ x: p.x, y: p.y }));

  canvas.setExpanded(sub, false);

  // The frame is now the plain activity box, and the flow ENDS ON IT — not at the
  // hidden inner task's parked coordinates, which is where it used to keep pointing.
  expect({ width: sub.width, height: sub.height }).toEqual(COLLAPSED_SUBPROCESS_SIZE);
  const docked = cross.waypoints[cross.waypoints.length - 1];
  expect(onOutline(docked, sub), `docked at ${docked.x},${docked.y}`).toBe(true);
  expect(cross.waypoints[0]).toEqual(open[0]);

  // The connection still NAMES the inner task — the document is untouched, which is
  // what makes the trip back lossless.
  expect(boOf(definitions, 'Cross_1').targetRef.id).toBe('Inner');
  // …and the new geometry is written through to the DI, so a reload draws it.
  const edgeDi = (definitions.diagrams[0].plane.planeElement ?? [])
    .find((pe: any) => pe.bpmnElement?.id === 'Cross_1');
  expect(edgeDi.waypoint.map((w: any) => ({ x: w.x, y: w.y })))
    .toEqual(cross.waypoints.map((p: any) => ({ x: p.x, y: p.y })));

  // Re-opening puts the shipped route back verbatim.
  canvas.setExpanded(sub, true);
  expect(cross.waypoints.map((p: any) => ({ x: p.x, y: p.y }))).toEqual(open);
});

test('a collapse+expand with a crossing flow still leaves the document byte-identical', async () => {
  const loaded = await loadCanvas(CROSSING_XML);
  const before = await toXML(loaded);

  const sub = node(loaded.canvas, 'Sub_X');
  loaded.canvas.setExpanded(sub, false);
  loaded.canvas.setExpanded(sub, true);

  expect(await toXML(loaded)).toBe(before);
});

test('dragging a COLLAPSED sub-process takes the flow that reaches inside it along', async () => {
  // The inner end is hidden, so nothing about the flow is docked to what moved — it
  // follows because the drag carries the container's descendants and re-routes their
  // edges, and the route lands on the frame (`visibleEndpointOf`).
  const { canvas } = await loadCanvas(CROSSING_XML, { snapToGrid: false });
  const sub = node(canvas, 'Sub_X');
  const cross = canvas.getScene()!.elementsById.get('Cross_1') as SceneEdge;
  canvas.setExpanded(sub, false);

  const from = { x: sub.x + sub.width / 2, y: sub.y + sub.height / 2 };
  const to = { x: from.x + 120, y: from.y + 160 };
  pointerDown(canvas, from);
  pointerMove(canvas, to);
  pointerUp(canvas, to);

  expect({ x: sub.x, y: sub.y }).toEqual({ x: 380, y: 260 });
  const docked = cross.waypoints[cross.waypoints.length - 1];
  expect(onOutline(docked, sub), `docked at ${docked.x},${docked.y}`).toBe(true);
});
