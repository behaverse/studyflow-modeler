import { expect, test } from '@playwright/test';

import { getExtensionType } from '@core/element';
import { Canvas, defaultSizeFor } from '@canvas/index.ts';
import { createShape } from '@canvas/interaction/create.ts';
import type { SceneNode } from '@canvas/model/scene.ts';
import type { ElementChangedEvent } from '@canvas/model/writeback.ts';

import { freshModdle, installDocument, loadCanvas, pointerDown, pointerMove, pointerUp, keyEvent, type Loaded } from './canvasHarness';

/**
 * P4 palette create gesture (design §3 `interaction/create.ts`, §1 "add shape").
 *
 * The contract: an accepted drop mints BOTH halves into the LIVE moddle tree — the
 * business object into its container's `flowElements` (or `artifacts`, or the pool's
 * `processRef`) and a `bpmndi:BPMNShape` + `dc:Bounds` into the plane — so
 * re-serializing that same `Definitions` with `bpmn-moddle` emits the new element
 * and its geometry. A rejected drop writes nothing at all: no business object, no
 * DI, no revision bump.
 *
 * jsdom via `setDocument`, same setup as the other `canvas-*` specs; pointer
 * gestures are dispatched as real events, with client coordinates derived from
 * diagram points through `viewport.toScreen` (which round-trips exactly under
 * jsdom's zero-sized layout).
 */

installDocument();

// --- fixtures ----------------------------------------------------------------

/** A plain process: one start event and one task, well apart so drops land in space. */
const PROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_1" name="Task" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** A collaboration with one pool, for container writeback (`processRef.flowElements`). */
const POOL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_2" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_1" name="Lab" processRef="Process_2" />
  </bpmn:collaboration>
  <bpmn:process id="Process_2" isExecutable="false">
    <bpmn:startEvent id="Start_2" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_2">
    <bpmndi:BPMNPlane id="Plane_2" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="100" y="100" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_2_di" bpmnElement="Start_2">
        <dc:Bounds x="150" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** A start event joined to a task by a sequence flow, for insert-on-flow feedback. */
const FLOW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_3" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="Task"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_3">
    <bpmndi:BPMNPlane id="Plane_3" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="240" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="240" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(xml = PROCESS_XML): Promise<Loaded> {
  return loadCanvas(xml);
}

// --- live-tree readers (never the scene) -------------------------------------

function process(definitions: any, id = 'Process_1'): any {
  return definitions.rootElements.find((el: any) => el.id === id);
}

function planeElements(definitions: any): any[] {
  return definitions.diagrams[0].plane.planeElement ?? [];
}

function diShape(definitions: any, id: string): any {
  return planeElements(definitions)
    .find((pe: any) => pe.$type === 'bpmndi:BPMNShape' && pe.bpmnElement?.id === id);
}

