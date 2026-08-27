import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, isOrthogonal, setDocument } from '@canvas/index.ts';
import type { Point, SceneEdge, SceneNode } from '@canvas/model/scene.ts';
import type { ElementsChangedEvent } from '@canvas/model/writeback.ts';

import { loadSchemaModels } from './schemas';

/**
 * P4 connect + reconnect gestures (design §3 `interaction/connect.ts`, §1 "add edge").
 *
 * The contract: an accepted connection mints BOTH halves into the LIVE moddle tree —
 * the flow business object (`sourceRef`/`targetRef`, plus `outgoing`/`incoming` on
 * the endpoints for a sequence flow) into its container, and a `bpmndi:BPMNEdge`
 * carrying the router's orthogonal, outline-cropped `di:waypoint` list into the
 * plane — so re-serializing that same `Definitions` emits the new flow and its
 * geometry, references and all. A vetoed pair writes nothing; a reconnect rewrites
 * the refs on both sides and re-routes.
 *
 * jsdom via `setDocument`, same setup as the other `canvas-*` specs.
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

// --- fixtures ----------------------------------------------------------------

/**
 * `Start_1 → Task_1`, plus an unconnected `Task_2` and `End_1` and a text
 * annotation. Round numbers, and `Task_1`/`Task_2` share a centre line so the
 * router's straight case gives exact waypoints.
 */
const PROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="One"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:task id="Task_2" name="Two" />
    <bpmn:endEvent id="End_1" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:textAnnotation id="Note_1"><bpmn:text>note</bpmn:text></bpmn:textAnnotation>
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
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="600" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Note_1_di" bpmnElement="Note_1">
        <dc:Bounds x="200" y="300" width="100" height="30" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="200" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** Two pools, one task each — the message-flow case. */
const POOLS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_2" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_A" name="A" processRef="Process_A" />
    <bpmn:participant id="Pool_B" name="B" processRef="Process_B" />
  </bpmn:collaboration>
  <bpmn:process id="Process_A" isExecutable="false"><bpmn:task id="Task_A" /></bpmn:process>
  <bpmn:process id="Process_B" isExecutable="false"><bpmn:task id="Task_B" /></bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_2">
    <bpmndi:BPMNPlane id="Plane_2" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_A_di" bpmnElement="Pool_A" isHorizontal="true">
        <dc:Bounds x="100" y="100" width="600" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Pool_B_di" bpmnElement="Pool_B" isHorizontal="true">
        <dc:Bounds x="100" y="400" width="600" height="200" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_A_di" bpmnElement="Task_A">
        <dc:Bounds x="300" y="140" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_B_di" bpmnElement="Task_B">
        <dc:Bounds x="300" y="440" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

interface Loaded {
  canvas: Canvas;
  definitions: any;
  moddle: any;
}

async function load(xml = PROCESS_XML): Promise<Loaded> {
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(xml);
  const canvas = new Canvas();
  canvas.importDefinitions(definitions);
  return { canvas, definitions, moddle };
}

// --- live-tree readers -------------------------------------------------------

function process(definitions: any, id = 'Process_1'): any {
  return definitions.rootElements.find((el: any) => el.id === id);
}

function planeElements(definitions: any): any[] {
  return definitions.diagrams[0].plane.planeElement ?? [];
}

function diEdge(definitions: any, id: string): any {
  return planeElements(definitions)
    .find((pe: any) => pe.$type === 'bpmndi:BPMNEdge' && pe.bpmnElement?.id === id);
}

function diWaypoints(definitions: any, id: string): Point[] {
  return (diEdge(definitions, id)?.waypoint ?? []).map((w: any) => ({ x: w.x, y: w.y }));
}

function flowElement(definitions: any, id: string, processId = 'Process_1'): any {
  return process(definitions, processId).flowElements.find((el: any) => el.id === id);
}

