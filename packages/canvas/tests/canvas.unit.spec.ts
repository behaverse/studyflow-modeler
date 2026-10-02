import { expect, test } from '@playwright/test';

import { renderSvg, type Canvas } from '@canvas/index.ts';
import type { SceneEdge, SceneNode } from '@canvas/study/scene.ts';
import { LINE_HEIGHT, labelMinSize } from '@canvas/study/text.ts';

import {
  centre,
  click,
  doubleClick,
  dragBy,
  edge,
  graphicsOf,
  hitAt,
  hover,
  installDocument,
  keyEvent,
  label,
  labelEditingOf,
  loadCanvas,
  loadYaml,
  node,
  pointerDown,
  pointerMove,
  pointerUp,
  rulesOf,
  sceneOf,
  svgOf,
  xmlOf,
  type Loaded,
} from './canvasHarness';

/**
 * The canvas, driven the way the app drives it: the public API for edits, pointer
 * events for gestures, and the file its study writes for what was written.
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
  graphicsOf(canvas, id)?.getAttribute('display') === 'none';

const load = (): Loaded => loadYaml(YAML);

// --- import and the round trip -------------------------------------------------

test('import builds one tree, with captions as elements of their own', async () => {
  const { canvas } = load();
  expect(node(canvas, 'Task_1').parent).toBeUndefined();
  expect(node(canvas, 'Task_In').parent).toBe(node(canvas, 'Sub_1'));
  expect(node(canvas, 'Sub_1').children).toContain(node(canvas, 'Task_In'));
  expect(sceneOf(canvas).children.map((el) => el.id)).not.toContain('Task_In');

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

  // The contents of a collapsed container exist but are not drawn, and the view says so.
  expect(isHiddenGraphics(canvas, 'Task_In')).toBe(true);
  expect(isHiddenGraphics(canvas, 'Task_1')).toBe(false);
  expect([canvas.draws('Task_In'), canvas.draws('Task_1')]).toEqual([false, true]);
});

test('the DI round trip keeps geometry, pinned captions and the collapse flag', async () => {
  const loaded = load();
  const xml = await xmlOf(loaded);
  expect(xml.match(/<bpmndi:BPMNLabel>/g) ?? []).toHaveLength(1);

  const again = loadYaml(YAML);
  await again.canvas.study.load(xml);
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

test('only the first diagram is drawn, and a further one is kept as the file holds it', async () => {
  // Another tool draws a collapsed sub-process's contents on a plane of their own.
  const xml = await xmlOf(load());
  const inner = xml.match(/\s*<bpmndi:BPMNShape [^>]*bpmnElement="Task_In"[\s\S]*?<\/bpmndi:BPMNShape>/)![0];
  const subDiagram = `<bpmndi:BPMNDiagram id="Diagram_Sub"><bpmndi:BPMNPlane id="Plane_Sub" bpmnElement="Sub_1">${inner}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`;
  const { canvas } = await loadCanvas(xml.replace(inner, '').replace('</bpmndi:BPMNDiagram>', `</bpmndi:BPMNDiagram>${subDiagram}`));
  expect(canvas.study.get('Task_In')).toBeUndefined();
  expect(node(canvas, 'Sub_1').children).toEqual([]);
  expect(await canvas.study.toXml()).toContain('id="Diagram_Sub"');
});

// --- creating -------------------------------------------------------------------------

test('add places a shape centred where it is asked and files its business object; a container drawn closed takes nothing', async () => {
  const { canvas } = load();
  const created = node(canvas, canvas.study.add({ type: 'bpmn:Task', at: { x: 600, y: 118 } }).id!);
  expect({ x: created.x, y: created.y, width: created.width, height: created.height }).toEqual({ x: 550, y: 78, width: 100, height: 80 });
  expect(sceneOf(canvas).children).toContain(created);
  expect(canvas.study.model.holderOf(created.element)).toMatchObject({ parent: { id: 'Process_1' }, key: 'flowElements' });

  expect(canvas.study.add({ type: 'bpmn:Task', at: centre(node(canvas, 'Sub_1')) })).toMatchObject({ ok: false });
});

test('a boundary event attaches to the activity it is dropped on', async () => {
  const { canvas } = load();
  const boundary = node(canvas, canvas.study.add({ type: 'bpmn:BoundaryEvent', at: centre(node(canvas, 'Task_1')) }).id!);
  expect(boundary.element.attachedToRef).toBe('Task_1');
  expect(boundary.parent).toBeUndefined();
});

test('a palette create follows the pointer and lands, grid-snapped, where it is released: selected, closed when a container, and named when a task', async () => {
  // Every glyph resolves, so the markers are drawn.
  const { canvas } = loadYaml(YAML, { iconResolver: () => ({ content: '<path d="M0 0h24v24H0z"/>', viewBox: '0 0 24 24' }) });
  const drop = (type: string, at: { x: number; y: number }): SceneNode => {
    expect(canvas.startCreate(undefined, { type })).toBe(true);
    pointerMove(canvas, at);
    pointerUp(canvas, at);
    return node(canvas, canvas.selection[0]);
  };
  const gateway = drop('bpmn:ExclusiveGateway', { x: 703, y: 297 });
  expect(gateway.type).toBe('bpmn:ExclusiveGateway');
  expect(centre(gateway)).toEqual({ x: 700, y: 300 });
  expect(labelEditingOf(canvas).isActive()).toBe(false);

  // Closed, with the marker that says it holds more.
  const sub = drop('bpmn:SubProcess', { x: 1100, y: 300 });
  expect(sub.isExpanded).toBe(false);
  expect(graphicsOf(canvas, sub.id)!.querySelector('[data-icon-key="subprocess"]')).not.toBeNull();

  expect(drop('bpmn:Task', { x: 900, y: 300 }).type).toBe('bpmn:Task');
  expect(labelEditingOf(canvas).isActive(), 'a task is named as it lands').toBe(true);
});

// --- connecting --------------------------------------------------------------------

test('connect mints a routed sequence flow and wires both ends', async () => {
  const { canvas } = load();
  const task = node(canvas, canvas.study.add({ type: 'bpmn:Task', at: { x: 600, y: 118 } }).id!);
  const gateway = node(canvas, 'Gateway_1');
  const flow = edge(canvas, canvas.study.connect({ from: 'Gateway_1', to: task.id }).id!);
  expect(flow.type).toBe('bpmn:SequenceFlow');
  expect(flow.source).toBe(gateway);
  expect(flow.target).toBe(task);
  expect(flow.waypoints.length).toBeGreaterThanOrEqual(2);
  expect(flow.waypoints[0].x).toBe(410);
  expect(flow.waypoints.at(-1)!.x).toBe(550);
  expect([flow.element.sourceRef, flow.element.targetRef]).toEqual([gateway.id, task.id]);
  expect(graphicsOf(canvas, flow.id)).toBeTruthy();

  // Nothing flows out of an end event.
  expect(canvas.study.connect({ from: 'End_1', to: task.id })).toMatchObject({ ok: false });
});

test('a new default redraws the flow that lost the slash as well as the one that gained it', async () => {
  const { canvas } = load();
  const gateway = node(canvas, 'Gateway_1');
  const toEnd = edge(canvas, 'Flow_3');
  const toTask = edge(canvas, canvas.study.connect({ from: 'Gateway_1', to: 'Task_1' }).id!);
  const slash = (flow: SceneEdge) => graphicsOf(canvas, flow.id)!.querySelector('.sf-connection-line')!.getAttribute('marker-start');
  const makeDefault = (flow: SceneEdge) => canvas.study.revise(gateway.id, (element) => { element.default = flow.id; });
  makeDefault(toEnd);
  expect(slash(toEnd)).toContain('sf-marker-default');
  makeDefault(toTask);
  expect(slash(toTask)).toContain('sf-marker-default');
  expect(slash(toEnd)).toBeNull();
});

test('a connect gesture drops the flow on the shape under the pointer', async () => {
  const { canvas } = load();
  const task = node(canvas, 'Task_1');
  const end = node(canvas, 'End_1');
  expect(canvas.startConnect(task.id)).toBe(true);
  pointerMove(canvas, centre(end));
  pointerUp(canvas, centre(end));
  const flow = edge(canvas, canvas.selection[0]);
  expect(flow.kind).toBe('edge');
  expect(flow.source).toBe(task);
  expect(flow.target).toBe(end);
});

test('a data shape and an activity connect with a data input association', async () => {
  const { canvas } = load();
  const data = node(canvas, 'Data_1');
  const task = node(canvas, 'Task_1');
  const association = edge(canvas, canvas.study.connect({ from: data.id, to: task.id }).id!);
  expect(association.type).toBe('bpmn:DataInputAssociation');
  expect(task.element.dataInputAssociations).toContain(association.element);
  expect(association.element.sourceRef).toEqual([data.id]);

  // A step may draw what the data it reads holds (a glyph a Parameters object sets): editing the data redraws its readers.
  const taskBefore = graphicsOf(canvas, 'Task_1');
  const gatewayBefore = graphicsOf(canvas, 'Gateway_1');
  canvas.study.set({ id: data.id, attribute: 'name', value: 'Rows' });
  expect(graphicsOf(canvas, 'Task_1')).not.toBe(taskBefore);
  expect(graphicsOf(canvas, 'Gateway_1')).toBe(gatewayBefore);
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
  expect(graphicsOf(canvas, 'Task_1')!.getAttribute('transform')).toMatch(/^translate\(\s*240[ ,]+140\s*\)$/);
  expect(sceneOf(canvas).revision).toBeGreaterThan(0);
});

test('Escape abandons a drag and puts the snapshot back', async () => {
  const { canvas } = load();
  const task = node(canvas, 'Task_1');
  const caption = label(canvas, 'Start_1_label');
  const textAt = (id: string) => [...graphicsOf(canvas, id)!.querySelectorAll('text')].map((t) => `${t.getAttribute('x')},${t.getAttribute('y')}`);
  const snapshot = () => ({
    task: { x: task.x, y: task.y, width: task.width, height: task.height },
    flows: ['Flow_1', 'Flow_2'].map((id) => edge(canvas, id).waypoints.map((p) => ({ ...p }))),
    caption: { x: caption.x, y: caption.y, width: caption.width, height: caption.height, pinned: caption.pinned },
    drawn: [task.id, caption.id].map(textAt),
  });
  const before = snapshot();
  // [the drag, where a click selects, where the drag grabs]: each keeps a snapshot of its own.
  const CASES: [label: string, select: { x: number; y: number }, grab: () => { x: number; y: number }][] = [
    ['a move', centre(task), () => centre(task)],
    ['a resize', centre(task), () => ({ x: task.x + task.width + 4, y: task.y + task.height + 4 })],
    ['a bend drawn out of a flow', { x: 330, y: 118 }, () => ({ x: 330, y: 118 })],
    ['a caption\'s corner', centre(caption), () => ({ x: caption.x + caption.width + 4, y: caption.y + caption.height + 4 })],
  ];
  for (const [what, select, grab] of CASES) {
    click(canvas, select);
    const from = grab();
    pointerDown(canvas, from);
    pointerMove(canvas, { x: from.x + 33, y: from.y + 47 });
    expect(snapshot(), `${what} changes something`).not.toEqual(before);
    svgOf(canvas).ownerDocument!.dispatchEvent(keyEvent('keydown', { key: 'Escape' }));
    pointerUp(canvas, { x: from.x + 33, y: from.y + 47 });
    expect(snapshot(), what).toEqual(before);
  }
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
  expect({ width: task.width, height: task.height }).toEqual(rulesOf(canvas).minSizeFor(task));
  // An event has a fixed footprint: no handles to grab.
  const start = node(canvas, 'Start_1');
  click(canvas, centre(start));
  expect(canvas.getContainer().querySelector('.sf-handles[data-overlay-for="Start_1"]')).toBeNull();
});

test('a press on a selected flow drags a new bendpoint out of it, and a hovered flow\'s bendpoint drags where it is', async () => {
  const { canvas } = load();
  const flow = edge(canvas, 'Flow_2');
  click(canvas, { x: 330, y: 118 });
  expect(canvas.selection).toEqual([flow.id]);
  dragBy(canvas, { x: 330, y: 118 }, { x: 330, y: 180 });
  expect(flow.waypoints).toHaveLength(3);
  expect(flow.waypoints[1]).toEqual({ x: 330, y: 180 });

  // Unselected, the flow shows its bendpoint while hovered: grabbing it moves it, and selects the flow.
  click(canvas, { x: 700, y: 700 });
  hover(canvas, { x: 330, y: 180 });
  dragBy(canvas, { x: 330, y: 180 }, { x: 330, y: 210 });
  expect(flow.waypoints).toHaveLength(3);
  expect(flow.waypoints[1]).toEqual({ x: 330, y: 210 });
  expect(canvas.selection).toEqual([flow.id]);
});

test('a bend dragged keeps the runs that met it square, a dock sliding along its shape', async () => {
  const { canvas } = loadYaml(`id: Defs_Z
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_Z:
  type: Process
  flowElements:
    From:
      type: Task
      bounds: 100 100 100 80
    To:
      type: Task
      bounds: 400 300 100 80
    Z:
      sourceRef: From
      targetRef: To
      waypoint: 200,140 300,140 300,340 400,340
`);
  const z = edge(canvas, 'Z');
  canvas.select('Z');
  dragBy(canvas, { x: 300, y: 140 }, { x: 320, y: 160 });
  // The upright run came along sideways; the level one slid down the task's side with it.
  expect(z.waypoints).toEqual([{ x: 200, y: 160 }, { x: 320, y: 160 }, { x: 320, y: 340 }, { x: 400, y: 340 }]);
});

// --- selection and deletion -----------------------------------------------------------

test('click selects, Shift+click toggles, and an empty click clears', async () => {
  const { canvas } = load();
  const task = node(canvas, 'Task_1');
  const gateway = node(canvas, 'Gateway_1');
  click(canvas, centre(task));
  expect(canvas.selection).toEqual([task.id]);
  pointerDown(canvas, centre(gateway), { shiftKey: true });
  pointerUp(canvas, centre(gateway), { shiftKey: true });
  expect(canvas.selection).toEqual([task.id, gateway.id]);
  pointerDown(canvas, centre(task), { shiftKey: true });
  pointerUp(canvas, centre(task), { shiftKey: true });
  expect(canvas.selection).toEqual([gateway.id]);
  click(canvas, { x: 700, y: 700 });
  expect(canvas.selection).toEqual([]);
});

test('Delete removes the selection with its flows from the scene and the document', async () => {
  const { canvas } = load();
  const task = node(canvas, 'Task_1');
  click(canvas, centre(task));
  canvas.getContainer().dispatchEvent(keyEvent('keydown', { key: 'Delete' }));
  expect(canvas.study.get('Task_1')).toBeUndefined();
  expect(canvas.study.get('Flow_1')).toBeUndefined();
  expect(canvas.study.get('Flow_2')).toBeUndefined();
  expect(canvas.study.get('Flow_2_label')).toBeUndefined();
  expect(graphicsOf(canvas, 'Task_1')).toBeUndefined();
  const { model } = canvas.study;
  expect([model.get('Task_1'), model.get('Flow_1')]).toEqual([undefined, undefined]);
  expect(node(canvas, 'Start_1').outgoing).toEqual([]);
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
  const { canvas } = loaded;
  const { model } = canvas.study;
  const process = model.get('Study_1')!;
  const { documentation } = process;

  // The root turns collaboration, and the study stays the root: same id, name, documentation, Study.
  const pool = node(canvas, canvas.study.add({ type: 'bpmn:Participant', at: { x: 300, y: 118 } }).id!);
  const collaboration = sceneOf(canvas).root;
  expect(canvas.study.root).toMatchObject({ id: 'Study_1', type: 'bpmn:Collaboration' });
  expect(collaboration).toMatchObject({ id: 'Study_1', name: 'Pilot', documentation, extensionElements: [{ type: 'studyflow:Study' }] });
  // The process is the pool's now, under an id of its own; its properties' run state follows it.
  expect(process.id).toMatch(/^Process_/);
  expect(process.type).toBe('bpmn:Process');
  expect(process.name).toBeUndefined();
  expect(model.study.state).toEqual({ [process.id!]: { trials: 3 } });
  const note = node(canvas, canvas.study.add({ type: 'bpmn:TextAnnotation', at: { x: 900, y: 600 } }).id!);
  expect(collaboration.artifacts).toEqual([note.element]);
  // One pool of two going leaves the collaboration the root.
  canvas.study.remove({ ids: [canvas.study.add({ type: 'bpmn:Participant', at: { x: 300, y: 900 } }).id!] });
  expect(sceneOf(canvas).root).toBe(collaboration);

  canvas.study.remove({ ids: [pool.id] });
  expect(sceneOf(canvas).root).toBe(process);
  expect(canvas.study.root).toMatchObject({ id: 'Study_1', type: 'bpmn:Process' });
  expect(process).toMatchObject({ id: 'Study_1', type: 'studyflow:Study', name: 'Pilot', documentation });
  expect(model.study.state).toEqual({ Study_1: { trials: 3 } });
  expect(process.artifacts).toEqual([note.element]);
  expect(model.study.roots).toEqual([process]);
  expect(await xmlOf(loaded)).toContain('bpmnElement="Study_1"');
});

test('deleting a caption clears its owner\'s name', async () => {
  const { canvas } = load();
  const start = node(canvas, 'Start_1');
  canvas.select('Start_1_label');
  canvas.deleteSelection();
  expect(start.element.name).toBeUndefined();
  expect(canvas.study.get('Start_1_label')).toBeUndefined();
  expect(graphicsOf(canvas, 'Start_1_label')).toBeUndefined();
  expect(node(canvas, 'Start_1')).toBe(start);
});

test('a host element anchored to elements is shown beside them, and steps aside for a gesture and for what the view does not draw', async () => {
  const { canvas } = load();
  const pad = installDocument().createElement('div');
  const task = node(canvas, 'Task_1');
  // The view's frame on the page, the size it draws at so the scale stays 1: what the element is kept inside.
  const { width, height } = canvas.viewbox;
  canvas.getContainer().getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height }) as DOMRect;
  /** Where the element sits from the task's box on screen. */
  const offset = () => {
    const box = canvas.screenBox('Task_1')!;
    const [x, y] = pad.style.transform.match(/-?[\d.]+/g)!.map(Number);
    return { right: x - (box.x + box.width), top: y - box.y };
  };
  // 8px right of the selection outline, which stands 4 out from the shape, and level with the outline's top.
  const beside = { right: 12, top: -4 };

  canvas.anchor(pad, ['Task_1']);
  expect(pad.style.visibility).toBe('visible');
  expect(offset()).toEqual(beside);
  pointerDown(canvas, centre(task));
  pointerMove(canvas, { x: centre(task).x + 60, y: centre(task).y + 40 });
  expect(pad.style.visibility, 'out of the way while the shape is dragged').toBe('hidden');
  pointerUp(canvas, { x: centre(task).x + 60, y: centre(task).y + 40 });
  expect(pad.style.visibility, 'back once it lands').toBe('visible');
  expect(offset(), 'beside where it landed').toEqual(beside);

  canvas.anchor(pad, ['Task_In']);
  expect(pad.style.visibility, 'the contents of a closed container are not drawn').toBe('hidden');
  canvas.setScope('Sub_1');
  expect(pad.style.visibility, 'until the view drills in').toBe('visible');
  canvas.anchor(pad, null);
});