async function roundTrip(loaded: Loaded): Promise<{ xml: string; reloaded: any }> {
  const { xml } = await loaded.moddle.toXML(loaded.definitions);
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  return { xml, reloaded };
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

// --- prototypes --------------------------------------------------------------

test('createShape turns a descriptor into a detached, rule-judgeable prototype', () => {
  const prototype = createShape({ type: 'bpmn:Task', attrs: { name: 'Read me' } });
  expect(prototype.kind).toBe('prototype');
  expect(prototype.type).toBe('bpmn:Task');
  expect({ width: prototype.width, height: prototype.height }).toEqual({ width: 100, height: 80 });
  // No scene identity at all — that is the point: `shape.create` is asked BEFORE
  // the element exists.
  expect((prototype as { id?: string }).id).toBeUndefined();
  expect(prototype.businessObject).toBeUndefined();

  // Idempotent: a prototype handed back in is passed through unchanged.
  expect(createShape(prototype)).toBe(prototype);

  // Explicit sizes win over the per-category defaults.
  const pool = createShape({ type: 'bpmn:Participant', width: 400, height: 120 });
  expect({ width: pool.width, height: pool.height }).toEqual({ width: 400, height: 120 });
});

test('default footprints follow the studyflow vocabulary (design §2)', () => {
  expect(defaultSizeFor('bpmn:StartEvent')).toEqual({ width: 36, height: 36 });
  expect(defaultSizeFor('bpmn:ExclusiveGateway')).toEqual({ width: 50, height: 50 });
  expect(defaultSizeFor('bpmn:UserTask')).toEqual({ width: 100, height: 80 });
  expect(defaultSizeFor('bpmn:SubProcess')).toEqual({ width: 100, height: 80 });
  expect(defaultSizeFor('bpmn:SubProcess', true)).toEqual({ width: 350, height: 200 });
  expect(defaultSizeFor('bpmn:TextAnnotation')).toEqual({ width: 100, height: 30 });
});

// --- the create drop ---------------------------------------------------------

test('dropping a Task mints the business object AND the BPMNShape, and toXML emits both', async () => {
  const loaded = await load();
  const { canvas, definitions } = loaded;
  const scene = canvas.getScene()!;
  const changed: string[] = [];
  canvas.getEventBus().on<ElementChangedEvent>('element.changed', (e) => changed.push(e.element.id));

  const beforeFlowElements = process(definitions).flowElements.length;
  const beforePlaneElements = planeElements(definitions).length;
  const revision = scene.revision;

  const created = canvas.createElement({ type: 'bpmn:Task', attrs: { name: 'Fresh' } }, { x: 400, y: 400 });
  expect(created).toBeDefined();
  const task = created!;

  // Scene: centred on the drop point with the palette footprint.
  expect({ x: task.x, y: task.y, width: task.width, height: task.height })
    .toEqual({ x: 350, y: 360, width: 100, height: 80 });
  expect(task.type).toBe('bpmn:Task');
  expect(scene.elementsById.get(task.id)).toBe(task);
  expect(scene.byBusinessObject.get(task.businessObject)).toBe(task);
  expect(scene.revision).toBeGreaterThan(revision);
  expect(changed).toEqual([task.id]);
  expect(canvas.getSelection().get()).toEqual([task]);
  expect(canvas.getGraphics(task.id)).toBeDefined();

  // Business object: minted into the process's flowElements, with a prefixed id.
  const flowElements = process(definitions).flowElements;
  expect(flowElements.length).toBe(beforeFlowElements + 1);
  const bo = flowElements[flowElements.length - 1];
  expect(bo).toBe(task.businessObject);
  expect(bo.$type).toBe('bpmn:Task');
  expect(bo.name).toBe('Fresh');
  expect(bo.id).toMatch(/^Task_/);
  expect(bo.$parent).toBe(process(definitions));

  // DI: a BPMNShape carrying a dc:Bounds, in the same plane.
  expect(planeElements(definitions).length).toBe(beforePlaneElements + 1);
  const di = diShape(definitions, bo.id);
  expect(di).toBe(task.di);
  expect(di.id).toBe(`${bo.id}_di`);
  expect({ x: di.bounds.x, y: di.bounds.y, width: di.bounds.width, height: di.bounds.height })
    .toEqual({ x: 350, y: 360, width: 100, height: 80 });
  expect(di.$parent).toBe(definitions.diagrams[0].plane);

  // …and serializing THIS tree emits both halves.
  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain(`<bpmn:task id="${bo.id}" name="Fresh"`);
  expect(xml).toContain(`bpmnElement="${bo.id}"`);
  const reloadedBo = process(reloaded).flowElements.find((el: any) => el.id === bo.id);
  expect(reloadedBo).toBeDefined();
  expect(reloadedBo.$type).toBe('bpmn:Task');
  const reloadedDi = diShape(reloaded, bo.id);
  expect({ x: reloadedDi.bounds.x, y: reloadedDi.bounds.y }).toEqual({ x: 350, y: 360 });
});

test('a studyflow palette entry mints its extension wrapper and defaults', async () => {
  const loaded = await load();
  const { canvas, definitions } = loaded;

  const created = canvas.createElement(
    { type: 'bpmn:Task', extensionType: 'cognitive:Instruction', attrs: { name: 'Welcome' } },
    { x: 500, y: 300 },
  );
  expect(created).toBeDefined();
  const bo = created!.businessObject as any;

  // The id prefix comes from the EXTENSION type, as `buildBusinessObject.ts` does.
  expect(bo.id).toMatch(/^Instruction_/);
  expect(getExtensionType(bo)).toBe('cognitive:Instruction');
  expect(bo.extensionElements.values[0].$type).toBe('cognitive:Instruction');

  const { xml } = await roundTrip(loaded);
  expect(xml).toContain('bpmn:extensionElements');
  expect(xml.toLowerCase()).toContain('cognitive:instruction');
  expect(definitions.diagrams[0].plane.planeElement.some((pe: any) => pe.bpmnElement === bo)).toBe(true);
});

test('a disallowed drop writes nothing — no business object, no DI, no revision bump', async () => {
  const { canvas, definitions } = await load();
  const scene = canvas.getScene()!;
  const task = node(canvas, 'Task_1');
  const beforeFlowElements = process(definitions).flowElements.length;
  const beforePlaneElements = planeElements(definitions).length;
  const revision = scene.revision;

  // A task cannot contain a task: the drop lands on `Task_1` and is refused.
  const rejected = canvas.createElement(
    { type: 'bpmn:Task' },
    { x: task.x + task.width / 2, y: task.y + task.height / 2 },
  );

  expect(rejected).toBeUndefined();
  expect(process(definitions).flowElements.length).toBe(beforeFlowElements);
  expect(planeElements(definitions).length).toBe(beforePlaneElements);
  expect(scene.revision).toBe(revision);
  expect(scene.elementsById.size).toBe(2); // still just Start_1 and Task_1
});

test('a pool drop files the shape in the pool\'s processRef, not the collaboration', async () => {
  const loaded = await load(POOL_XML);
  const { canvas, definitions } = loaded;
  const pool = node(canvas, 'Pool_1');

  const created = canvas.createElement({ type: 'bpmn:UserTask' }, { x: 400, y: 220 });
  expect(created).toBeDefined();
  expect(created!.parent).toBe(pool);

  const collaboration = definitions.rootElements.find((el: any) => el.$type === 'bpmn:Collaboration');
  const poolProcess = process(definitions, 'Process_2');
  expect(poolProcess.flowElements).toContain(created!.businessObject);
  expect(collaboration.flowElements).toBeUndefined();
  expect(created!.businessObject.$parent).toBe(poolProcess);

  const { reloaded } = await roundTrip(loaded);
  expect(process(reloaded, 'Process_2').flowElements.some((el: any) => el.$type === 'bpmn:UserTask')).toBe(true);
});

test('an artifact drop goes to `artifacts`, not `flowElements`', async () => {
  const { canvas, definitions } = await load();
  const created = canvas.createElement({ type: 'bpmn:TextAnnotation' }, { x: 500, y: 500 });
  expect(created).toBeDefined();
  expect(process(definitions).artifacts).toContain(created!.businessObject);
  expect(process(definitions).flowElements).not.toContain(created!.businessObject);
});

test('every created element draws a fresh id, never colliding with the document', async () => {
  const { canvas } = await load();
  const first = canvas.createElement({ type: 'bpmn:Task' }, { x: 500, y: 400 })!;
  const second = canvas.createElement({ type: 'bpmn:Task' }, { x: 700, y: 400 })!;
  expect(first.id).not.toBe(second.id);
  expect([first.id, second.id]).not.toContain('Task_1'); // the id the document already holds
  expect(first.di!.id).not.toBe(second.di!.id);
});

// --- the pointer gesture -----------------------------------------------------

test('startCreate follows the pointer with a preview and drops where the pointer is', async () => {
  const { canvas, definitions } = await load();
  const svg = canvas.getSvg();
  const overlays = svg.querySelector('.sf-layer-overlays') ?? svg;

  expect(canvas.startCreate(undefined, { type: 'bpmn:UserTask' })).toBe(true);
  expect(canvas.getCreate().isActive()).toBe(true);

  pointerMove(canvas, { x: 600, y: 400 });
  const preview = overlays.querySelector('.sf-create-preview');
  expect(preview).not.toBeNull();
  expect(preview!.getAttribute('data-allowed')).toBe('true');
  // The ghost is the SHAPE, drawn by the real renderer and wearing `sf-dragger` so
  // the style layer paints it as blue outline (parity spec §7) — not a dashed box.
  const ghost = preview!.firstElementChild!;
  expect(ghost.tagName.toLowerCase()).toBe('g');
  expect(ghost.classList.contains('sf-dragger')).toBe(true);
  expect(ghost.getAttribute('transform')).toBe('translate(550, 360)');
  // It is a picture, never an element: nothing can address it by id.
  expect(ghost.hasAttribute('data-element-id')).toBe(false);
  expect(ghost.querySelector('rect')).not.toBeNull();

  pointerUp(canvas, { x: 600, y: 400 });
  expect(canvas.getCreate().isActive()).toBe(false);
  expect(svg.querySelector('.sf-create-preview')).toBeNull();

  const created = canvas.getSelection().get()[0] as SceneNode;
  expect(created.type).toBe('bpmn:UserTask');
  expect({ x: created.x, y: created.y }).toEqual({ x: 550, y: 360 });
  expect(process(definitions).flowElements).toContain(created.businessObject);
  expect(canvas.getGraphics(created.id)).toBeDefined();
});

test('the preview reports a forbidden target, and dropping there creates nothing', async () => {
  const { canvas, definitions } = await load();
  const svg = canvas.getSvg();
  const task = node(canvas, 'Task_1');
  const over = { x: task.x + task.width / 2, y: task.y + task.height / 2 };
  const before = process(definitions).flowElements.length;

  canvas.startCreate(undefined, { type: 'bpmn:Task' });
  pointerMove(canvas, over);
  expect(svg.querySelector('.sf-create-preview')!.getAttribute('data-allowed')).toBe('false');

  pointerUp(canvas, over);
  expect(process(definitions).flowElements.length).toBe(before);
  expect(svg.querySelector('.sf-create-preview')).toBeNull();
  expect(canvas.getSelection().get()).toEqual([]);
});

test('Escape abandons a create gesture without touching the document', async () => {
  const { canvas, definitions } = await load();
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const before = process(definitions).flowElements.length;
  const revision = canvas.getScene()!.revision;

  canvas.startCreate(undefined, { type: 'bpmn:Task' });
  pointerMove(canvas, { x: 600, y: 500 });
  doc.dispatchEvent(keyEvent('keydown', { key: 'Escape' }));

  expect(canvas.getCreate().isActive()).toBe(false);
  expect(svg.querySelector('.sf-create-preview')).toBeNull();
  expect(process(definitions).flowElements.length).toBe(before);
  expect(canvas.getScene()!.revision).toBe(revision);
});

test('a pre-built business object is filed as-is, and only once', async () => {
  const { canvas, definitions, moddle } = await load();
  const bo = moddle.create('bpmn:ManualTask', { id: 'Manual_custom', name: 'Hand made' });
  const prototype = createShape({ type: 'bpmn:ManualTask', businessObject: bo });

  const created = canvas.createElement(prototype, { x: 600, y: 600 })!;
  expect(created.businessObject).toBe(bo);
  expect(created.id).toBe('Manual_custom');
  expect(process(definitions).flowElements.filter((el: any) => el === bo)).toHaveLength(1);

  // The prototype released its business object, so a second drop mints a new one
  // rather than filing the same object twice.
  const again = canvas.createElement(prototype, { x: 800, y: 600 })!;
  expect(again.businessObject).not.toBe(bo);
  expect(again.id).not.toBe('Manual_custom');
});

// --- z-order of a newly mounted element (CanvasReview H5) ---------------------

/** The `data-element-id`s in the shapes layer, in paint order (bottom → top). */
function shapeOrder(canvas: Canvas): string[] {
  return Array.from(canvas.getSvg().querySelectorAll('[data-layer="shapes"] > g'))
    .map((g) => g.getAttribute('data-element-id') ?? '');
}

test('mount: a created element is spliced in at its depth, not painted over the diagram', async () => {
  const { canvas } = await load(POOL_XML);
  // The imported order is ancestors-first: the pool, then what it encloses.
  expect(shapeOrder(canvas)).toEqual(['Pool_1', 'Start_2']);

  // A second participant is a plane-root child (depth 0) like `Pool_1`, so it must
  // land BEFORE the depth-1 shapes — appending it last would cover `Start_2` with
  // its own white fill while hit-testing kept finding the buried shape.
  const pool = canvas.createElement({ type: 'bpmn:Participant' }, { x: 400, y: 600 })!;
  expect(pool.parent).toBeUndefined();
  expect(shapeOrder(canvas)).toEqual(['Pool_1', pool.id, 'Start_2']);

  // A shape dropped INTO a container is deeper than every existing frame, so it
  // still goes on top.
  const task = canvas.createElement({ type: 'bpmn:Task' }, { x: 400, y: 220 })!;
  expect(task.parent?.id).toBe('Pool_1');
  expect(shapeOrder(canvas)).toEqual(['Pool_1', pool.id, 'Start_2', task.id]);
});

test('mount: the created order matches what a full re-render would produce', async () => {
  const { canvas, definitions, moddle } = await load(POOL_XML);
  canvas.createElement({ type: 'bpmn:Participant' }, { x: 400, y: 600 });
  canvas.createElement({ type: 'bpmn:Task' }, { x: 400, y: 220 });
  const mounted = shapeOrder(canvas);

  // Re-import the SAME (now edited) tree: `Renderer.renderScene` sorts by depth, so
  // an incremental mount that disagreed with it would show a different z-order after
  // any reload.
  const { xml } = await moddle.toXML(definitions);
  const { rootElement } = await freshModdle().fromXML(xml);
  const reloaded = new Canvas();
  reloaded.importDefinitions(rootElement);
  expect(shapeOrder(reloaded)).toEqual(mounted);
});

// --- drop feedback and what a drop leaves behind (parity spec §7) -------------

/** The element the create gesture is currently tinting, with which verdict. */
function dropMarks(canvas: Canvas): { id: string; mark: string }[] {
  const svg = canvas.getSvg();
  return Array.from(svg.querySelectorAll('.sf-new-parent, .sf-drop-not-ok'))
    .map((el) => ({
      id: el.getAttribute('data-element-id') ?? '',
      mark: el.classList.contains('sf-new-parent') ? 'sf-new-parent' : 'sf-drop-not-ok',
    }));
}

test('a drop selects the new element AND opens its label editor', async () => {
  const { canvas } = await load();

  canvas.startCreate(undefined, { type: 'bpmn:UserTask' });
  pointerMove(canvas, { x: 600, y: 400 });
  pointerUp(canvas, { x: 600, y: 400 });

  const created = canvas.getSelection().get()[0] as SceneNode;
  expect(created.type).toBe('bpmn:UserTask');
  // Parity: `selected: [...]` AND `editorOpen: true`, on the very same drop.
  const editing = canvas.getLabelEditing();
  expect(editing.isActive()).toBe(true);
  expect(editing.getSession()!.element).toBe(created);
  expect(editing.getValue()).toBe('');
  expect(canvas.getContainer().querySelector('textarea.sf-label-editor')).not.toBeNull();
});

test('click-to-place creates too, and lands the same element in the same state', async () => {
  const { canvas, definitions } = await load();
  const before = process(definitions).flowElements.length;

  // The palette's click gesture: `startCreate` with no canvas press behind it, then
  // a plain click on the canvas — a pointerdown that must NOT become a marquee.
  canvas.startCreate(undefined, { type: 'bpmn:Task' });
  pointerDown(canvas, { x: 700, y: 500 });
  pointerUp(canvas, { x: 700, y: 500 });

  expect(process(definitions).flowElements.length).toBe(before + 1);
  const created = canvas.getSelection().get()[0] as SceneNode;
  expect({ x: created.x, y: created.y }).toEqual({ x: 650, y: 460 });
  expect(canvas.getLabelEditing().isActive()).toBe(true);
  expect(canvas.getCreate().isActive()).toBe(false);
});

test('an event or a gateway is selected on drop but opens no editor', async () => {
  const { canvas } = await load();
  const drops: [string, number][] = [['bpmn:StartEvent', 600], ['bpmn:ExclusiveGateway', 800]];
  for (const [type, x] of drops) {
    const created = canvas.createElement({ type }, { x, y: 600 })!;
    expect(created).toBeDefined();
    expect(canvas.getSelection().get()).toEqual([created]);
    // bpmn-js activates direct editing only for a task/annotation/group/collapsed
    // sub-process; an external caption box under every dropped gateway is not parity.
    expect(canvas.getLabelEditing().isActive()).toBe(false);
  }
});

test('drop feedback: an invalid target is tinted red, a valid container tinted grey', async () => {
  const { canvas } = await load();
  const svg = canvas.getSvg();
  const task = node(canvas, 'Task_1');
  const over = { x: task.x + task.width / 2, y: task.y + task.height / 2 };

  canvas.startCreate(undefined, { type: 'bpmn:Task' });
  // The cursor says "carrying something" for the whole gesture.
  expect(svg.classList.contains('sf-drag-active')).toBe(true);

  pointerMove(canvas, over);
  expect(dropMarks(canvas)).toEqual([{ id: 'Task_1', mark: 'sf-drop-not-ok' }]);
  expect(svg.classList.contains('sf-new-parent')).toBe(false);

  // Off the shape: empty canvas takes it, and the ROOT is what gets marked.
  pointerMove(canvas, { x: 800, y: 600 });
  expect(dropMarks(canvas)).toEqual([]);
  expect(svg.classList.contains('sf-new-parent')).toBe(true);

  pointerUp(canvas, { x: 800, y: 600 });
  // Every mark is as short-lived as the gesture.
  expect(dropMarks(canvas)).toEqual([]);
  expect(svg.classList.contains('sf-new-parent')).toBe(false);
  expect(svg.classList.contains('sf-drag-active')).toBe(false);
});

test('drop feedback: a pool accepts the drop', async () => {
  const { canvas } = await load(POOL_XML);
  const pool = node(canvas, 'Pool_1');

  canvas.startCreate(undefined, { type: 'bpmn:Task' });
  pointerMove(canvas, { x: pool.x + 400, y: pool.y + 150 });
  expect(dropMarks(canvas)).toEqual([{ id: 'Pool_1', mark: 'sf-new-parent' }]);

  pointerUp(canvas, { x: pool.x + 400, y: pool.y + 150 });
  expect(dropMarks(canvas)).toEqual([]);
});

test('drop feedback: dropping onto a sequence flow marks the CONNECTION as accepting', async () => {
  const { canvas, definitions } = await load(FLOW_XML);
  const flow = canvas.getScene()!.elementsById.get('Flow_1') as any;
  // Mid-way along the flow, clear of both shapes it joins.
  const mid = { x: 170, y: 118 };
  expect(canvas.hitTest(mid)).toBe(flow);
  const before = process(definitions).flowElements.length;

  canvas.startCreate(undefined, { type: 'bpmn:Task' });
  pointerMove(canvas, mid);
  // Insert-on-flow is allowed, and it is the connection under the pointer that
  // carries the mark — not the container the shape would land in (spec §7 `dropOnFlow`).
  expect(dropMarks(canvas)).toEqual([{ id: 'Flow_1', mark: 'sf-new-parent' }]);

  pointerUp(canvas, mid);
  expect(process(definitions).flowElements.length).toBe(before + 1);
  expect(dropMarks(canvas)).toEqual([]);
});

test('Escape during a create clears the tint and the cursor with the ghost', async () => {
  const { canvas } = await load();
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;
  const task = node(canvas, 'Task_1');

  canvas.startCreate(undefined, { type: 'bpmn:Task' });
  pointerMove(canvas, { x: task.x + 10, y: task.y + 10 });
  expect(dropMarks(canvas)).toHaveLength(1);

  doc.dispatchEvent(keyEvent('keydown', { key: 'Escape' }));
  expect(dropMarks(canvas)).toEqual([]);
  expect(svg.classList.contains('sf-drag-active')).toBe(false);
  expect(svg.querySelector('.sf-create-preview')).toBeNull();
});
