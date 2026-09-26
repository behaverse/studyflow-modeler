import { expect, test } from '@playwright/test';

import { Canvas, EventBus, IdGenerator, ensureChoreographyParticipants, isRootElement, type SceneEdge, type SceneNode } from '@canvas/index.ts';
import { readChoreographyBands } from '@core/document';

import {
  centre,
  click,
  doubleClick,
  dragBy,
  edge,
  freshModdle,
  installDocument,
  keyEvent,
  label,
  loadCanvas,
  loadYaml,
  node,
  pointerDown,
  pointerMove,
  pointerUp,
  xmlOf,
  type Loaded,
} from './canvasHarness';

/**
 * The canvas, driven the way the app drives it: the public API for edits, pointer
 * events for gestures, and the document (`syncDi` + `toXML`) for what was written.
 */

const YAML = `id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    Start_1:
      type: StartEvent
      name: Go
      bounds: 100 100 36 36
    Task_1:
      type: Task
      name: Read
      bounds: 200 78 100 80
    Gateway_1:
      type: ExclusiveGateway
      name: Ok?
      bounds: 360 93 50 50
    End_1:
      type: EndEvent
      name: Done
      bounds: 480 100 36 36
      label: 470 140 60 15
    Flow_1:
      sourceRef: Start_1
      targetRef: Task_1
      waypoint: 136,118 200,118
    Flow_2:
      name: next
      sourceRef: Task_1
      targetRef: Gateway_1
      waypoint: 300,118 360,118
    Flow_3:
      sourceRef: Gateway_1
      targetRef: End_1
      waypoint: 410,118 480,118
    Sub_1:
      type: SubProcess
      name: Inner
      flowElements:
        Task_In:
          type: Task
          name: Deep
          bounds: 400 400 100 80
      bounds: 200 250 100 80
      isExpanded: false
    Data_1:
      type: DataObjectReference
      name: Table
      dataObjectRef: DO_1
      bounds: 120 250 36 50
    DO_1:
      type: DataObject
`;

installDocument();

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

const load = (): Loaded => loadYaml(YAML);

// --- import and the round trip -------------------------------------------------