test('a mark is a class on the element, kept through its redraws, and cleared by id', async () => {
  const { canvas } = load();
  const marked = (id: string): boolean => graphicsOf(canvas, id)!.classList.contains('sf-mark-dimmed');

  canvas.mark(['Task_1', 'Nope'], 'dimmed');
  expect(marked('Task_1')).toBe(true);
  canvas.study.set({ id: 'Task_1', attribute: 'name', value: 'Renamed' });
  expect(marked('Task_1'), 'redrawn, still marked').toBe(true);
  canvas.mark('Task_1', 'dimmed', false);
  expect(marked('Task_1')).toBe(false);
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
  expect(canvas.selection).toEqual([caption.id]);
  // A selected caption offers its four corner handles, as a resizable shape does.
  expect(svgOf(canvas).querySelectorAll('.sf-handle')).toHaveLength(4);
  dragBy(canvas, from, { x: from.x + 30, y: from.y + 30 });
  expect(caption.pinned).toBe(true);
  expect(Math.round(centre(caption).x - from.x)).toBe(30);
  expect({ x: start.x, y: start.y }).toEqual({ x: 100, y: 100 });
  expect(await xmlOf(loaded)).toMatch(/Start_1_di[\s\S]*?<bpmndi:BPMNLabel>/);
});

