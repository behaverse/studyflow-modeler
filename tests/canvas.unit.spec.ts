import { expect, test } from '@playwright/test';

import { isRootElement, type SceneEdge, type SceneLabel, type SceneNode } from '@canvas/index.ts';
import type { Canvas } from '@canvas/index.ts';

import {
  click,
  dragBy,
  freshModdle,
  installDocument,
  jsdomWindow,
  keyEvent,
  loadCanvas,
  pointerDown,
  pointerMove,
  pointerUp,
  type Loaded,
} from './canvasHarness';

/**
 * The canvas, driven the way the app drives it: the public API for edits, pointer
 * events for gestures, and the document (`syncDi` + `toXML`) for what was written.
 */

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Go"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="Read"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing></bpmn:task>
    <bpmn:exclusiveGateway id="Gateway_1" name="Ok?"><bpmn:incoming>Flow_2</bpmn:incoming><bpmn:outgoing>Flow_3</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:endEvent id="End_1" name="Done"><bpmn:incoming>Flow_3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="Gateway_1" name="next" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Gateway_1" targetRef="End_1" />
    <bpmn:subProcess id="Sub_1" name="Inner">
      <bpmn:task id="Task_In" name="Deep" />
    </bpmn:subProcess>
    <bpmn:dataObjectReference id="Data_1" name="Table" dataObjectRef="DO_1" />
    <bpmn:dataObject id="DO_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1"><dc:Bounds x="200" y="78" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_1_di" bpmnElement="Gateway_1"><dc:Bounds x="360" y="93" width="50" height="50" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="480" y="100" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="470" y="140" width="60" height="15" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub_1_di" bpmnElement="Sub_1" isExpanded="false"><dc:Bounds x="200" y="250" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_In_di" bpmnElement="Task_In"><dc:Bounds x="400" y="400" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Data_1_di" bpmnElement="Data_1"><dc:Bounds x="120" y="250" width="36" height="50" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint x="136" y="118" /><di:waypoint x="200" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2"><di:waypoint x="300" y="118" /><di:waypoint x="360" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_3_di" bpmnElement="Flow_3"><di:waypoint x="410" y="118" /><di:waypoint x="480" y="118" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

installDocument();

function node(canvas: Canvas, id: string): SceneNode {
  const element = canvas.get(id);
  if (!element || isRootElement(element) || element.kind !== 'node') throw new Error(`no node ${id}`);
  return element;
}

function edge(canvas: Canvas, id: string): SceneEdge {
  const element = canvas.get(id);
  if (!element || isRootElement(element) || element.kind !== 'edge') throw new Error(`no edge ${id}`);
  return element;
}

function label(canvas: Canvas, id: string): SceneLabel {
  const element = canvas.get(id);
  if (!element || isRootElement(element) || element.kind !== 'label') throw new Error(`no label ${id}`);
  return element;
}

const centre = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** `point` sits on the outline of `box`. */
const onOutline = (box: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }): boolean => {
  const inX = point.x >= box.x - 0.01 && point.x <= box.x + box.width + 0.01;
  const inY = point.y >= box.y - 0.01 && point.y <= box.y + box.height + 0.01;
  const onV = Math.abs(point.x - box.x) < 0.01 || Math.abs(point.x - box.x - box.width) < 0.01;
  const onH = Math.abs(point.y - box.y) < 0.01 || Math.abs(point.y - box.y - box.height) < 0.01;
  return (onV && inY) || (onH && inX);
};

const isHiddenGraphics = (canvas: Canvas, id: string): boolean =>
  canvas.getGraphics(id)?.getAttribute('display') === 'none';

async function xmlOf({ canvas, moddle, definitions }: Loaded): Promise<string> {
  canvas.syncDi();
  return (await moddle.toXML(definitions, { format: true })).xml;
}

const load = (): Promise<Loaded> => loadCanvas(XML);

// --- import and the round trip -------------------------------------------------