async function roundTrip(loaded: Loaded): Promise<{ xml: string; reloaded: any }> {
  const { xml } = await loaded.moddle.toXML(loaded.definitions);
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  return { xml, reloaded };
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

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function edge(canvas: Canvas, id: string): SceneEdge {
  return canvas.getScene()!.elementsById.get(id) as SceneEdge;
}

function center(shape: SceneNode): Point {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

// --- connect -----------------------------------------------------------------

test('connecting two tasks mints the SequenceFlow BO + BPMNEdge, and toXML emits both', async () => {
  const loaded = await load();
  const { canvas, definitions } = loaded;
  const scene = canvas.getScene()!;
  const one = node(canvas, 'Task_1');
  const two = node(canvas, 'Task_2');
  const batches: string[][] = [];
  canvas.getEventBus().on<ElementsChangedEvent>('elements.changed', (e) => {
    batches.push(e.elements.map((el) => el.id));
  });
  const revision = scene.revision;

  const flow = canvas.connectElements(one, two);
  expect(flow).toBeDefined();
  const created = flow!;

  // Scene: wired both ways, selected, drawn.
  expect(created.type).toBe('bpmn:SequenceFlow');
  expect(created.id).toMatch(/^SequenceFlow_/);
  expect(created.source).toBe(one);
  expect(created.target).toBe(two);
  expect(one.outgoing).toContain(created);
  expect(two.incoming).toContain(created);
  expect(scene.elementsById.get(created.id)).toBe(created);
  expect(scene.revision).toBeGreaterThan(revision);
  expect(batches).toEqual([[created.id, 'Task_1', 'Task_2']]);
  expect(canvas.getSelection().get()).toEqual([created]);
  expect(canvas.getGraphics(created.id)).toBeDefined();

  // Waypoints: orthogonal and cropped to both outlines (right edge → left edge).
  expect(isOrthogonal(created.waypoints)).toBe(true);
  expect(created.waypoints).toEqual([{ x: 300, y: 120 }, { x: 400, y: 120 }]);

  // Business object: filed in the process, refs both ways.
  const bo: any = created.businessObject;
  expect(flowElement(definitions, created.id)).toBe(bo);
  expect(bo.sourceRef).toBe(one.businessObject);
  expect(bo.targetRef).toBe(two.businessObject);
  expect((one.businessObject as any).outgoing).toContain(bo);
  expect((two.businessObject as any).incoming).toContain(bo);
  expect(bo.$parent).toBe(process(definitions));

  // DI: a BPMNEdge carrying the routed waypoints.
  expect(diEdge(definitions, created.id)).toBe(created.di);
  expect(diWaypoints(definitions, created.id)).toEqual(created.waypoints);

  // …and serializing THIS tree emits flow, refs and waypoints.
  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain(`<bpmn:sequenceFlow id="${created.id}" sourceRef="Task_1" targetRef="Task_2"`);
  const reloadedBo = flowElement(reloaded, created.id);
  expect(reloadedBo.sourceRef.id).toBe('Task_1');
  expect(reloadedBo.targetRef.id).toBe('Task_2');
  expect(flowElement(reloaded, 'Task_1').outgoing.map((f: any) => f.id)).toEqual([created.id]);
  expect(flowElement(reloaded, 'Task_2').incoming.map((f: any) => f.id)).toEqual([created.id]);
  expect(diWaypoints(reloaded, created.id)).toEqual([{ x: 300, y: 120 }, { x: 400, y: 120 }]);
});

test('a vetoed pair writes nothing at all', async () => {
  const { canvas, definitions } = await load();
  const scene = canvas.getScene()!;
  const start = node(canvas, 'Start_1');
  const one = node(canvas, 'Task_1');
  const end = node(canvas, 'End_1');
  const flowElements = process(definitions).flowElements.length;
  const planeCount = planeElements(definitions).length;
  const revision = scene.revision;

  // Nothing flows OUT of an end event, nothing flows INTO a start event, and a
  // node does not connect to itself.
  expect(canvas.connectElements(end, one)).toBeUndefined();
  expect(canvas.connectElements(one, start)).toBeUndefined();
  expect(canvas.connectElements(one, one)).toBeUndefined();

  expect(process(definitions).flowElements.length).toBe(flowElements);
  expect(planeElements(definitions).length).toBe(planeCount);
  expect(scene.revision).toBe(revision);
  expect(one.outgoing).toEqual([]);
});

test('an artifact endpoint becomes an Association, filed under `artifacts`', async () => {
  const { canvas, definitions } = await load();
  const one = node(canvas, 'Task_1');
  const note = node(canvas, 'Note_1');

  const association = canvas.connectElements(one, note);
  expect(association).toBeDefined();
  expect(association!.type).toBe('bpmn:Association');

  const bo: any = association!.businessObject;
  expect(process(definitions).artifacts).toContain(bo);
  expect(bo.sourceRef).toBe(one.businessObject);
  expect(bo.targetRef).toBe(note.businessObject);
  // `outgoing`/`incoming` are typed `bpmn:SequenceFlow` in the schema, so an
  // association is deliberately NOT pushed onto them…
  expect((one.businessObject as any).outgoing ?? []).not.toContain(bo);
  // …while the SCENE always wires both ends, which is what routing reads.
  expect(one.outgoing).toContain(association);
  expect(note.incoming).toContain(association);
});

test('crossing a pool boundary mints a MessageFlow into the collaboration', async () => {
  const loaded = await load(POOLS_XML);
  const { canvas, definitions } = loaded;
  const a = node(canvas, 'Task_A');
  const b = node(canvas, 'Task_B');

  const message = canvas.connectElements(a, b);
  expect(message).toBeDefined();
  expect(message!.type).toBe('bpmn:MessageFlow');

  const collaboration = definitions.rootElements.find((el: any) => el.$type === 'bpmn:Collaboration');
  expect(collaboration.messageFlows).toContain(message!.businessObject);
  expect(process(definitions, 'Process_A').flowElements).not.toContain(message!.businessObject);

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain('bpmn:messageFlow');
  const reloadedCollab = reloaded.rootElements.find((el: any) => el.$type === 'bpmn:Collaboration');
  expect(reloadedCollab.messageFlows[0].sourceRef.id).toBe('Task_A');
  expect(reloadedCollab.messageFlows[0].targetRef.id).toBe('Task_B');
  expect(diWaypoints(reloaded, message!.id).length).toBeGreaterThanOrEqual(2);
});

test('startConnect drags a rubber band and drops a flow on the hovered target', async () => {
  const { canvas, definitions } = await load();
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const one = node(canvas, 'Task_1');
  const two = node(canvas, 'Task_2');

  expect(canvas.startConnect(one)).toBe(true);
  expect(canvas.getConnect().getKind()).toBe('connect');

  // Over empty space: the preview shows the pair is not (yet) connectable.
  firePointer(canvas, doc, 'pointermove', { x: 350, y: 400 });
  const preview = svg.querySelector('.sf-connect-preview');
  expect(preview).not.toBeNull();
  expect(preview!.getAttribute('data-allowed')).toBe('false');
  // …and the canvas wears the verdict, which is what puts the ∅ under the cursor
  // (parity spec §5, `edge-videos/v2/frame_02`; the rule is in `view/theme.ts`).
  expect(svg.getAttribute('data-connect-status')).toBe('pending');

  // Over the target: allowed, and the preview is already the routed path.
  firePointer(canvas, doc, 'pointermove', center(two));
  expect(svg.querySelector('.sf-connect-preview')!.getAttribute('data-allowed')).toBe('true');
  // The preview is a rounded PATH like the edge it previews; its raw geometry is
  // kept alongside it (`render/renderer.ts roundedPathData`).
  expect(svg.querySelector('.sf-connect-preview')!.firstElementChild!.getAttribute('data-waypoints'))
    .toBe('300,120 400,120');

  firePointer(canvas, doc, 'pointerup', center(two));
  expect(canvas.getConnect().isActive()).toBe(false);
  expect(svg.querySelector('.sf-connect-preview')).toBeNull();
  expect(svg.getAttribute('data-connect-status')).toBeNull();

  const created = canvas.getSelection().get()[0] as SceneEdge;
  expect(created.kind).toBe('edge');
  expect(created.source).toBe(one);
  expect(created.target).toBe(two);
  expect(flowElement(definitions, created.id)).toBe(created.businessObject);
  expect(canvas.getGraphics(created.id)).toBeDefined();
});

test('dropping a connect gesture on empty space (or a vetoed target) creates nothing', async () => {
  const { canvas, definitions } = await load();
  const doc = canvas.getSvg().ownerDocument!;
  const one = node(canvas, 'Task_1');
  const start = node(canvas, 'Start_1');
  const before = process(definitions).flowElements.length;

  canvas.startConnect(one);
  firePointer(canvas, doc, 'pointerup', { x: 350, y: 500 });
  expect(process(definitions).flowElements.length).toBe(before);

  // A start event is never a target.
  canvas.startConnect(one);
  firePointer(canvas, doc, 'pointermove', center(start));
  expect(canvas.getSvg().querySelector('.sf-connect-preview')!.getAttribute('data-allowed')).toBe('false');
  firePointer(canvas, doc, 'pointerup', center(start));
  expect(process(definitions).flowElements.length).toBe(before);
  expect(one.outgoing).toEqual([]);
});

// --- reconnect ---------------------------------------------------------------

test('reconnect rewrites sourceRef/targetRef on both sides and re-routes', async () => {
  const loaded = await load();
  const { canvas, definitions } = loaded;
  const flow = edge(canvas, 'Flow_1');
  const one = node(canvas, 'Task_1');
  const two = node(canvas, 'Task_2');
  const start = node(canvas, 'Start_1');
  const revision = canvas.getScene()!.revision;

  expect(canvas.reconnectElement(flow, 'target', two)).toBe(true);

  // Scene: moved from Task_1 to Task_2.
  expect(flow.target).toBe(two);
  expect(flow.source).toBe(start);
  expect(two.incoming).toContain(flow);
  expect(one.incoming).not.toContain(flow);
  expect(canvas.getScene()!.revision).toBeGreaterThan(revision);

  // Business object: refs rewritten on the flow AND on both endpoints.
  const bo: any = flow.businessObject;
  expect(bo.targetRef.id).toBe('Task_2');
  expect(bo.sourceRef.id).toBe('Start_1');
  expect((two.businessObject as any).incoming).toContain(bo);
  expect((one.businessObject as any).incoming ?? []).not.toContain(bo);

  // Re-routed and written through to the DI: Start_1's circle → Task_2's left edge.
  expect(isOrthogonal(flow.waypoints)).toBe(true);
  expect(flow.waypoints).toHaveLength(2);
  // The start end sits ON the event's r=18 circle, the far end on Task_2's left edge.
  expect(Math.hypot(flow.waypoints[0].x - 118, flow.waypoints[0].y - 118)).toBeCloseTo(18, 6);
  expect(flow.waypoints[0].y).toBe(119);
  expect(flow.waypoints[1]).toEqual({ x: 400, y: 119 });
  expect(diWaypoints(definitions, 'Flow_1')).toEqual(flow.waypoints);

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain('sourceRef="Start_1" targetRef="Task_2"');
  expect(flowElement(reloaded, 'Flow_1').targetRef.id).toBe('Task_2');
  expect(flowElement(reloaded, 'Task_2').incoming.map((f: any) => f.id)).toEqual(['Flow_1']);
  expect(flowElement(reloaded, 'Task_1').incoming).toBeUndefined();
  expect(diWaypoints(reloaded, 'Flow_1')).toEqual(flow.waypoints);
});

test('reconnecting the source end swaps `outgoing` over', async () => {
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_1');
  const start = node(canvas, 'Start_1');
  const two = node(canvas, 'Task_2');

  expect(canvas.reconnectElement(flow, 'source', two)).toBe(true);
  expect(flow.source).toBe(two);
  expect(start.outgoing).not.toContain(flow);
  expect(two.outgoing).toContain(flow);
  expect((flow.businessObject as any).sourceRef.id).toBe('Task_2');
  expect((start.businessObject as any).outgoing).toEqual([]);
  expect((two.businessObject as any).outgoing).toContain(flow.businessObject);
});

test('a vetoed reconnect changes nothing', async () => {
  const { canvas, definitions } = await load();
  const flow = edge(canvas, 'Flow_1');
  const start = node(canvas, 'Start_1');
  const one = node(canvas, 'Task_1');
  const before = flow.waypoints.map((p) => ({ ...p }));
  const revision = canvas.getScene()!.revision;

  // A start event is never a flow target…
  expect(canvas.reconnectElement(flow, 'target', start)).toBe(false);
  // …and an end event is never a source.
  expect(canvas.reconnectElement(flow, 'source', node(canvas, 'End_1'))).toBe(false);

  expect(flow.target).toBe(one);
  expect(flow.source).toBe(start);
  expect((flow.businessObject as any).targetRef.id).toBe('Task_1');
  expect(flow.waypoints).toEqual(before);
  expect(diWaypoints(definitions, 'Flow_1')).toEqual(before);
  expect(canvas.getScene()!.revision).toBe(revision);
});

test('dragging a selected edge\'s endpoint handle reconnects it', async () => {
  const { canvas, definitions } = await load();
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const flow = edge(canvas, 'Flow_1');
  const two = node(canvas, 'Task_2');

  // The endpoint handles only exist on a selected edge.
  canvas.getSelection().select(flow);
  const endpoint = flow.waypoints[flow.waypoints.length - 1];

  firePointer(canvas, svg, 'pointerdown', endpoint);
  firePointer(canvas, doc, 'pointermove', center(two));
  expect(canvas.getConnect().getKind()).toBe('reconnect');
  expect(svg.querySelector('.sf-connect-preview')!.getAttribute('data-allowed')).toBe('true');

  firePointer(canvas, doc, 'pointerup', center(two));
  expect(svg.querySelector('.sf-connect-preview')).toBeNull();
  expect(flow.target).toBe(two);
  expect((flow.businessObject as any).targetRef.id).toBe('Task_2');
  expect(diWaypoints(definitions, 'Flow_1')).toEqual(flow.waypoints);
});

test('an endpoint dropped on open space keeps P3\'s free waypoint move', async () => {
  const { canvas, definitions } = await load();
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const flow = edge(canvas, 'Flow_1');
  const one = node(canvas, 'Task_1');

  canvas.getSelection().select(flow);
  const endpoint = flow.waypoints[flow.waypoints.length - 1];
  firePointer(canvas, svg, 'pointerdown', endpoint);
  firePointer(canvas, doc, 'pointermove', { x: 250, y: 400 });
  expect(svg.querySelector('.sf-connect-preview')!.getAttribute('data-allowed')).toBe('false');
  firePointer(canvas, doc, 'pointerup', { x: 250, y: 400 });

  // No shape took the endpoint, so the refs are untouched and the TIP simply moved
  // to where the pointer let go — written through to the DI. The route to it is
  // squared on the way (parity spec §4), so the tip is the last waypoint rather than
  // the second, and no segment is left diagonal.
  expect(flow.target).toBe(one);
  expect((flow.businessObject as any).targetRef.id).toBe('Task_1');
  expect(flow.waypoints.at(-1)).toEqual({ x: 250, y: 400 });
  expect(isOrthogonal(flow.waypoints)).toBe(true);
  expect(diWaypoints(definitions, 'Flow_1')).toEqual(flow.waypoints);
});

test('dragging an INTERIOR waypoint still bends the edge (P3), it does not reconnect', async () => {
  const { canvas, definitions } = await load();
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const flow = edge(canvas, 'Flow_1');
  const one = node(canvas, 'Task_1');

  // Give the edge an interior waypoint to grab.
  canvas.getWriteback()!.setEdgeWaypoints(flow, [
    { x: 136, y: 118 },
    { x: 170, y: 200 },
    { x: 200, y: 120 },
  ]);
  canvas.getSelection().select(flow);

  firePointer(canvas, svg, 'pointerdown', { x: 170, y: 200 });
  firePointer(canvas, doc, 'pointermove', { x: 170, y: 260 });
  expect(canvas.getConnect().isActive()).toBe(false);
  firePointer(canvas, doc, 'pointerup', { x: 170, y: 260 });

  expect(flow.target).toBe(one);
  expect(flow.waypoints[1]).toEqual({ x: 170, y: 260 });
  expect(diWaypoints(definitions, 'Flow_1')[1]).toEqual({ x: 170, y: 260 });
});

/*
 * Drop feedback (parity spec addendum 4 §2, `edge-videos/edgemake/frame_02`): the
 * shape a connect drag is hanging over is TINTED — pale grey when it would take the
 * flow, pale red when it refuses. Before this, nothing at all told the user the drop
 * was valid except the ghost line turning solid, which is a change on the far side of
 * the canvas from the cursor.
 */

test('a connect drag tints the shape under the cursor, and lets it go on drop', async () => {
  const { canvas } = await load();
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const one = node(canvas, 'Task_1');
  const two = node(canvas, 'Task_2');

  canvas.startConnect(one);

  // Over empty space nothing is tinted — and, unlike a CREATE drag, the root is not
  // either: empty canvas can hold a new shape, but it cannot hold a connection.
  firePointer(canvas, doc, 'pointermove', { x: 350, y: 400 });
  expect(svg.querySelectorAll('.sf-new-parent')).toHaveLength(0);
  expect(svg.classList.contains('sf-new-parent')).toBe(false);

  // Over a valid target: the target itself, and only it. The marker is
  // `sf-connect-ok`, not `sf-new-parent` — ux-spec §4/§7 keeps "this would take the
  // flow" apart from "this would contain the shape", even though both are painted
  // the same pale tint.
  firePointer(canvas, doc, 'pointermove', center(two));
  expect(canvas.getGraphics('Task_2')!.classList.contains('sf-connect-ok')).toBe(true);
  expect(canvas.getGraphics('Task_2')!.classList.contains('sf-new-parent')).toBe(false);
  expect(svg.querySelectorAll('.sf-drop-not-ok')).toHaveLength(0);

  // Crossing back to the SOURCE, which may not connect to itself: refused, and the
  // mark is exact — the tint left on `Task_2` is taken off in the same frame.
  firePointer(canvas, doc, 'pointermove', center(one));
  expect(canvas.getGraphics('Task_1')!.classList.contains('sf-drop-not-ok')).toBe(true);
  expect(canvas.getGraphics('Task_2')!.classList.contains('sf-connect-ok')).toBe(false);

  firePointer(canvas, doc, 'pointermove', center(two));
  firePointer(canvas, doc, 'pointerup', center(two));
  // The gesture is over: no tint survives it anywhere.
  expect(svg.querySelectorAll('.sf-connect-ok, .sf-new-parent, .sf-drop-not-ok')).toHaveLength(0);
});

test('a reconnect onto a target the rules refuse says so on the root, so the cursor shows ∅', async () => {
  // Parity spec §1 requires the no-drop cursor over an invalid reconnect target. The
  // cursor itself is a `view/theme.ts` rule keyed on this attribute, so the attribute
  // is what a headless test can pin — and until now only the VALID drop was covered.
  const { canvas } = await load();
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const flow = edge(canvas, 'Flow_1');
  const note = node(canvas, 'Note_1');

  canvas.getSelection().select(flow);
  firePointer(canvas, svg, 'pointerdown', flow.waypoints[flow.waypoints.length - 1]);

  // A text annotation cannot be the target of a sequence flow.
  firePointer(canvas, doc, 'pointermove', center(note));
  expect(canvas.getConnect().getKind()).toBe('reconnect');
  expect(canvas.getConnect().reconnectVerdict(flow, 'target', note)).toBe(false);
  expect(svg.getAttribute('data-connect-status')).toBe('rejected');
  expect(svg.querySelector('.sf-connect-preview')!.getAttribute('data-status')).toBe('rejected');
  expect(canvas.getGraphics('Note_1')!.classList.contains('sf-drop-not-ok')).toBe(true);

  // Dropping there writes nothing at all, and the verdict comes off the root.
  const before = flow.waypoints.map((p) => ({ ...p }));
  firePointer(canvas, doc, 'pointerup', center(note));
  expect(flow.target).toBe(node(canvas, 'Task_1'));
  expect(flow.waypoints).toEqual(before);
  expect(svg.getAttribute('data-connect-status')).toBeNull();
  expect(svg.querySelectorAll('.sf-drop-not-ok')).toHaveLength(0);
});