test('dragging a caption\'s corner pins it and keeps it tall enough for its text', async () => {
  const { canvas } = load();
  const name = 'Give consent first';
  canvas.study.set({ id: 'Start_1', attribute: 'name', value: name });
  const caption = label(canvas, 'Start_1_label');
  expect(caption.pinned).toBe(false);
  click(canvas, centre(caption));
  // The corner pulled up and in past every word: no narrower than the widest, as tall as the lines it then wraps to.
  const corner = { x: caption.x + caption.width + 4, y: caption.y + caption.height + 4 };
  dragBy(canvas, corner, { x: corner.x - 200, y: corner.y - 200 });
  expect(caption.pinned).toBe(true);
  expect(caption.width).toBeCloseTo(labelMinSize(name).width, 6);
  const lines = graphicsOf(canvas, caption.id)!.querySelectorAll('text').length;
  expect(lines).toBe(3);
  expect(caption.height).toBe(lines * LINE_HEIGHT);
});

test('renaming through the inline editor re-fits a caption, and naming an unnamed flow mints one', async () => {
  const { canvas } = load();
  const start = node(canvas, 'Start_1');
  const before = label(canvas, 'Start_1_label').width;
  expect(canvas.editLabel(start.id)).toBe(true);
  labelEditingOf(canvas).setValue('A much longer caption');
  labelEditingOf(canvas).complete();
  expect(start.element.name).toBe('A much longer caption');
  const caption = label(canvas, 'Start_1_label');
  expect(caption.width).toBeGreaterThan(before);
  expect(Math.abs(centre(caption).x - centre(start).x)).toBeLessThan(0.01);
  expect(graphicsOf(canvas, 'Start_1_label')!.textContent).toContain('caption');

  // Flow_1 has no name, so no caption until it gets one.
  const flow = edge(canvas, 'Flow_1');
  expect(canvas.study.get('Flow_1_label')).toBeUndefined();
  expect(canvas.editLabel(flow.id)).toBe(true);
  labelEditingOf(canvas).setValue('hello');
  labelEditingOf(canvas).complete();
  expect(label(canvas, 'Flow_1_label').owner).toBe(flow);
  expect(graphicsOf(canvas, 'Flow_1_label')!.textContent).toContain('hello');
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
  const flow = edge(canvas, canvas.study.connect({ from: 'Start_1', to: sub.id }).id!);
  const docked = { ...flow.waypoints.at(-1)! };
  expect(canvas.study.expand({ id: sub.id }).changed).toContain(sub.id);
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
  expect(canvas.study.collapse({ id: sub.id }).changed).toContain(sub.id);
  expect({ width: sub.width, height: sub.height }).toEqual({ width: 100, height: 80 });
  expect(isHiddenGraphics(canvas, 'Task_In')).toBe(true);
});

