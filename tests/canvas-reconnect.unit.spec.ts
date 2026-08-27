import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, isOrthogonal, setDocument } from '@canvas/index.ts';
import type { Point, SceneEdge, SceneNode } from '@canvas/model/scene.ts';

import { loadSchemaModels } from './schemas';

/**
 * Endpoint drags — parity spec §1 ("drag an ENDPOINT handle → reconnect/re-dock")
 * and §4 (cropping). Three outcomes, and which one a drop gets is decided by what
 * is under it:
 *
 * - a shape the rules accept → the connection is rewired AND the moved end docks
 *   where the pointer let go, on the side the route arrives from, cropped to the
 *   outline (not at the centre-anchored default the router alone would give);
 * - a shape the rules refuse → nothing at all (the ∅ cursor was already saying so);
 * - empty space → P3's free endpoint move, which is how an edge is bent by its tip.
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

/**
 * `Start_1 → Task_1`, with `Task_2` off to the right as the reconnect candidate and
 * a second START event as the one the rules must refuse (nothing may flow INTO a
 * start event).
 */
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="One"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:task id="Task_2" name="Two" />
    <bpmn:startEvent id="Start_2" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="400" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_2_di" bpmnElement="Start_2">
        <dc:Bounds x="600" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="200" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

interface Loaded {
  canvas: Canvas;
  definitions: any;
  moddle: any;
}

async function load(xml = FIXTURE_XML): Promise<Loaded> {
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(xml);
  const canvas = new Canvas();
  canvas.importDefinitions(definitions);
  return { canvas, definitions, moddle };
}

function process(definitions: any): any {
  return definitions.rootElements.find((el: any) => el.id === 'Process_1');
}

function flowElement(definitions: any, id: string): any {
  return process(definitions).flowElements.find((el: any) => el.id === id);
}

function diEdge(definitions: any, id: string): any {
  for (const diagram of definitions.diagrams ?? []) {
    for (const pe of diagram.plane?.planeElement ?? []) {
      if (pe.$type === 'bpmndi:BPMNEdge' && pe.bpmnElement?.id === id) return pe;
    }
  }
  return undefined;
}

function diWaypoints(definitions: any, id: string): Point[] {
  return (diEdge(definitions, id)?.waypoint ?? []).map((w: any) => ({ x: w.x, y: w.y }));
}

function edge(canvas: Canvas, id: string): SceneEdge {
  return canvas.getScene()!.elementsById.get(id) as SceneEdge;
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function last(edge: SceneEdge): Point {
  return edge.waypoints[edge.waypoints.length - 1];
}

// --- pointer helpers ---------------------------------------------------------

function firePointer(canvas: Canvas, target: EventTarget, type: string, diagram: Point): void {
  const screen = canvas.getViewport().toScreen(diagram);
  target.dispatchEvent(new dom.window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: screen.x,
    clientY: screen.y,
    button: 0,
  }));
}

/** Select `flow`, grab its LAST waypoint and drop it at `to`. */
function dragTargetEnd(canvas: Canvas, flow: SceneEdge, to: Point): void {
  canvas.getSelection().select(flow);
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const grab = { ...last(flow) };
  firePointer(canvas, svg, 'pointerdown', grab);
  firePointer(canvas, doc, 'pointermove', to);
  firePointer(canvas, doc, 'pointerup', to);
}

// --- an accepted target ------------------------------------------------------

test('dragging the target endpoint onto another task reconnects, re-docks where it was dropped and crops to the outline', async () => {
  const loaded = await load();
  const { canvas, definitions } = loaded;
  const flow = edge(canvas, 'Flow_1');
  const target = node(canvas, 'Task_2');

  // Dropped low inside Task_2 — well below the centre line the router would have
  // anchored the edge to.
  dragTargetEnd(canvas, flow, { x: 450, y: 155 });

  // Rewired, in the scene AND in the live moddle tree.
  expect(flow.target?.id).toBe('Task_2');
  expect(flowElement(definitions, 'Flow_1').targetRef.id).toBe('Task_2');
  expect(flowElement(definitions, 'Task_2').incoming?.map((f: any) => f.id)).toEqual(['Flow_1']);

  // Docked on the side the route arrives from (the left flank), at the height it
  // was dropped at — held one inset off the corner — and cropped to the outline.
  expect(last(flow)).toEqual({ x: target.x, y: 154 });
  expect(isOrthogonal(flow.waypoints)).toBe(true);
  // The source end is untouched and still on the start event's circle.
  expect(flow.waypoints[0].x).toBeCloseTo(136, 0);
});