test('import builds one tree, with captions as elements of their own', async () => {
  const { canvas } = load();
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
  const loaded = load();
  const xml = await xmlOf(loaded);
  expect(xml.match(/<bpmndi:BPMNLabel>/g) ?? []).toHaveLength(1);

  const moddle = freshModdle();
  const { rootElement } = await moddle.fromXML(xml);
  const again = loadYaml(YAML);
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

test('only the first diagram is drawn, and a warning names any further one', async () => {
  // Another tool draws a collapsed sub-process's contents on a plane of their own.
  const { canvas, moddle, definitions } = load();
  canvas.syncDi();
  const plane = definitions.diagrams[0].plane;
  const inner = plane.planeElement.find((di: any) => di.bpmnElement.id === 'Task_In');
  plane.planeElement = plane.planeElement.filter((di: any) => di !== inner);
  const subPlane = moddle.create('bpmndi:BPMNPlane', { bpmnElement: node(canvas, 'Sub_1').businessObject, planeElement: [inner] });
  definitions.diagrams.push(moddle.create('bpmndi:BPMNDiagram', { id: 'Diagram_Sub', plane: subPlane }));

  const warnings: string[] = [];
  const again = new Canvas({ onWarning: (warning) => warnings.push(warning) });
  again.importDefinitions(definitions);
  expect(again.get('Task_In')).toBeUndefined();
  expect(node(again, 'Sub_1').children).toEqual([]);
  expect(warnings).toEqual([expect.stringContaining('Diagram_Sub')]);
});

// --- creating -------------------------------------------------------------------------

test('createElement places a shape, files its business object and opens the editor of a task', async () => {
  const { canvas, definitions } = load();
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
  const { canvas } = load();
  const boundary = canvas.createElement({ type: 'bpmn:BoundaryEvent' }, centre(node(canvas, 'Task_1')))!;
  expect(boundary.businessObject.attachedToRef).toBe(node(canvas, 'Task_1').businessObject);
  expect(boundary.parent).toBeUndefined();
});

test('a palette create follows the pointer and lands, grid-snapped, where it is released', async () => {
  const { canvas } = load();
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
  const { canvas } = load();
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

test('a new default redraws the flow that lost the slash as well as the one that gained it', async () => {
  const { canvas } = load();
  const gateway = node(canvas, 'Gateway_1');
  const toEnd = edge(canvas, 'Flow_3');
  const toTask = canvas.connectElements(gateway, node(canvas, 'Task_1'))!;
  const slash = (flow: SceneEdge) => canvas.getGraphics(flow.id)!.querySelector('.sf-connection-line')!.getAttribute('marker-start');
  canvas.updateModdleProperties(toEnd, gateway.businessObject, { default: toEnd.businessObject });
  expect(slash(toEnd)).toContain('sf-marker-default');
  canvas.updateModdleProperties(toTask, gateway.businessObject, { default: toTask.businessObject });
  expect(slash(toTask)).toContain('sf-marker-default');
  expect(slash(toEnd)).toBeNull();
});

test('connectElements keeps a route the host drew (a template\'s)', async () => {
  const { canvas } = load();
  const task = canvas.createElement({ type: 'bpmn:Task' }, { x: 600, y: 118 })!;
  canvas.getLabelEditing().cancel();
  const route = [{ x: 385, y: 143 }, { x: 385, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 158 }];
  expect(canvas.connectElements(node(canvas, 'Gateway_1'), task, undefined, route)!.waypoints).toEqual(route);
});

test('a connect gesture drops the flow on the shape under the pointer', async () => {
  const { canvas } = load();
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
  const { canvas } = load();
  const data = node(canvas, 'Data_1');
  const task = node(canvas, 'Task_1');
  const association = canvas.connectElements(data, task)!;
  expect(association.type).toBe('bpmn:DataInputAssociation');
  expect(task.businessObject.dataInputAssociations).toContain(association.businessObject);
  expect(association.businessObject.sourceRef).toEqual([data.businessObject]);

  // A step may draw what the data it reads holds (a glyph a Parameters object sets): editing the data redraws its readers.
  const taskBefore = canvas.getGraphics('Task_1');
  const gatewayBefore = canvas.getGraphics('Gateway_1');
  canvas.updateProperties(data, { name: 'Rows' });
  expect(canvas.getGraphics('Task_1')).not.toBe(taskBefore);
  expect(canvas.getGraphics('Gateway_1')).toBe(gatewayBefore);
});

// --- direct manipulation -------------------------------------------------------------

test('dragging a selected task moves it, re-docks its flows and leaves its caption derived', async () => {
  const { canvas } = load();
  const task = node(canvas, 'Task_1');
  click(canvas, centre(task));
  dragBy(canvas, centre(task), { x: centre(task).x + 40, y: centre(task).y + 60 });
  expect({ x: task.x, y: task.y }).toEqual({ x: 240, y: 140 });
  expect(onOutline(task, edge(canvas, 'Flow_1').waypoints.at(-1)!)).toBe(true);
  expect(onOutline(node(canvas, 'Start_1'), edge(canvas, 'Flow_1').waypoints[0])).toBe(true);
  expect(onOutline(task, edge(canvas, 'Flow_2').waypoints[0])).toBe(true);
  expect(canvas.getGraphics('Task_1')!.getAttribute('transform')).toMatch(/^translate\(\s*240[ ,]+140\s*\)$/);
  expect(canvas.getScene()!.revision).toBeGreaterThan(0);
});

test('Escape abandons a drag and puts the snapshot back', async () => {
  const { canvas } = load();
  const task = node(canvas, 'Task_1');
  click(canvas, centre(task));
  pointerDown(canvas, centre(task));
  pointerMove(canvas, { x: centre(task).x + 50, y: centre(task).y + 50 });
  expect(task.x).not.toBe(200);
  canvas.getSvg().ownerDocument!.dispatchEvent(keyEvent('keydown', { key: 'Escape' }));
  pointerUp(canvas, { x: 250, y: 168 });
  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 78 });
  expect(edge(canvas, 'Flow_1').waypoints).toEqual([{ x: 136, y: 118 }, { x: 200, y: 118 }]);

  // A resize keeps a snapshot of its own, and Escape puts that back too.
  const grab = { x: task.x + task.width + 4, y: task.y + task.height + 4 };
  pointerDown(canvas, grab);
  pointerMove(canvas, { x: grab.x + 33, y: grab.y + 17 });
  expect(task.width).not.toBe(100);
  canvas.getSvg().ownerDocument!.dispatchEvent(keyEvent('keydown', { key: 'Escape' }));
  pointerUp(canvas, { x: grab.x + 33, y: grab.y + 17 });
  expect({ x: task.x, y: task.y, width: task.width, height: task.height }).toEqual({ x: 200, y: 78, width: 100, height: 80 });
  expect(edge(canvas, 'Flow_1').waypoints).toEqual([{ x: 136, y: 118 }, { x: 200, y: 118 }]);
});

test('a corner handle resizes, clamped to the rules\' minimum', async () => {
  const { canvas } = load();
  const task = node(canvas, 'Task_1');
  click(canvas, centre(task));
  const grab = { x: task.x + task.width + 4, y: task.y + task.height + 4 };
  dragBy(canvas, grab, { x: grab.x + 50, y: grab.y + 30 });
  // Grown by about the drag, to within a grid step; the origin held.
  expect(task.width).toBeGreaterThanOrEqual(140);
  expect(task.width).toBeLessThanOrEqual(160);
  expect(task.height).toBeGreaterThanOrEqual(100);
  expect(task.height).toBeLessThanOrEqual(120);
  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 78 });
  const again = { x: task.x + task.width + 4, y: task.y + task.height + 4 };
  dragBy(canvas, again, { x: again.x - 200, y: again.y - 200 });
  expect({ width: task.width, height: task.height }).toEqual(canvas.getRules().minSizeFor(task));
  // An event has a fixed footprint: no handles to grab.
  const start = node(canvas, 'Start_1');
  click(canvas, centre(start));
  expect(canvas.getSelection().handleAt({ x: start.x + 40, y: start.y + 40 })).toBeUndefined();
});