test('a double click opens or shuts a container in place; on an open one\'s caption strip, or with `e`, it renames it', async () => {
  const { canvas } = load();
  const scene = sceneOf(canvas);
  const sub = node(canvas, 'Sub_1');

  // Collapsed, a double click on its body expands it where it stands, as one edit, and does not drill in.
  let revision = scene.revision;
  doubleClick(canvas, centre(sub));
  expect(sub.isExpanded).toBe(true);
  expect(scene.revision).toBe(revision + 1);
  expect(canvas.scope).toBeUndefined();
  expect(isHiddenGraphics(canvas, 'Task_In')).toBe(false);

  // Expanded, a double click on its body, clear of its contents and its caption strip, collapses it.
  revision = scene.revision;
  doubleClick(canvas, { x: sub.x + 10, y: sub.y + sub.height - 10 });
  expect(sub.isExpanded).toBe(false);
  expect(scene.revision).toBe(revision + 1);
  expect(isHiddenGraphics(canvas, 'Task_In')).toBe(true);

  // On an expanded container's caption strip, it opens the name editor instead.
  canvas.study.expand({ id: sub.id });
  doubleClick(canvas, { x: sub.x + 10, y: sub.y + 5 });
  expect(sub.isExpanded).toBe(true);
  expect(labelEditingOf(canvas).getSession()?.element).toBe(sub);
  labelEditingOf(canvas).cancel();
  // So does `e` on the selected container.
  canvas.select(sub.id);
  canvas.getContainer().dispatchEvent(keyEvent('keydown', { key: 'e' }));
  expect(labelEditingOf(canvas).getSession()?.element).toBe(sub);
});