test('import builds one tree, with captions as elements of their own', async () => {
  const { canvas } = await load();
  expect(node(canvas, 'Task_1').parent).toBeUndefined();
  expect(node(canvas, 'Task_In').parent).toBe(node(canvas, 'Sub_1'));
  expect(node(canvas, 'Sub_1').children).toContain(node(canvas, 'Task_In'));
  expect(canvas.getScene()!.children.map((el) => el.id)).not.toContain('Task_In');

  // An event's name is a label element under the shape; a task's is drawn inside it.
  const startLabel = label(canvas, 'Start_1_label');
  expect(startLabel.owner).toBe(node(canvas, 'Start_1'));
  expect(startLabel.pinned).toBe(false);
  expect(startLabel.y).toBeGreaterThan(136);
  expect(Math.abs(centre(startLabel).x - 118)).toBeLessThan(0.01);
  expect(node(canvas, 'Task_1').label).toBeUndefined();
  // A `bpmndi:BPMNLabel` pins the caption where the document put it.
  const endLabel = label(canvas, 'End_1_label');
  expect(endLabel.pinned).toBe(true);
  expect({ x: endLabel.x, y: endLabel.y, width: endLabel.width }).toEqual({ x: 470, y: 140, width: 60 });
  expect(label(canvas, 'Flow_2_label').owner).toBe(edge(canvas, 'Flow_2'));

  // The contents of a collapsed container exist but are not drawn.
  expect(isHiddenGraphics(canvas, 'Task_In')).toBe(true);
  expect(isHiddenGraphics(canvas, 'Task_1')).toBe(false);
});

test('the DI round trip keeps geometry, pinned captions and the collapse flag', async () => {
  const loaded = await load();
  const xml = await xmlOf(loaded);
  expect(xml.match(/<bpmndi:BPMNLabel>/g) ?? []).toHaveLength(1);

  const moddle = freshModdle();
  const { rootElement } = await moddle.fromXML(xml);
  const again = await loadCanvas(XML);
  again.canvas.importDefinitions(rootElement);
  for (const id of ['Start_1', 'Task_1', 'Gateway_1', 'End_1', 'Sub_1', 'Task_In', 'Data_1']) {
    const a = node(loaded.canvas, id);
    const b = node(again.canvas, id);
    expect({ x: b.x, y: b.y, width: b.width, height: b.height }).toEqual({ x: a.x, y: a.y, width: a.width, height: a.height });
  }
  expect(edge(again.canvas, 'Flow_2').waypoints).toEqual(edge(loaded.canvas, 'Flow_2').waypoints);
  expect(node(again.canvas, 'Sub_1').isExpanded).toBe(false);
  expect(node(again.canvas, 'Task_In').parent).toBe(node(again.canvas, 'Sub_1'));
  const endLabel = label(again.canvas, 'End_1_label');
  expect({ x: endLabel.x, y: endLabel.y, pinned: endLabel.pinned }).toEqual({ x: 470, y: 140, pinned: true });
});

// --- creating -------------------------------------------------------------------------

test('createElement places a shape, files its business object and opens the editor of a task', async () => {
  const { canvas, definitions } = await load();
  const created = canvas.createElement({ type: 'bpmn:Task' }, { x: 600, y: 118 })!;
  expect({ x: created.x, y: created.y, width: created.width, height: created.height }).toEqual({ x: 550, y: 78, width: 100, height: 80 });
  expect(canvas.getScene()!.children).toContain(created);
  const process = definitions.rootElements[0];
  expect(process.flowElements.map((el: any) => el.id)).toContain(created.id);
  expect(canvas.getSelection().get()).toEqual([created]);
  expect(canvas.getLabelEditing().isActive()).toBe(true);
  canvas.getLabelEditing().cancel();

  // A collapsed container takes nothing.
  expect(canvas.createElement({ type: 'bpmn:Task' }, centre(node(canvas, 'Sub_1')))).toBeUndefined();
});

test('a boundary event attaches to the activity it is dropped on', async () => {
  const { canvas } = await load();
  const boundary = canvas.createElement({ type: 'bpmn:BoundaryEvent' }, centre(node(canvas, 'Task_1')))!;
  expect(boundary.businessObject.attachedToRef).toBe(node(canvas, 'Task_1').businessObject);
  expect(boundary.parent).toBeUndefined();
});