test('a press on a selected flow drags a new bendpoint out of it', async () => {
  const { canvas } = load();
  const flow = edge(canvas, 'Flow_2');
  click(canvas, { x: 330, y: 118 });
  expect(canvas.getSelection().get()).toEqual([flow]);
  dragBy(canvas, { x: 330, y: 118 }, { x: 330, y: 180 });
  expect(flow.waypoints).toHaveLength(3);
  expect(flow.waypoints[1]).toEqual({ x: 330, y: 180 });
});

// --- selection and deletion -----------------------------------------------------------

test('click selects, Shift+click toggles, and an empty click clears', async () => {
  const { canvas } = load();
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
  const { canvas, definitions } = load();
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

test('the first pool makes the collaboration the study, and deleting the last one hands it back to the process', async () => {
  const loaded = loadYaml(`id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study_1:
  type: Process
  documentation: What the pilot is for.
  extensionElements:
    - type: studyflow:Study
  name: Pilot
  flowElements:
    Start_1:
      type: StartEvent
      bounds: 100 100 36 36
state:
  Study_1:
    trials: 3
`);
  const { canvas, definitions } = loaded;
  const [process] = definitions.rootElements;
  const study = process.extensionElements.values[0];
  const [documentation] = process.documentation;

  // The root turns collaboration, and the study stays the root: same id, name, documentation, Study.
  const pool = canvas.createElement({ type: 'bpmn:Participant' }, { x: 300, y: 118 })!;
  const collaboration = canvas.getScene()!.root as any;
  expect(canvas.getRoot()).toMatchObject({ id: 'Study_1', type: 'bpmn:Collaboration' });
  expect(collaboration).toMatchObject({ id: 'Study_1', name: 'Pilot', documentation: [documentation] });
  expect(collaboration.extensionElements.values).toEqual([study]);
  // The process is the pool's now, under an id of its own; its properties' run state follows it.
  expect(process.id).toMatch(/^Process_/);
  expect(process.name).toBeUndefined();
  expect(process.extensionElements).toBeUndefined();
  expect(JSON.parse(study.state)).toEqual({ [process.id]: { trials: 3 } });
  const note = canvas.createElement({ type: 'bpmn:TextAnnotation' }, { x: 900, y: 600 })!;
  expect((collaboration as any).artifacts).toEqual([note.businessObject]);
  // One pool of two going leaves the collaboration the root.
  canvas.deleteElements(canvas.createElement({ type: 'bpmn:Participant' }, { x: 300, y: 900 })!);
  expect(canvas.getScene()!.root).toBe(collaboration);

  canvas.deleteElements(pool);
  expect(canvas.getScene()!.root).toBe(process);
  expect(canvas.getRoot()).toMatchObject({ id: 'Study_1', type: 'bpmn:Process' });
  expect(process).toMatchObject({ id: 'Study_1', name: 'Pilot', documentation: [documentation] });
  expect(process.extensionElements.values).toEqual([study]);
  expect(JSON.parse(study.state)).toEqual({ Study_1: { trials: 3 } });
  expect(process.artifacts).toEqual([note.businessObject]);
  expect(definitions.rootElements).toEqual([process]);
  expect(await xmlOf(loaded)).toContain('bpmnElement="Study_1"');
});

test('deleting a caption clears its owner\'s name', async () => {
  const { canvas } = load();
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
  const loaded = load();
  const { canvas } = loaded;
  const start = node(canvas, 'Start_1');
  const caption = label(canvas, 'Start_1_label');
  const from = centre(caption);
  canvas.setSnapToGrid(false);
  click(canvas, from);
  expect(canvas.getSelection().get()).toEqual([caption]);
  // A selected caption offers its four corner handles, as a resizable shape does.
  expect(canvas.getSvg().querySelectorAll('.sf-handle')).toHaveLength(4);
  dragBy(canvas, from, { x: from.x + 30, y: from.y + 30 });
  expect(caption.pinned).toBe(true);
  expect(Math.round(centre(caption).x - from.x)).toBe(30);
  expect({ x: start.x, y: start.y }).toEqual({ x: 100, y: 100 });
  expect(await xmlOf(loaded)).toMatch(/Start_1_di[\s\S]*?<bpmndi:BPMNLabel>/);
});

test('renaming through the inline editor re-fits a caption, and naming an unnamed flow mints one', async () => {
  const { canvas } = load();
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

  // Flow_1 has no name, so no caption until it gets one.
  const flow = edge(canvas, 'Flow_1');
  expect(canvas.get('Flow_1_label')).toBeUndefined();
  expect(canvas.editLabel(flow)).toBe(true);
  canvas.getLabelEditing().setValue('hello');
  canvas.getLabelEditing().complete();
  expect(label(canvas, 'Flow_1_label').owner).toBe(flow);
  expect(canvas.getGraphics('Flow_1_label')!.textContent).toContain('hello');
});

test('a moved node carries its pinned caption and re-derives an unpinned one', async () => {
  const { canvas } = load();
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

test('expanding a container frames its contents and re-docks its flows, and collapsing hides them again', async () => {
  const { canvas } = load();
  const sub = node(canvas, 'Sub_1');
  const inner = node(canvas, 'Task_In');
  const flow = canvas.connectElements(node(canvas, 'Start_1'), sub)!;
  const docked = { ...flow.waypoints.at(-1)! };
  expect(canvas.setExpanded(sub, true)).toBe(true);
  expect(sub.isExpanded).toBe(true);
  expect(sub.width).toBeGreaterThan(100);
  expect(inner.x).toBeGreaterThanOrEqual(sub.x);
  expect(inner.x + inner.width).toBeLessThanOrEqual(sub.x + sub.width);
  expect(inner.y).toBeGreaterThanOrEqual(sub.y);
  expect(inner.y + inner.height).toBeLessThanOrEqual(sub.y + sub.height);
  expect(isHiddenGraphics(canvas, 'Task_In')).toBe(false);
  // The outline grew, so the flow docked on it moved onto the new one.
  expect(flow.waypoints.at(-1)).not.toEqual(docked);
  expect(onOutline(sub, flow.waypoints.at(-1)!)).toBe(true);
  expect(canvas.setExpanded(sub, false)).toBe(true);
  expect({ width: sub.width, height: sub.height }).toEqual({ width: 100, height: 80 });
  expect(isHiddenGraphics(canvas, 'Task_In')).toBe(true);
});

test('a double click opens or shuts a container in place; on an open one\'s caption strip, or with `e`, it renames it', async () => {
  const { canvas } = load();
  const scene = canvas.getScene()!;
  const sub = node(canvas, 'Sub_1');

  // Collapsed, a double click on its body expands it where it stands, as one edit, and does not drill in.
  let revision = scene.revision;
  doubleClick(canvas, centre(sub));
  expect(sub.isExpanded).toBe(true);
  expect(scene.revision).toBe(revision + 1);
  expect(canvas.getScope()).toBeUndefined();
  expect(isHiddenGraphics(canvas, 'Task_In')).toBe(false);

  // Expanded, a double click on its body, clear of its contents and its caption strip, collapses it.
  revision = scene.revision;
  doubleClick(canvas, { x: sub.x + 10, y: sub.y + sub.height - 10 });
  expect(sub.isExpanded).toBe(false);
  expect(scene.revision).toBe(revision + 1);
  expect(isHiddenGraphics(canvas, 'Task_In')).toBe(true);

  // On an expanded container's caption strip, it opens the name editor instead.
  canvas.setExpanded(sub, true);
  doubleClick(canvas, { x: sub.x + 10, y: sub.y + 5 });
  expect(sub.isExpanded).toBe(true);
  expect(canvas.getLabelEditing().getSession()?.element).toBe(sub);
  canvas.getLabelEditing().cancel();
  // So does `e` on the selected container.
  canvas.getSelection().select(sub);
  canvas.getContainer().dispatchEvent(keyEvent('keydown', { key: 'e' }));
  expect(canvas.getLabelEditing().getSession()?.element).toBe(sub);
});

test('drilling into a container shows only its contents until the trail leads back out', async () => {
  const { canvas } = load();
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
  const { canvas } = load();
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

test('a shape dropped into a container is drawn above it, even one drawn before the container', async () => {
  const { canvas } = load();
  const task = canvas.createElement({ type: 'bpmn:Task' }, { x: 800, y: 118 })!;
  canvas.getLabelEditing().cancel();
  const sub = canvas.createElement({ type: 'bpmn:SubProcess', isExpanded: true }, { x: 900, y: 400 })!;
  canvas.getLabelEditing().cancel();
  click(canvas, centre(task));
  dragBy(canvas, centre(task), centre(sub));
  expect(task.parent).toBe(sub);
  const drawn = Array.from(canvas.getGraphics(sub.id)!.parentNode!.children);
  expect(drawn.indexOf(canvas.getGraphics(task.id)!)).toBeGreaterThan(drawn.indexOf(canvas.getGraphics(sub.id)!));
});

test('an edit made of several is one commit: one revision, one ElementsChanged', async () => {
  const { canvas } = load();
  const scene = canvas.getScene()!;
  let fired = 0;
  canvas.getEventBus().on('ElementsChanged', () => { fired += 1; });
  const sub = node(canvas, 'Sub_1');
  canvas.setExpanded(sub, true);
  const loose = canvas.createElement({ type: 'bpmn:Task' }, { x: 800, y: 118 })!;
  canvas.getLabelEditing().cancel();
  const CASES: [what: string, edit: () => void][] = [
    ['a replace: a new shape, the flows moved onto it, the old one deleted', () => canvas.replaceElement(node(canvas, 'Task_1'), { type: 'bpmn:UserTask' })],
    ['an append: a shape and the flow to it', () => canvas.appendElement(node(canvas, 'Gateway_1'), { type: 'bpmn:Task' })],
    ['a move into a container: the move and the change of container', () => {
      click(canvas, centre(loose));
      dragBy(canvas, centre(loose), { x: sub.x + sub.width - 60, y: sub.y + sub.height - 50 });
    }],
    ['a delete that takes a caption: the name cleared and the shape gone', () => canvas.deleteElements([node(canvas, 'Start_1'), label(canvas, 'End_1_label')])],
  ];
  for (const [what, edit] of CASES) {
    const revision = scene.revision;
    fired = 0;
    edit();
    canvas.getLabelEditing().cancel();
    expect({ revisions: scene.revision - revision, fired }, what).toEqual({ revisions: 1, fired: 1 });
  }
  expect(loose.parent).toBe(sub);
  expect(canvas.get('Start_1')).toBeUndefined();
  expect(node(canvas, 'End_1').businessObject.name).toBe('');
});

/** An expanded sub-process divided into two lanes, as BPMN allows any FlowElementsContainer to be. */
const LANED_SUB_YAML = `id: Defs_Laned
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_L:
  type: Process
  flowElements:
    Session:
      type: SubProcess
      name: Session
      laneSets:
        LaneSet_1:
          lanes:
            Lane_Screen:
              name: Screen
              bounds: 130 100 570 130
            Lane_Model:
              name: Model
              bounds: 130 230 570 130
      bounds: 100 100 600 260
    Outside:
      type: Task
      bounds: 800 100 100 80
`;

test('dropping a shape into a lane of a sub-process files it in the sub-process and in the lane', async () => {
  // A lane claims its members by reference, whatever container holds the lane set.
  const { canvas } = loadYaml(LANED_SUB_YAML);
  const sub = node(canvas, 'Session');
  const lane = node(canvas, 'Lane_Model');
  const task = node(canvas, 'Outside');

  click(canvas, centre(task));
  dragBy(canvas, centre(task), centre(lane));

  expect(task.parent).toBe(lane);
  expect((sub.businessObject as any).flowElements).toContain(task.businessObject);
  expect((lane.businessObject as any).flowNodeRef).toContain(task.businessObject);
});

// --- keyboard, colour, font -------------------------------------------------------------

test('Ctrl+A selects everything on screen and the arrows nudge the selection', async () => {
  const { canvas } = load();
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
  // A plain arrow is a fine step, Shift a coarse one.
  const step = { x: task.x - 200, y: task.y - 78 };
  expect(step.x).toBeGreaterThan(0);
  expect(step.y).toBeGreaterThan(step.x);
});

test('setColor paints the element and the colour survives the round trip', async () => {
  const loaded = load();
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

test('setFont restyles the caption and the font survives the round trip', async () => {
  const loaded = load();
  const { canvas } = loaded;
  const task = node(canvas, 'Task_1');
  canvas.setFont([task, edge(canvas, 'Flow_2')], { bold: true, align: 'right', color: '#4a6f9c' });
  expect(task.font).toEqual({ bold: true, align: 'right', color: '#4a6f9c' });
  const text = canvas.getGraphics('Task_1')!.querySelector('text.sf-label')!;
  const BOLD = /^(bold|[6-9]00)$/;
  expect(text.getAttribute('font-weight')).toMatch(BOLD);
  expect(text.getAttribute('text-anchor')).toBe('end');
  expect(text.getAttribute('fill')).toBe('#4a6f9c');
  // A flow's caption is an element of its own, painted from the flow's font.
  expect(canvas.getGraphics('Flow_2_label')!.querySelector('text.sf-label')!.getAttribute('font-weight')).toMatch(BOLD);
  const xml = await xmlOf(loaded);
  expect(xml).toContain('studyflow:font="bold right #4a6f9c"');
  const again = await loadCanvas(xml);
  expect(node(again.canvas, 'Task_1').font).toEqual({ bold: true, align: 'right', color: '#4a6f9c' });
  canvas.setFont([task], { bold: false, align: null, color: null });
  expect(task.font).toBeUndefined();
});

test('toSVG exports the drawing without the editor chrome', async () => {
  const { canvas } = load();
  click(canvas, centre(node(canvas, 'Task_1')));
  const svg = canvas.toSVG();
  expect(svg).toContain('data-element-id="Task_1"');
  expect(svg).not.toContain('sf-outline');
  expect(svg).not.toContain('selected');
  expect(svg).not.toContain('tabindex');
  expect(svg).toMatch(/viewBox="[-\d.]+ [-\d.]+ [\d.]+ [\d.]+"/);
});

// --- choreography participants -------------------------------------------------------

/** A choreography task alone in a process, and an id generator. */
function build() {
  const moddle = freshModdle();
  const task = moddle.create('bpmn:ChoreographyTask', { id: 'Consent', name: 'Give consent' });
  const process = moddle.create('bpmn:Process', { id: 'Proc', flowElements: [task] });
  const definitions = moddle.create('bpmn:Definitions', { id: 'Defs', rootElements: [process] });
  task.$parent = process;
  process.$parent = definitions;
  definitions.$parent = null;
  return { definitions, task, ids: new IdGenerator() };
}

test('materializes two participants into a headless collaboration on first need', () => {
  const { definitions, task, ids } = build();

  const [top, bottom] = ensureChoreographyParticipants(task, ids)!;
  // Two named participants, told apart by name.
  expect(top.name).toBeTruthy();
  expect(bottom.name).toBeTruthy();
  expect(top.name).not.toBe(bottom.name);

  expect(task.get('participantRef')).toEqual([top, bottom]);
  expect(task.get('initiatingParticipantRef')).toBe(top);
  const collaboration = definitions.get('rootElements').find((r: any) => r.$type === 'bpmn:Collaboration');
  expect(collaboration).toBeTruthy();
  expect(collaboration.get('participants')).toEqual([top, bottom]);

  expect(readChoreographyBands(task)).toEqual({ top: top.name, bottom: bottom.name, initiator: 'top' });

  ensureChoreographyParticipants(task, ids);
  expect(collaboration.get('participants')).toHaveLength(2);
});

// --- the event bus ------------------------------------------------------------------

test('a command is a topic with one answering listener on the same bus the notifications use', async () => {
  // `send` is what makes the two mechanisms one: a leaf package (the canvas cannot import
  // `@modeler/*`) sends on the bus it already holds, and the fact lands on `CommandDone`.
  const bus = new EventBus();
  const seen: unknown[] = [];

  bus.on('ElementsChanged', () => { seen.push('a'); });
  bus.on('ElementsChanged', () => { seen.push('b'); });
  expect(bus.fire('ElementsChanged', { elements: [] }), 'a notification has no answer').toBeUndefined();
  expect(seen, 'every listener still runs, in subscription order').toEqual(['a', 'b']);

  bus.on('Undo', async (command: any) => `ran ${command.type}`);
  bus.on('CommandDone', (done) => seen.push(done));
  expect(await bus.send<string>({ type: 'Undo' })).toBe('ran Undo');
  // The fact is a message like any other: same `{ type, ... }` shape a command is sent in.
  expect(seen[2]).toEqual({ type: 'CommandDone', command: { type: 'Undo' }, result: 'ran Undo' });
  await expect(bus.send({ type: 'Nope' }), 'no handler').rejects.toThrow();
});