test('drilling into a container shows only its contents until the trail leads back out', async () => {
  const { canvas } = load();
  const sub = node(canvas, 'Sub_1');
  expect(canvas.setScope('Task_1'), 'a task holds no contents to show').toBe(false);
  expect(canvas.setScope('Sub_1')).toBe(true);
  expect(canvas.scope).toBe('Sub_1');
  expect(canvas.scopePath).toEqual(['Process_1', 'Sub_1']);
  expect(isHiddenGraphics(canvas, 'Task_1')).toBe(true);
  expect(isHiddenGraphics(canvas, 'Task_In')).toBe(false);
  expect([canvas.draws('Task_1'), canvas.draws('Task_In')]).toEqual([false, true]);
  expect(hitAt(canvas, centre(node(canvas, 'Task_1')))).toBeUndefined();
  expect(hitAt(canvas, centre(node(canvas, 'Task_In')))).toBe(node(canvas, 'Task_In'));
  // A shape dropped while drilled in belongs to the container.
  canvas.startCreate(undefined, { type: 'bpmn:Task' });
  pointerMove(canvas, { x: 700, y: 400 });
  pointerUp(canvas, { x: 700, y: 400 });
  labelEditingOf(canvas).cancel();
  const dropped = node(canvas, canvas.selection[0]);
  expect(dropped.parent).toBe(sub);
  expect(sub.element.flowElements).toContain(dropped.element);
  expect(canvas.setScope(undefined)).toBe(true);
  expect(canvas.scopePath).toEqual(['Process_1']);
  expect(isHiddenGraphics(canvas, 'Task_1')).toBe(false);
});

