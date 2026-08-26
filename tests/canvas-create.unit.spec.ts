import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { getExtensionType } from '@core/element';
import {
  Canvas,
  createShape,
  defaultSizeFor,
  setDocument,
} from '@canvas/index.ts';
import type { SceneNode } from '@canvas/model/scene.ts';
import type { ElementChangedEvent } from '@canvas/model/writeback.ts';

import { loadSchemaModels } from './schemas';

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

// --- pointer helpers ---------------------------------------------------------

interface Pt { x: number; y: number; }

function firePointer(canvas: Canvas, target: EventTarget, type: string, diagram: Pt): void {
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
  const doc = svg.ownerDocument!;
  const overlays = svg.querySelector('.sf-layer-overlays') ?? svg;

  expect(canvas.startCreate(undefined, { type: 'bpmn:UserTask' })).toBe(true);
  expect(canvas.getCreate().isActive()).toBe(true);

  firePointer(canvas, doc, 'pointermove', { x: 600, y: 400 });
  const preview = overlays.querySelector('.sf-create-preview');
  expect(preview).not.toBeNull();
  expect(preview!.getAttribute('data-allowed')).toBe('true');
  const rect = preview!.firstElementChild!;
  expect(rect.getAttribute('x')).toBe('550');
  expect(rect.getAttribute('y')).toBe('360');

  firePointer(canvas, doc, 'pointerup', { x: 600, y: 400 });
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
  const doc = svg.ownerDocument!;
  const task = node(canvas, 'Task_1');
  const over = { x: task.x + task.width / 2, y: task.y + task.height / 2 };
  const before = process(definitions).flowElements.length;

  canvas.startCreate(undefined, { type: 'bpmn:Task' });
  firePointer(canvas, doc, 'pointermove', over);
  expect(svg.querySelector('.sf-create-preview')!.getAttribute('data-allowed')).toBe('false');

  firePointer(canvas, doc, 'pointerup', over);
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
  firePointer(canvas, doc, 'pointermove', { x: 600, y: 500 });
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

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