test('a palette create follows the pointer and lands, grid-snapped, where it is released', async () => {
  const { canvas } = await load();
  expect(canvas.startCreate(undefined, { type: 'bpmn:ExclusiveGateway' })).toBe(true);
  pointerMove(canvas, { x: 703, y: 297 });
  pointerUp(canvas, { x: 703, y: 297 });
  const gateway = canvas.getSelection().get()[0] as SceneNode;
  expect(gateway.type).toBe('bpmn:ExclusiveGateway');
  expect(centre(gateway)).toEqual({ x: 700, y: 300 });
  expect(canvas.getLabelEditing().isActive()).toBe(false);
});

// --- connecting --------------------------------------------------------------------

test('connectElements mints a routed sequence flow and wires both ends', async () => {
  const { canvas } = await load();
  const task = canvas.createElement({ type: 'bpmn:Task' }, { x: 600, y: 118 })!;
  canvas.getLabelEditing().cancel();
  const gateway = node(canvas, 'Gateway_1');
  const flow = canvas.connectElements(gateway, task)!;
  expect(flow.type).toBe('bpmn:SequenceFlow');
  expect(flow.source).toBe(gateway);
  expect(flow.target).toBe(task);
  expect(flow.waypoints.length).toBeGreaterThanOrEqual(2);
  expect(flow.waypoints[0].x).toBe(410);
  expect(flow.waypoints.at(-1)!.x).toBe(550);
  expect(flow.businessObject.sourceRef).toBe(gateway.businessObject);
  expect(gateway.businessObject.outgoing).toContain(flow.businessObject);
  expect(task.businessObject.incoming).toContain(flow.businessObject);
  expect(canvas.getGraphics(flow.id)).toBeTruthy();

  // Nothing flows out of an end event.
  expect(canvas.connectElements(node(canvas, 'End_1'), task)).toBeUndefined();
});

test('a connect gesture drops the flow on the shape under the pointer', async () => {
  const { canvas } = await load();
  const task = node(canvas, 'Task_1');
  const end = node(canvas, 'End_1');
  expect(canvas.startConnect(task)).toBe(true);
  pointerMove(canvas, centre(end));
  pointerUp(canvas, centre(end));
  const flow = canvas.getSelection().get()[0] as SceneEdge;
  expect(flow.kind).toBe('edge');
  expect(flow.source).toBe(task);
  expect(flow.target).toBe(end);
});

test('a data shape and an activity connect with a data input association', async () => {
  const { canvas } = await load();
  const data = node(canvas, 'Data_1');
  const task = node(canvas, 'Task_1');
  const association = canvas.connectElements(data, task)!;
  expect(association.type).toBe('bpmn:DataInputAssociation');
  expect(task.businessObject.dataInputAssociations).toContain(association.businessObject);
  expect(association.businessObject.sourceRef).toEqual([data.businessObject]);
});

// --- direct manipulation -------------------------------------------------------------

test('dragging a selected task moves it, re-docks its flows and leaves its caption derived', async () => {
  const { canvas } = await load();
  const task = node(canvas, 'Task_1');
  click(canvas, centre(task));
  dragBy(canvas, centre(task), { x: centre(task).x + 40, y: centre(task).y + 60 });
  expect({ x: task.x, y: task.y }).toEqual({ x: 240, y: 140 });
  expect(onOutline(task, edge(canvas, 'Flow_1').waypoints.at(-1)!)).toBe(true);
  expect(onOutline(node(canvas, 'Start_1'), edge(canvas, 'Flow_1').waypoints[0])).toBe(true);
  expect(onOutline(task, edge(canvas, 'Flow_2').waypoints[0])).toBe(true);
  expect(canvas.getGraphics('Task_1')!.getAttribute('transform')).toBe('translate(240, 140)');
  expect(canvas.getScene()!.revision).toBeGreaterThan(0);
});

test('Escape abandons a drag and puts the snapshot back', async () => {
  const { canvas } = await load();
  const task = node(canvas, 'Task_1');
  click(canvas, centre(task));
  pointerDown(canvas, centre(task));
  pointerMove(canvas, { x: centre(task).x + 50, y: centre(task).y + 50 });
  expect(task.x).not.toBe(200);
  canvas.getSvg().ownerDocument!.dispatchEvent(keyEvent('keydown', { key: 'Escape' }));
  pointerUp(canvas, { x: 250, y: 168 });
  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 78 });
  expect(edge(canvas, 'Flow_1').waypoints).toEqual([{ x: 136, y: 118 }, { x: 200, y: 118 }]);
});