test('an undo draws the study again over what is drawn and keeps the view on it, by id: the scope, the camera and the selection', async () => {
  const { canvas } = load();
  canvas.setScope('Sub_1');
  canvas.setViewbox({ x: 380, y: 380, width: 300, height: 200 });
  const viewbox = canvas.viewbox;
  canvas.select('Task_In');
  canvas.study.set({ id: 'Task_In', attribute: 'name', value: 'Deeper' });
  const heard: string[] = [];
  canvas.on('scope', (scope) => heard.push(`scope ${scope ?? canvas.study.root.id}`));
  canvas.on('select', (ids) => heard.push(`select ${ids}`));

  expect(canvas.study.undo().ok).toBe(true);

  // Nothing is cleared on the way: a host that shows the scope when it hears it ends on the selection, said last.
  expect(heard).toEqual(['scope Sub_1', 'select Task_In']);

  const drawn = graphicsOf(canvas, 'Task_In')!.textContent;
  expect(drawn, 'drawn from the document as it was').toContain('Deep');
  expect(drawn).not.toContain('Deeper');
  expect(canvas.scope).toBe('Sub_1');
  expect(canvas.viewbox).toEqual(viewbox);
  expect(canvas.selection).toEqual(['Task_In']);
  expect(graphicsOf(canvas, 'Task_In')!.classList.contains('selected'), 'the element as it is drawn now, not as it was').toBe(true);

  // Drilled into nothing, with nothing selected, it still says what it shows: the root, another object now.
  canvas.setScope(undefined);
  canvas.study.set({ id: 'Task_1', attribute: 'name', value: 'Other' });
  heard.length = 0;
  canvas.study.undo();
  expect(heard).toEqual(['scope Process_1']);
});

