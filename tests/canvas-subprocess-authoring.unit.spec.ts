import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import { isDrillable, nestedPlaneOf, PlaneCursor, planeOf } from '@canvas/view/plane.ts';
import type { Scene, SceneNode } from '@canvas/model/scene.ts';

import { installDocument, loadCanvas, jsdomWindow } from './canvasHarness';

/**
 * AUTHORING a sub-process — the other half of the drill-down
 * (`scratchpad/subprocess-drilldown-spec.md` §1, verification finding "authoring a
 * sub-process is a dead end").
 *
 * `tests/canvas-plane.unit.spec.ts` proves the cursor NAVIGATES a document that
 * already carries a nested plane. This one proves the editor can MAKE one: before
 * this, dropping `Sub-process` from the palette emitted a lone
 * `<bpmn2:subProcess/>` whose `BPMNShape` carried no `isExpanded` and no diagram of
 * its own, so `model/expand.ts` read it as EXPANDED (a bare rounded rect: no ⊞
 * marker), `view/plane.ts isDrillable` said no (no nested plane, so no badge and no
 * double-click), and there was no way through the UI to put anything inside it.
 *
 * The contract is checked against `bpmn-moddle`'s `toXML`, never the scene:
 *
 * - a container created COLLAPSED writes `isExpanded="false"` AND mints its own
 *   `bpmndi:BPMNDiagram`/`BPMNPlane` pointing at it;
 * - everything created while the cursor is INSIDE that plane is filed in the
 *   sub-process's `flowElements` and in the nested plane's `planeElement` — not in
 *   the document root, where nothing on screen would have shown it;
 * - deleting the sub-process takes its diagram with it.
 */

const doc = installDocument();
const win = jsdomWindow();

