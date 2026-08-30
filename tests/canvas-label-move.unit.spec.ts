import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import type { SceneEdge, SceneNode } from '@canvas/model/scene.ts';

import { dragBy, freshModdle, jsdomWindow, loadCanvas, pointerDown, pointerMove, pointerUp, type Loaded } from './canvasHarness';

/**
 * Dragging an external LABEL (parity spec addendum 3 §2/§5, `edge-videos/labels`).
 *
 * A caption is its own element (`model/externalLabel.ts`) and, from this batch, its
 * own gesture: it travels ALONE. The contract the whole file exists to pin down is
 * the write half — moving a caption writes its `bpmndi:BPMNLabel/dc:Bounds` and
 * NOTHING else, so the owner's `dc:Bounds` and `di:waypoint` come out of a
 * move→save→reload byte-identical to how they went in.
 *
 * Same jsdom harness as `canvas-drag`: no layout engine, so screen↔diagram is 1:1
 * and every event's client coordinates are computed through `viewport.toScreen`.
 */

const win = jsdomWindow();

/**
 * A named flow whose caption the document POSITIONS (`bpmndi:BPMNLabel`), plus a
 * named end event whose caption it does not — the two halves of the feature: moving
 * a label that already has bounds, and minting bounds for one that has none.
 */
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:endEvent id="End_1" name="Done" />
    <bpmn:sequenceFlow id="Flow_1" name="ship" sourceRef="Start_1" targetRef="Task_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="300" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="600" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="300" y="120" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="200" y="80" width="30" height="15" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(options: { snapToGrid?: boolean } = {}): Promise<Loaded> {
  return loadCanvas(FIXTURE_XML, { snapToGrid: false, ...options });
}

// --- DI readers (walk the live moddle tree, never the scene) ------------------

function planeElement(definitions: any, id: string): any {
  for (const diagram of definitions.diagrams ?? []) {
    for (const pe of diagram.plane?.planeElement ?? []) {
      if (pe.bpmnElement?.id === id) return pe;
    }
  }
  return undefined;
}

function diBounds(definitions: any, id: string): any {
  const bounds = planeElement(definitions, id)?.bounds;
  return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : undefined;
}

function diLabelBounds(definitions: any, id: string): any {
  const bounds = planeElement(definitions, id)?.label?.bounds;
  return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : undefined;
}

function diWaypoints(definitions: any, id: string): { x: number; y: number }[] {
  return (planeElement(definitions, id)?.waypoint ?? []).map((w: any) => ({ x: w.x, y: w.y }));
}

// --- pointer helpers ---------------------------------------------------------

interface Pt { x: number; y: number; }

function dragThenEscape(canvas: Canvas, from: Pt, to: Pt): void {
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  pointerDown(canvas, from);
  pointerMove(canvas, to);
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  pointerUp(canvas, to);
}

function elementOf(canvas: Canvas, id: string): any {
  return canvas.getScene()!.elementsById.get(id)!;
}

/** The synthetic caption element of `id`, and the point at its centre. */
function labelOf(canvas: Canvas, id: string): SceneNode {
  const label = canvas.labelFor(elementOf(canvas, id));
  if (!label) throw new Error(`no external label for ${id}`);
  return label;
}