test('a shape dropped into a container is drawn above it, even one drawn before the container', async () => {
  const { canvas } = load();
  const task = node(canvas, canvas.study.add({ type: 'bpmn:Task', at: { x: 800, y: 118 } }).id!);
  const sub = node(canvas, canvas.study.add({ type: 'bpmn:SubProcess', expanded: true, at: { x: 900, y: 400 } }).id!);
  click(canvas, centre(task));
  dragBy(canvas, centre(task), centre(sub));
  expect(task.parent).toBe(sub);
  const drawn = Array.from(graphicsOf(canvas, sub.id)!.parentNode!.children);
  expect(drawn.indexOf(graphicsOf(canvas, task.id)!)).toBeGreaterThan(drawn.indexOf(graphicsOf(canvas, sub.id)!));
});

test('an edit made of several is one commit: one revision, one change', async () => {
  const { canvas } = load();
  const scene = sceneOf(canvas);
  let fired = 0;
  canvas.study.on('change', () => { fired += 1; });
  const sub = node(canvas, 'Sub_1');
  canvas.study.expand({ id: sub.id });
  const loose = node(canvas, canvas.study.add({ type: 'bpmn:Task', at: { x: 800, y: 118 } }).id!);
  const CASES: [what: string, edit: () => void][] = [
    ['a replace: a new shape, the flows moved onto it, the old one deleted', () => canvas.study.replace({ id: 'Task_1', type: 'bpmn:UserTask' })],
    ['an append: a shape and the flow to it', () => canvas.study.append({ from: 'Gateway_1', type: 'bpmn:Task' })],
    ['a move into a container: the move and the change of container', () => {
      click(canvas, centre(loose));
      dragBy(canvas, centre(loose), { x: sub.x + sub.width - 60, y: sub.y + sub.height - 50 });
    }],
    ['a delete that takes a caption: the name cleared and the shape gone', () => canvas.study.remove({ ids: ['Start_1', 'End_1_label'] })],
  ];
  for (const [what, edit] of CASES) {
    const revision = scene.revision;
    fired = 0;
    edit();
    labelEditingOf(canvas).cancel();
    expect({ revisions: scene.revision - revision, fired }, what).toEqual({ revisions: 1, fired: 1 });
  }
  // The move re-filed the shape: the container holds it, in the scene and in the document.
  expect(loose.parent).toBe(sub);
  expect(sub.element.flowElements).toContain(loose.element);
  expect(scene.children).not.toContain(loose);
  expect(canvas.study.get('Start_1')).toBeUndefined();
  expect(node(canvas, 'End_1').element.name).toBeUndefined();
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
  expect(sub.element.flowElements).toContain(task.element);
  expect(lane.element.flowNodeRef).toContain(task.id);
});

// --- keyboard, colour, font -------------------------------------------------------------