/** A one-start-event process — the file the app itself opens on "new diagram". */
const BLANK = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="sample-diagram" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:process id="Study_1" isExecutable="true">
    <bpmn2:startEvent id="StartEvent_1" />
  </bpmn2:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Study_1">
      <bpmndi:BPMNShape id="_BPMNShape_StartEvent_1" bpmnElement="StartEvent_1">
        <dc:Bounds x="412" y="240" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn2:definitions>`;

interface Loaded {
  canvas: Canvas;
  scene: Scene;
  definitions: any;
  moddle: any;
  cursor: PlaneCursor;
}

async function load(): Promise<Loaded> {
  const { canvas, definitions, moddle } = await loadCanvas(BLANK);
  const scene = canvas.getScene()!;
  const layer = doc.createElementNS(
    'http://www.w3.org/2000/svg',
    'g',
  ) as unknown as SVGElement;
  canvas.getSvg().appendChild(layer);
  const cursor = new PlaneCursor({ canvas, layer: () => layer });
  return { canvas, scene, definitions, moddle, cursor };
}

async function toXML(loaded: Loaded): Promise<string> {
  const { xml } = await loaded.moddle.toXML(loaded.definitions);
  return xml;
}

/** Re-parse the serialized document, so every assertion is made on real XML. */
async function reparse(loaded: Loaded): Promise<Document> {
  const xml = await toXML(loaded);
  return new win.DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
}

function byTag(doc: Document, local: string): Element[] {
  return [...doc.getElementsByTagName('*')].filter((el) => el.localName === local);
}

/** The `bpmndi:BPMNPlane` whose `bpmnElement` is `id`, if the document has one. */
function planeFor(doc: Document, id: string): Element | undefined {
  return byTag(doc, 'BPMNPlane').find((plane) => plane.getAttribute('bpmnElement') === id);
}

/** Drop a collapsed sub-process the way `palette/commands.ts` does. */
function dropSubProcess(loaded: Loaded): SceneNode {
  const node = loaded.canvas.createElement(
    { type: 'bpmn:SubProcess', isExpanded: false },
    { x: 300, y: 400 },
  );
  if (!node) throw new Error('the rules refused a sub-process on the diagram root');
  return node;
}

test.describe('authoring a sub-process', () => {
  test('a palette-dropped sub-process is collapsed, carries a plane of its own, and drills', async () => {
    const loaded = await load();
    const sub = dropSubProcess(loaded);

    // The scene half: collapsed (so `render/renderer.ts` draws the ⊞ marker) and
    // drillable (so `view/plane.ts` draws the badge and the double click enters).
    expect(sub.isExpanded).toBe(false);
    expect(nestedPlaneOf(loaded.scene, sub)).toBeDefined();
    expect(isDrillable(loaded.scene, sub)).toBe(true);
    // A collapsed sub-process is a plain activity box, not an expanded frame.
    expect({ width: sub.width, height: sub.height }).toEqual({ width: 100, height: 80 });

    // The document half.
    const doc = await reparse(loaded);
    const shape = byTag(doc, 'BPMNShape').find((el) => el.getAttribute('bpmnElement') === sub.id);
    expect(shape?.getAttribute('isExpanded')).toBe('false');
    expect(byTag(doc, 'BPMNDiagram')).toHaveLength(2);
    expect(planeFor(doc, sub.id)).toBeDefined();
    // The new plane is empty and hangs off its own diagram, exactly as an authored
    // one does — nothing was moved into it.
    expect(planeFor(doc, sub.id)?.children).toHaveLength(0);
    expect(planeFor(doc, sub.id)?.parentElement?.localName).toBe('BPMNDiagram');
  });

  test('a shape created inside the plane is filed in the sub-process, not in the document root', async () => {
    const loaded = await load();
    const sub = dropSubProcess(loaded);

    expect(loaded.cursor.enterPlane(sub)).toBe(true);
    const task = loaded.canvas.createElement({ type: 'bpmn:Task' }, { x: 200, y: 200 });
    expect(task).toBeDefined();

    // Scene: the sub-process owns it, and it is drawn on the sub-process's plane.
    expect(task!.parent).toBe(sub);
    expect(planeOf(loaded.scene, task!)).toBe(nestedPlaneOf(loaded.scene, sub));

    // Document: business object under `subProcess`, DI under the nested plane.
    const doc = await reparse(loaded);
    const subProcess = byTag(doc, 'subProcess').find((el) => el.getAttribute('id') === sub.id);
    expect(subProcess?.querySelector(`[id="${task!.id}"]`)).toBeTruthy();
    const nested = planeFor(doc, sub.id);
    expect(
      [...(nested?.children ?? [])].map((el) => el.getAttribute('bpmnElement')),
    ).toEqual([task!.id]);
    // …and the ROOT plane never saw it.
    expect(planeFor(doc, 'Study_1')?.querySelector(`[bpmnElement="${task!.id}"]`)).toBeNull();
  });

  test('a connection drawn inside the plane files its `BPMNEdge` in that plane', async () => {
    const loaded = await load();
    const sub = dropSubProcess(loaded);
    loaded.cursor.enterPlane(sub);

    const from = loaded.canvas.createElement({ type: 'bpmn:Task' }, { x: 200, y: 200 })!;
    const to = loaded.canvas.createElement({ type: 'bpmn:Task' }, { x: 400, y: 200 })!;
    const edge = loaded.canvas.connectElements(from, to);
    expect(edge).toBeDefined();
    expect(planeOf(loaded.scene, edge!)).toBe(nestedPlaneOf(loaded.scene, sub));

    const doc = await reparse(loaded);
    const nested = planeFor(doc, sub.id);
    expect(
      [...(nested?.children ?? [])].map((el) => el.getAttribute('bpmnElement')),
    ).toEqual([from.id, to.id, edge!.id]);
    const flow = byTag(doc, 'sequenceFlow').find((el) => el.getAttribute('id') === edge!.id);
    expect(flow?.parentElement?.getAttribute('id')).toBe(sub.id);
  });

  test('leaving the plane hides what was authored there, and re-entering shows it again', async () => {
    const loaded = await load();
    const sub = dropSubProcess(loaded);
    loaded.cursor.enterPlane(sub);
    const task = loaded.canvas.createElement({ type: 'bpmn:Task' }, { x: 200, y: 200 })!;

    const drawn = (id: string): boolean => {
      const g = loaded.canvas.getGraphics(id);
      return !!g && g.getAttribute('display') !== 'none';
    };
    expect(drawn(task.id)).toBe(true);

    loaded.cursor.goToPlane(loaded.scene.rootPlane);
    // Back at the root the container is collapsed again and its contents are gone
    // from the screen — `expand.ts isHiddenByCollapse`, which needs the new node to
    // be PARENTED to the sub-process and not merely filed in its plane.
    expect(sub.isExpanded).toBe(false);
    expect(drawn(sub.id)).toBe(true);
    expect(drawn(task.id)).toBe(false);

    loaded.cursor.enterPlane(sub);
    expect(drawn(task.id)).toBe(true);
  });

  test('deleting the sub-process removes the diagram it minted', async () => {
    const loaded = await load();
    const sub = dropSubProcess(loaded);
    expect(byTag(await reparse(loaded), 'BPMNDiagram')).toHaveLength(2);

    loaded.canvas.deleteElements([sub]);

    const doc = await reparse(loaded);
    expect(byTag(doc, 'BPMNDiagram')).toHaveLength(1);
    expect(planeFor(doc, sub.id)).toBeUndefined();
    expect(byTag(doc, 'subProcess')).toHaveLength(0);
  });

  test('creating outside a drill-down still files in the document root', async () => {
    const loaded = await load();
    const task = loaded.canvas.createElement({ type: 'bpmn:Task' }, { x: 600, y: 240 })!;

    expect(task.parent).toBeUndefined();
    const doc = await reparse(loaded);
    expect(byTag(doc, 'BPMNDiagram')).toHaveLength(1);
    expect(
      planeFor(doc, 'Study_1')?.querySelector(`[bpmnElement="${task.id}"]`),
    ).toBeTruthy();
  });

  test('a shape added while EXPANDED is visible after a drill-down (empty nested plane falls back to the children)', async () => {
    const loaded = await load();
    const sub = dropSubProcess(loaded);
    loaded.canvas.setExpanded(sub, true);

    // Authored inline: the DI goes to the ROOT plane, the BO to the sub-process.
    const task = loaded.canvas.createElement(
      { type: 'bpmn:Task' },
      { x: sub.x + sub.width / 2, y: sub.y + sub.height / 2 },
    )!;
    expect(task.parent).toBe(sub);

    // Drilling down must show it — the sub-process's REAL plane is still empty, so
    // the trip goes to the synthesized scope over the children instead.
    expect(loaded.cursor.enterPlane(sub)).toBe(true);
    const g = loaded.canvas.getGraphics(task.id);
    expect(!!g && g.getAttribute('display') !== 'none').toBe(true);
  });

  test('collapsing files inline-authored contents into the nested plane', async () => {
    const loaded = await load();
    const sub = dropSubProcess(loaded);
    loaded.canvas.setExpanded(sub, true);
    const task = loaded.canvas.createElement(
      { type: 'bpmn:Task' },
      { x: sub.x + sub.width / 2, y: sub.y + sub.height / 2 },
    )!;

    loaded.canvas.setExpanded(sub, false);

    // Document: the task's BPMNShape now lives in the sub-process's own plane,
    // and the root plane no longer lists it.
    const doc = await reparse(loaded);
    expect(planeFor(doc, sub.id)?.querySelector(`[bpmnElement="${task.id}"]`)).toBeTruthy();
    expect(planeFor(doc, 'Study_1')?.querySelector(`[bpmnElement="${task.id}"]`)).toBeNull();

    // Drill-down now opens the real plane and finds the task.
    expect(loaded.cursor.enterPlane(sub)).toBe(true);
    expect(planeOf(loaded.scene, task)).toBe(nestedPlaneOf(loaded.scene, sub));
    const g = loaded.canvas.getGraphics(task.id);
    expect(!!g && g.getAttribute('display') !== 'none').toBe(true);
  });
});