function centre(box: { x: number; y: number; width: number; height: number }): Pt {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// --- the write contract ------------------------------------------------------

test('dragging an edge caption writes only its BPMNLabel bounds', async () => {
  const { canvas, definitions } = await load();
  const before = { ...labelOf(canvas, 'Flow_1') };
  const shapeBefore = diBounds(definitions, 'Start_1');
  const waypointsBefore = diWaypoints(definitions, 'Flow_1');

  dragBy(canvas, centre(before), { x: centre(before).x + 40, y: centre(before).y - 30 });

  const written = diLabelBounds(definitions, 'Flow_1');
  expect(written.x).toBeCloseTo(before.x + 40, 6);
  expect(written.y).toBeCloseTo(before.y - 30, 6);
  // …and nothing else moved: not the shapes, not the route.
  expect(diBounds(definitions, 'Start_1')).toEqual(shapeBefore);
  expect(diBounds(definitions, 'Task_1')).toEqual({ x: 300, y: 80, width: 100, height: 80 });
  expect(diWaypoints(definitions, 'Flow_1')).toEqual(waypointsBefore);
});

test('a moved caption round-trips through bpmn-moddle', async () => {
  const loaded = await load();
  const { canvas, definitions, moddle } = loaded;
  const before = { ...labelOf(canvas, 'Flow_1') };

  dragBy(canvas, centre(before), { x: centre(before).x - 25, y: centre(before).y + 60 });
  const moved = diLabelBounds(definitions, 'Flow_1');

  const { xml } = await moddle.toXML(definitions);
  expect(xml).toContain('bpmndi:BPMNLabel');
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);

  const reread = diLabelBounds(reloaded, 'Flow_1');
  expect(reread.x).toBeCloseTo(moved.x, 6);
  expect(reread.y).toBeCloseTo(moved.y, 6);
  // The owner survived the round trip untouched — the point of writing the label
  // alone (parity spec addendum 3 §5).
  expect(diWaypoints(reloaded, 'Flow_1')).toEqual([{ x: 136, y: 118 }, { x: 300, y: 120 }]);
  expect(diBounds(reloaded, 'Task_1')).toEqual({ x: 300, y: 80, width: 100, height: 80 });
});

test('a dragged caption snaps onto a neighbouring shape centre', async () => {
  const { canvas } = await load();
  const task = elementOf(canvas, 'Task_1') as SceneNode;
  const target = centre(task);
  const before = { ...labelOf(canvas, 'Flow_1') };
  const from = centre(before);

  // Land the caption's CENTRE 5 units right and 4 below the task's centre — inside
  // diagram-js's 7-unit tolerance on both axes.
  dragBy(canvas, from, { x: target.x + 5, y: target.y + 4 });

  const after = labelOf(canvas, 'Flow_1');
  expect(centre(after).x).toBeCloseTo(target.x, 6);
  expect(centre(after).y).toBeCloseTo(target.y, 6);
});

test('dragging an unpositioned caption mints the BPMNLabel it never had', async () => {
  const { canvas, definitions } = await load();
  expect(planeElement(definitions, 'End_1').label).toBeUndefined();
  const before = { ...labelOf(canvas, 'End_1') };

  dragBy(canvas, centre(before), { x: centre(before).x + 70, y: centre(before).y + 20 });

  const written = diLabelBounds(definitions, 'End_1');
  expect(written).toBeDefined();
  expect(written.x).toBeCloseTo(before.x + 70, 6);
  expect(written.y).toBeCloseTo(before.y + 20, 6);
  // The event itself did not budge.
  expect(diBounds(definitions, 'End_1')).toEqual({ x: 600, y: 100, width: 36, height: 36 });
});

test('an abandoned first caption drag leaves the document without a BPMNLabel', async () => {
  const { canvas, definitions } = await load();
  const scene = canvas.getScene()!;
  const revision = scene.revision;
  const owner = elementOf(canvas, 'End_1') as SceneNode;
  const before = { ...labelOf(canvas, 'End_1') };

  dragThenEscape(canvas, centre(before), { x: centre(before).x + 70, y: centre(before).y + 20 });

  expect(planeElement(definitions, 'End_1').label).toBeUndefined();
  // …and the scene-side label the gesture invented went with it, so the caption is
  // derived from its owner again.
  expect(owner.label).toBeUndefined();
  expect(scene.revision).toBe(revision);
  const after = labelOf(canvas, 'End_1');
  expect(after.x).toBeCloseTo(before.x, 6);
  expect(after.y).toBeCloseTo(before.y, 6);
});

test('a caption drag leaves the edge it names selectable and unmoved in the scene', async () => {
  const { canvas } = await load();
  const flow = elementOf(canvas, 'Flow_1') as SceneEdge;
  const waypoints = flow.waypoints.map((p) => ({ x: p.x, y: p.y }));
  const before = { ...labelOf(canvas, 'Flow_1') };

  dragBy(canvas, centre(before), { x: centre(before).x, y: centre(before).y - 45 });

  expect(flow.waypoints).toEqual(waypoints);
  // The caption, not the flow, is what the gesture selected.
  expect(canvas.getSelection().get().map((e) => e.id)).toEqual(['Flow_1_label']);
});