test('a corner handle resizes, clamped to the rules\' minimum', async () => {
  const { canvas } = await load();
  const task = node(canvas, 'Task_1');
  click(canvas, centre(task));
  const grab = { x: task.x + task.width + 4, y: task.y + task.height + 4 };
  dragBy(canvas, grab, { x: grab.x + 50, y: grab.y + 30 });
  expect({ width: task.width, height: task.height }).toEqual({ width: 150, height: 112 });
  const again = { x: task.x + task.width + 4, y: task.y + task.height + 4 };
  dragBy(canvas, again, { x: again.x - 200, y: again.y - 200 });
  expect({ width: task.width, height: task.height }).toEqual({ width: 100, height: 80 });
  // An event has a fixed footprint: no handles to grab.
  const start = node(canvas, 'Start_1');
  click(canvas, centre(start));
  expect(canvas.getSelection().handleAt({ x: start.x + 40, y: start.y + 40 })).toBeUndefined();
});

test('a press on a selected flow drags a new bendpoint out of it', async () => {
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_2');
  click(canvas, { x: 330, y: 118 });
  expect(canvas.getSelection().get()).toEqual([flow]);
  dragBy(canvas, { x: 330, y: 118 }, { x: 330, y: 180 });
  expect(flow.waypoints).toHaveLength(3);
  expect(flow.waypoints[1]).toEqual({ x: 330, y: 180 });
});

test('dragging a flow end onto another shape reconnects it', async () => {
  const { canvas } = await load();
  const flow = edge(canvas, 'Flow_3');
  const sub = node(canvas, 'Sub_1');
  click(canvas, { x: 445, y: 118 });
  dragBy(canvas, { x: 480, y: 118 }, centre(sub));
  expect(flow.target).toBe(sub);
  expect(node(canvas, 'End_1').incoming).toEqual([]);
  expect(sub.incoming).toContain(flow);
  expect(flow.businessObject.targetRef).toBe(sub.businessObject);
});

// --- selection and deletion -----------------------------------------------------------

test('click selects, Shift+click toggles, and an empty click clears', async () => {
  const { canvas } = await load();
  const task = node(canvas, 'Task_1');
  const gateway = node(canvas, 'Gateway_1');
  click(canvas, centre(task));
  expect(canvas.getSelection().get()).toEqual([task]);
  pointerDown(canvas, centre(gateway), { shiftKey: true });
  pointerUp(canvas, centre(gateway), { shiftKey: true });
  expect(canvas.getSelection().get()).toEqual([task, gateway]);
  pointerDown(canvas, centre(task), { shiftKey: true });
  pointerUp(canvas, centre(task), { shiftKey: true });
  expect(canvas.getSelection().get()).toEqual([gateway]);
  click(canvas, { x: 700, y: 700 });
  expect(canvas.getSelection().get()).toEqual([]);
});

test('Delete removes the selection with its flows from the scene and the document', async () => {
  const { canvas, definitions } = await load();
  const task = node(canvas, 'Task_1');
  click(canvas, centre(task));
  canvas.getContainer().dispatchEvent(keyEvent('keydown', { key: 'Delete' }));
  expect(canvas.get('Task_1')).toBeUndefined();
  expect(canvas.get('Flow_1')).toBeUndefined();
  expect(canvas.get('Flow_2')).toBeUndefined();
  expect(canvas.get('Flow_2_label')).toBeUndefined();
  expect(canvas.getGraphics('Task_1')).toBeUndefined();
  const ids = definitions.rootElements[0].flowElements.map((el: any) => el.id);
  expect(ids).not.toContain('Task_1');
  expect(ids).not.toContain('Flow_1');
  expect(node(canvas, 'Start_1').outgoing).toEqual([]);
  expect(node(canvas, 'Start_1').businessObject.outgoing).toEqual([]);
});

test('deleting a caption clears its owner\'s name', async () => {
  const { canvas } = await load();
  const start = node(canvas, 'Start_1');
  canvas.getSelection().select(label(canvas, 'Start_1_label'));
  canvas.deleteSelection();
  expect(start.businessObject.name).toBe('');
  expect(canvas.get('Start_1_label')).toBeUndefined();
  expect(canvas.getGraphics('Start_1_label')).toBeUndefined();
  expect(canvas.get('Start_1')).toBe(start);
});