test('the reconnected geometry is written to di:waypoint and round-trips through bpmn-moddle', async () => {
  const loaded = await load();
  const { canvas, definitions, moddle } = loaded;
  const flow = edge(canvas, 'Flow_1');

  dragTargetEnd(canvas, flow, { x: 450, y: 155 });

  const written = diWaypoints(definitions, 'Flow_1');
  expect(written).toEqual(flow.waypoints.map((p) => ({ x: p.x, y: p.y })));

  const { xml } = await moddle.toXML(definitions);
  expect(xml).toContain('targetRef="Task_2"');
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  expect(diWaypoints(reloaded, 'Flow_1')).toEqual(written);
  expect(flowElement(reloaded, 'Flow_1').targetRef.id).toBe('Task_2');
});

// --- a refused target --------------------------------------------------------

test('a rules-refused target leaves the edge untouched', async () => {
  const loaded = await load();
  const { canvas, definitions } = loaded;
  const flow = edge(canvas, 'Flow_1');
  const before = flow.waypoints.map((p) => ({ ...p }));
  const revision = canvas.getScene()!.revision;

  // A start event takes no incoming flow.
  dragTargetEnd(canvas, flow, { x: 618, y: 118 });

  expect(flow.target?.id).toBe('Task_1');
  expect(flow.waypoints).toEqual(before);
  expect(diWaypoints(definitions, 'Flow_1')).toEqual(before);
  expect(flowElement(definitions, 'Flow_1').targetRef.id).toBe('Task_1');
  expect(canvas.getScene()!.revision).toBe(revision);
});

// --- empty space -------------------------------------------------------------

test('dropped on empty space the endpoint free-moves, squarely', async () => {
  const loaded = await load();
  const { canvas, definitions } = loaded;
  const flow = edge(canvas, 'Flow_1');

  dragTargetEnd(canvas, flow, { x: 300, y: 320 });

  // Still docked to Task_1 as a MODEL, but its tip now sits where it was dropped.
  expect(flow.target?.id).toBe('Task_1');
  expect(last(flow).x).toBeCloseTo(300, 3);
  expect(last(flow).y).toBeCloseTo(320, 3);

  // …and the ROUTE to it is square. Parity spec §1 says the endpoint free-moves and
  // §4 says every resulting segment is axis-aligned; both hold, because the free move
  // reaches the drop through an elbow instead of a diagonal. Reading §1 as licence to
  // leave a diagonal terminal segment is what left the renderer splicing a corner arc
  // onto a corner that was not one.
  expect(isOrthogonal(flow.waypoints)).toBe(true);
  expect(flow.waypoints).toHaveLength(3);
  // The edge still LEAVES its source the way it left it — horizontally, off the start
  // event's flank — and turns out at the drop rather than the moment it undocks.
  expect(flow.waypoints[1]).toEqual({ x: 300, y: 118 });

  const written = diWaypoints(definitions, 'Flow_1');
  expect(written).toEqual(flow.waypoints);
});

test('an endpoint dragged along its own run leaves no elbow behind', async () => {
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_1');
  // Snapping off so the drop lands on the run's own `y` exactly rather than on the
  // nearest grid line — which is also the setting the app now exposes.
  canvas.setSnapToGrid(false);

  // Straight out along the run it already had: there is no turn to make, so the path
  // stays the two-point edge it was rather than growing a redundant joint.
  dragTargetEnd(canvas, flow, { x: 360, y: 118 });

  expect(flow.waypoints).toHaveLength(2);
  expect(last(flow)).toEqual({ x: 360, y: 118 });
  expect(isOrthogonal(flow.waypoints)).toBe(true);
});

// --- the programmatic path ---------------------------------------------------

test('reconnectElement without a drop point keeps the plain centre-anchored route', async () => {
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_1');
  const target = node(canvas, 'Task_2');

  expect(canvas.reconnectElement(flow, 'target', target)).toBe(true);
  expect(flow.target?.id).toBe('Task_2');
  expect(last(flow).x).toBe(target.x);
  expect(isOrthogonal(flow.waypoints)).toBe(true);
});