test('Ctrl+A selects everything on screen, A asks for the append menu, the arrows nudge the selection, Ctrl+Z undoes and Shift+Ctrl+Z redoes', async () => {
  const { canvas } = load();
  const container = canvas.getContainer();
  container.dispatchEvent(keyEvent('keydown', { key: 'a', ctrlKey: true }));
  const ids = canvas.selection;
  expect(ids).toContain('Task_1');
  expect(ids).toContain('Flow_1');
  expect(ids).not.toContain('Task_In');
  expect(ids).not.toContain('Start_1_label');
  const task = node(canvas, 'Task_1');
  canvas.select(task.id);
  const asked: (readonly string[])[] = [];
  canvas.on('appendMenu', (selected) => asked.push(selected));
  container.dispatchEvent(keyEvent('keydown', { key: 'a' }));
  expect(asked, 'the host answers with its menu, on the selection by id').toEqual([['Task_1']]);
  container.dispatchEvent(keyEvent('keydown', { key: 'ArrowRight' }));
  container.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown', shiftKey: true }));
  // A plain arrow is a fine step, Shift a coarse one.
  const step = { x: task.x - 200, y: task.y - 78 };
  expect(step.x).toBeGreaterThan(0);
  expect(step.y).toBeGreaterThan(step.x);

  const at = (): { x: number; y: number } => ({ x: node(canvas, 'Task_1').x, y: node(canvas, 'Task_1').y });
  const nudged = at();
  container.dispatchEvent(keyEvent('keydown', { key: 'z', ctrlKey: true }));
  expect(at(), 'the run of nudges undone at once').toEqual({ x: 200, y: 78 });
  container.dispatchEvent(keyEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true }));
  expect(at()).toEqual(nudged);
});

test('style paints the element and the colour survives the round trip', async () => {
  const loaded = load();
  const { canvas } = loaded;
  const task = node(canvas, 'Task_1');
  canvas.study.style({ ids: ['Task_1', 'Flow_1'], fill: '#dde8fa', stroke: '#728cb9' });
  expect({ fill: task.fill, stroke: task.stroke }).toEqual({ fill: '#dde8fa', stroke: '#728cb9' });
  expect(graphicsOf(canvas, 'Task_1')!.querySelector('rect:not(.sf-outline)')!.getAttribute('fill')).toBe('#dde8fa');
  expect(edge(canvas, 'Flow_1').stroke).toBe('#728cb9');
  const xml = await xmlOf(loaded);
  expect(xml).toContain('background-color="#dde8fa"');
  const again = await loadCanvas(xml);
  expect(node(again.canvas, 'Task_1').fill).toBe('#dde8fa');
  canvas.study.style({ ids: ['Task_1'], fill: null, stroke: null });
  expect(task.fill).toBeUndefined();
});

test('style restyles the caption and the font survives the round trip', async () => {
  const loaded = load();
  const { canvas } = loaded;
  const task = node(canvas, 'Task_1');
  canvas.study.style({ ids: ['Task_1', 'Flow_2'], font: { bold: true, italic: true, align: 'right', color: '#4a6f9c' } });
  expect(task.font).toEqual({ bold: true, italic: true, align: 'right', color: '#4a6f9c' });
  const text = graphicsOf(canvas, 'Task_1')!.querySelector('text.sf-label')!;
  const BOLD = /^(bold|[6-9]00)$/;
  expect(text.getAttribute('font-weight')).toMatch(BOLD);
  expect(text.getAttribute('text-anchor')).toBe('end');
  expect(text.getAttribute('fill')).toBe('#4a6f9c');
  // A flow's caption is an element of its own, painted from the flow's font.
  expect(graphicsOf(canvas, 'Flow_2_label')!.querySelector('text.sf-label')!.getAttribute('font-weight')).toMatch(BOLD);
  const xml = await xmlOf(loaded);
  expect(xml).toContain('studyflow:font="bold italic right #4a6f9c"');
  const again = await loadCanvas(xml);
  expect(node(again.canvas, 'Task_1').font).toEqual({ bold: true, italic: true, align: 'right', color: '#4a6f9c' });
  canvas.study.style({ ids: ['Task_1'], font: { bold: false, italic: false, align: null, color: null } });
  expect(task.font).toBeUndefined();
});

test('a picture of the study leaves out the editor\'s chrome, and is framed on the drawing', async () => {
  const { canvas } = load();
  click(canvas, centre(node(canvas, 'Task_1')));
  const svg = renderSvg(canvas.study);
  expect(svg).toContain('data-element-id="Task_1"');
  expect(svg).not.toContain('sf-outline');
  expect(svg).not.toContain('selected');
  expect(svg).not.toContain('tabindex');
  expect(svg).toMatch(/viewBox="[-\d.]+ [-\d.]+ [\d.]+ [\d.]+"/);
});