// --- captions ------------------------------------------------------------------------

test('a dragged caption moves alone and becomes pinned in the document', async () => {
  const loaded = await load();
  const { canvas } = loaded;
  const start = node(canvas, 'Start_1');
  const caption = label(canvas, 'Start_1_label');
  const from = centre(caption);
  canvas.setSnapToGrid(false);
  click(canvas, from);
  expect(canvas.getSelection().get()).toEqual([caption]);
  dragBy(canvas, from, { x: from.x + 30, y: from.y + 30 });
  expect(caption.pinned).toBe(true);
  expect(Math.round(centre(caption).x - from.x)).toBe(30);
  expect({ x: start.x, y: start.y }).toEqual({ x: 100, y: 100 });
  expect(await xmlOf(loaded)).toMatch(/Start_1_di[\s\S]*?<bpmndi:BPMNLabel>/);
});

test('renaming through the inline editor re-fits the caption under its shape', async () => {
  const { canvas } = await load();
  const start = node(canvas, 'Start_1');
  const before = label(canvas, 'Start_1_label').width;
  expect(canvas.editLabel(start)).toBe(true);
  canvas.getLabelEditing().setValue('A much longer caption');
  canvas.getLabelEditing().complete();
  expect(start.businessObject.name).toBe('A much longer caption');
  const caption = label(canvas, 'Start_1_label');
  expect(caption.width).toBeGreaterThan(before);
  expect(Math.abs(centre(caption).x - centre(start).x)).toBeLessThan(0.01);
  expect(canvas.getGraphics('Start_1_label')!.textContent).toContain('caption');
});

test('a moved node carries its pinned caption and re-derives an unpinned one', async () => {
  const { canvas } = await load();
  const end = node(canvas, 'End_1');
  click(canvas, centre(end));
  dragBy(canvas, centre(end), { x: centre(end).x, y: centre(end).y + 100 });
  expect(end.y).toBe(200);
  expect(label(canvas, 'End_1_label').y).toBe(240);
  const start = node(canvas, 'Start_1');
  click(canvas, centre(start));
  dragBy(canvas, centre(start), { x: centre(start).x + 100, y: centre(start).y });
  expect(Math.abs(centre(label(canvas, 'Start_1_label')).x - centre(start).x)).toBeLessThan(0.01);
});

// --- containers ---------------------------------------------------------------------

test('expanding a container frames its contents and collapsing hides them again', async () => {
  const { canvas } = await load();
  const sub = node(canvas, 'Sub_1');
  const inner = node(canvas, 'Task_In');
  expect(canvas.setExpanded(sub, true)).toBe(true);
  expect(sub.isExpanded).toBe(true);
  expect(sub.width).toBeGreaterThanOrEqual(350);
  expect(inner.x).toBeGreaterThanOrEqual(sub.x);
  expect(inner.x + inner.width).toBeLessThanOrEqual(sub.x + sub.width);
  expect(isHiddenGraphics(canvas, 'Task_In')).toBe(false);
  expect(canvas.setExpanded(sub, false)).toBe(true);
  expect({ width: sub.width, height: sub.height }).toEqual({ width: 100, height: 80 });
  expect(isHiddenGraphics(canvas, 'Task_In')).toBe(true);
});

test('drilling into a container shows only its contents until the trail leads back out', async () => {
  const { canvas } = await load();
  const sub = node(canvas, 'Sub_1');
  expect(canvas.enterScope(sub)).toBe(true);
  expect(canvas.getRoot()).toBe(sub);
  expect(canvas.scopePath().map((root) => root.id)).toEqual(['Process_1', 'Sub_1']);
  expect(isHiddenGraphics(canvas, 'Task_1')).toBe(true);
  expect(isHiddenGraphics(canvas, 'Task_In')).toBe(false);
  expect(canvas.hitTest(centre(node(canvas, 'Task_1')))).toBeUndefined();
  expect(canvas.hitTest(centre(node(canvas, 'Task_In')))).toBe(node(canvas, 'Task_In'));
  // A shape dropped while drilled in belongs to the container.
  const dropped = canvas.createElement({ type: 'bpmn:Task' }, { x: 700, y: 400 })!;
  canvas.getLabelEditing().cancel();
  expect(dropped.parent).toBe(sub);
  expect(sub.businessObject.flowElements).toContain(dropped.businessObject);
  expect(canvas.goToScope(undefined)).toBe(true);
  expect(isRootElement(canvas.getRoot())).toBe(true);
  expect(isHiddenGraphics(canvas, 'Task_1')).toBe(false);
});

test('dropping a shape into an expanded container re-files it there', async () => {
  const { canvas } = await load();
  const sub = node(canvas, 'Sub_1');
  canvas.setExpanded(sub, true);
  const task = canvas.createElement({ type: 'bpmn:Task' }, { x: 800, y: 118 })!;
  canvas.getLabelEditing().cancel();
  click(canvas, centre(task));
  dragBy(canvas, centre(task), { x: sub.x + sub.width - 60, y: sub.y + sub.height - 50 });
  expect(task.parent).toBe(sub);
  expect(sub.businessObject.flowElements).toContain(task.businessObject);
  expect(canvas.getScene()!.children).not.toContain(task);
});

// --- keyboard, colour, replace ---------------------------------------------------------

test('Ctrl+A selects everything on screen and the arrows nudge the selection', async () => {
  const { canvas } = await load();
  const container = canvas.getContainer();
  container.dispatchEvent(keyEvent('keydown', { key: 'a', ctrlKey: true }));
  const ids = canvas.getSelection().get().map((el) => el.id);
  expect(ids).toContain('Task_1');
  expect(ids).toContain('Flow_1');
  expect(ids).not.toContain('Task_In');
  expect(ids).not.toContain('Start_1_label');
  const task = node(canvas, 'Task_1');
  canvas.getSelection().select(task);
  container.dispatchEvent(keyEvent('keydown', { key: 'ArrowRight' }));
  container.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown', shiftKey: true }));
  expect({ x: task.x, y: task.y }).toEqual({ x: 201, y: 88 });
});

test('setColor paints the element and the colour survives the round trip', async () => {
  const loaded = await load();
  const { canvas } = loaded;
  const task = node(canvas, 'Task_1');
  canvas.setColor([task, edge(canvas, 'Flow_1')], { fill: '#dde8fa', stroke: '#728cb9' });
  expect({ fill: task.fill, stroke: task.stroke }).toEqual({ fill: '#dde8fa', stroke: '#728cb9' });
  expect(canvas.getGraphics('Task_1')!.querySelector('rect:not(.sf-outline)')!.getAttribute('fill')).toBe('#dde8fa');
  expect(edge(canvas, 'Flow_1').stroke).toBe('#728cb9');
  const xml = await xmlOf(loaded);
  expect(xml).toContain('background-color="#dde8fa"');
  const again = await loadCanvas(xml);
  expect(node(again.canvas, 'Task_1').fill).toBe('#dde8fa');
  canvas.setColor([task], { fill: null, stroke: null });
  expect(task.fill).toBeUndefined();
});

test('replaceElement keeps the name and rewires the flows onto the new type', async () => {
  const { canvas } = await load();
  const replacement = canvas.replaceElement(node(canvas, 'Task_1'), { type: 'bpmn:UserTask' })!;
  expect(replacement.type).toBe('bpmn:UserTask');
  expect(replacement.businessObject.name).toBe('Read');
  expect(canvas.get('Task_1')).toBeUndefined();
  expect(edge(canvas, 'Flow_1').target).toBe(replacement);
  expect(edge(canvas, 'Flow_2').source).toBe(replacement);
  expect(canvas.getSelection().get()).toEqual([replacement]);
});

test('toSVG exports the drawing without the editor chrome', async () => {
  const { canvas } = await load();
  click(canvas, centre(node(canvas, 'Task_1')));
  const svg = canvas.toSVG();
  expect(svg).toContain('data-element-id="Task_1"');
  expect(svg).not.toContain('sf-outline');
  expect(svg).not.toContain('selected');
  expect(svg).not.toContain('tabindex');
  expect(svg).toMatch(/viewBox="[-\d.]+ [-\d.]+ [\d.]+ [\d.]+"/);
  expect(jsdomWindow()).toBeTruthy();
});
