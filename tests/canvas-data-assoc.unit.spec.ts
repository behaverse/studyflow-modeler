import { expect, test } from '@playwright/test';

import { expandIoSpecification, inlineIoSpecification } from '@core/document/io-specification';
import { Canvas } from '@canvas/index.ts';
import { dataAssociationEnds } from '@canvas/model/dataAssociation.ts';
import type { SceneEdge, SceneNode } from '@canvas/model/scene.ts';

import { exampleXml } from './utils';

import { freshModdle, installDocument, loadCanvas, type Loaded } from './canvasHarness';

/**
 * P5 data-association writeback (design §1 "add edge … delete → remove BO from its
 * container **and** its `planeElement`", §2 "data-input/output associations", §6 P5).
 *
 * A data association is the one connection that is not filed in a container: it
 * hangs off the *activity* (`dataInputAssociations` / `dataOutputAssociations`), and
 * only one of its two refs points at the data shape — the other points at an io
 * slot the diagram may or may not declare. So this spec asserts both halves of
 * `@core/document/io-specification.ts`'s world:
 *
 * - the **compact** form (no `ioSpecification` — what the app hands the canvas after
 *   `inlineIoSpecification`), where the slot ref is deliberately left unset and
 *   core's `expandIoSpecification` mints it on the way out to standard BPMN;
 * - the **declared** form (an `ioSpecification` already present — the shipped
 *   `sklearn_pipeline` example), where the slot is minted alongside the association
 *   and given back when it is deleted.
 *
 * Every structural assertion is made against `bpmn-moddle`'s `toXML` of the SAME
 * live tree the canvas edited (and a reload of it), never against the scene alone.
 */

installDocument();

/**
 * The compact form: a task, a data object and a data store, no `ioSpecification`
 * and no association yet. `Task_1` also carries a sequence flow, so the spec can
 * check that a data association does not disturb the ordinary topology.
 */
const COMPACT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_C" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_C" isExecutable="false">
    <bpmn:startEvent id="Start_1">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_1" name="Analyse">
      <bpmn:incoming>Flow_1</bpmn:incoming>
    </bpmn:task>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:dataObjectReference id="Data_In" name="Raw" />
    <bpmn:dataStoreReference id="Store_Out" name="Results" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_C">
    <bpmndi:BPMNPlane id="Plane_C" bpmnElement="Process_C">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="220" y="178" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Data_In_di" bpmnElement="Data_In">
        <dc:Bounds x="252" y="60" width="36" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Store_Out_di" bpmnElement="Store_Out">
        <dc:Bounds x="252" y="330" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="218" />
        <di:waypoint x="220" y="218" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** The declared form: the same shape, but the task already owns an `ioSpecification`. */
const DECLARED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_D" isExecutable="false">
    <bpmn:task id="Task_D" name="Fit">
      <bpmn:ioSpecification id="Task_D_io">
        <bpmn:dataInput id="Task_D_in_seed" name="seed" />
        <bpmn:inputSet id="Task_D_inputSet">
          <bpmn:dataInputRefs>Task_D_in_seed</bpmn:dataInputRefs>
        </bpmn:inputSet>
        <bpmn:outputSet id="Task_D_outputSet" />
      </bpmn:ioSpecification>
      <bpmn:dataInputAssociation id="DataInput_Seed">
        <bpmn:sourceRef>Seed</bpmn:sourceRef>
        <bpmn:targetRef>Task_D_in_seed</bpmn:targetRef>
      </bpmn:dataInputAssociation>
    </bpmn:task>
    <bpmn:dataObjectReference id="Seed" name="Seed" />
    <bpmn:dataObjectReference id="Model" name="Model" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_D">
    <bpmndi:BPMNPlane id="Plane_D" bpmnElement="Process_D">
      <bpmndi:BPMNShape id="Task_D_di" bpmnElement="Task_D">
        <dc:Bounds x="220" y="178" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Seed_di" bpmnElement="Seed">
        <dc:Bounds x="120" y="60" width="36" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Model_di" bpmnElement="Model">
        <dc:Bounds x="380" y="60" width="36" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="DataInput_Seed_di" bpmnElement="DataInput_Seed">
        <di:waypoint x="138" y="110" />
        <di:waypoint x="240" y="178" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

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

/** Every `bpmndi:BPMNShape`/`BPMNEdge` of every plane, keyed by the id it depicts. */
function diElements(definitions: any): Map<string, any> {
  const out = new Map<string, any>();
  for (const diagram of definitions.diagrams ?? []) {
    for (const pe of diagram.plane?.planeElement ?? []) {
      if (pe.bpmnElement?.id) out.set(pe.bpmnElement.id, pe);
    }
  }
  return out;
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

/** An element's business object, untyped — moddle's `get` is untyped upstream. */
function bo(element: SceneNode | SceneEdge): any {
  return element.businessObject;
}

// --- classification ----------------------------------------------------------

test('the rules classify a data-shape pair as the matching association, either way round', async () => {
  const { canvas } = await loadCanvas(COMPACT_XML);
  const rules = canvas.getRules();
  const task = node(canvas, 'Task_1');
  const data = node(canvas, 'Data_In');
  const store = node(canvas, 'Store_Out');

  expect(rules.canConnect(data, task)).toEqual({ type: 'bpmn:DataInputAssociation' });
  expect(rules.canConnect(task, store)).toEqual({ type: 'bpmn:DataOutputAssociation' });
  // Data shape to data shape is not a connection at all.
  expect(rules.canConnect(data, store)).toBe(false);

  // …and the writeback sorts the same pair into the same roles.
  expect(dataAssociationEnds(data, task)).toEqual({ data, activity: task, direction: 'input' });
  expect(dataAssociationEnds(task, store)).toEqual({ data: store, activity: task, direction: 'output' });
  expect(dataAssociationEnds(data, store)).toBeUndefined();
});

// --- create: the compact form ------------------------------------------------

test('creating an input association mints the BO on the activity AND a BPMNEdge', async () => {
  const loaded = await loadCanvas(COMPACT_XML);
  const { canvas, definitions } = loaded;
  const edge = canvas.createDataAssociation(node(canvas, 'Data_In'), node(canvas, 'Task_1'))!;
  expect(edge).toBeTruthy();
  expect(edge.type).toBe('bpmn:DataInputAssociation');

  // The BO hangs off the ACTIVITY, not off the process.
  const task = boOf(definitions, 'Task_1');
  expect(task.get('dataInputAssociations')).toHaveLength(1);
  expect(task.get('dataInputAssociations')[0]).toBe(bo(edge));
  expect(bo(edge).$parent).toBe(task);
  expect(boOf(definitions, 'Process_C').get('flowElements')).not.toContain(bo(edge));
  // `sourceRef` is a LIST on a data association; `targetRef` stays unset (the
  // compact form core's `expandIoSpecification` fills in on save).
  expect(bo(edge).get('sourceRef')).toEqual([boOf(definitions, 'Data_In')]);
  expect(bo(edge).get('targetRef')).toBeUndefined();
  // No `ioSpecification` was invented.
  expect(task.get('ioSpecification')).toBeUndefined();

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain(`<bpmn:dataInputAssociation id="${edge.id}">`);
  expect(xml).toContain('<bpmn:sourceRef>Data_In</bpmn:sourceRef>');
  expect(xml).toContain(`<bpmndi:BPMNEdge id="${edge.id}_di" bpmnElement="${edge.id}">`);
  // Both halves survive a reload, and the DI has waypoints the router produced.
  const reloadedTask = boOf(reloaded, 'Task_1');
  expect(reloadedTask.dataInputAssociations).toHaveLength(1);
  expect(reloadedTask.dataInputAssociations[0].sourceRef.map((r: any) => r.id)).toEqual(['Data_In']);
  const di = diElements(reloaded).get(edge.id);
  expect(di.$type).toBe('bpmndi:BPMNEdge');
  expect(di.waypoint.length).toBeGreaterThanOrEqual(2);
});

test('creating an output association files it under dataOutputAssociations, target-side', async () => {
  const loaded = await loadCanvas(COMPACT_XML);
  const { canvas, definitions } = loaded;
  const edge = canvas.createDataAssociation(node(canvas, 'Task_1'), node(canvas, 'Store_Out'))!;
  expect(edge.type).toBe('bpmn:DataOutputAssociation');

  const task = boOf(definitions, 'Task_1');
  expect(task.get('dataOutputAssociations')).toEqual([bo(edge)]);
  expect(task.get('dataInputAssociations')).toHaveLength(0);
  // The data shape is the TARGET here; the (list-valued) source stays empty.
  expect(bo(edge).get('targetRef')).toBe(boOf(definitions, 'Store_Out'));
  expect(bo(edge).get('sourceRef')).toEqual([]);

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain(`<bpmn:dataOutputAssociation id="${edge.id}">`);
  expect(xml).toContain('<bpmn:targetRef>Store_Out</bpmn:targetRef>');
  expect(boOf(reloaded, 'Task_1').dataOutputAssociations[0].targetRef.id).toBe('Store_Out');
  expect(diElements(reloaded).get(edge.id).$type).toBe('bpmndi:BPMNEdge');
});

test('a created association is drawn, indexed, and wired to both scene endpoints', async () => {
  const { canvas } = await loadCanvas(COMPACT_XML);
  const data = node(canvas, 'Data_In');
  const task = node(canvas, 'Task_1');
  const edge = canvas.createDataAssociation(data, task)!;

  expect(canvas.getScene()!.elementsById.get(edge.id)).toBe(edge);
  expect(data.outgoing).toContain(edge);
  expect(task.incoming).toContain(edge);
  // Drawn dotted, like an association (`render/renderer.ts`).
  const g = canvas.getGraphics(edge.id)!;
  expect(g).toBeTruthy();
  expect(g.querySelector('path.sf-connection-line')!.getAttribute('stroke-dasharray')).toBe('2,6');
  // It is NOT pushed onto the BPMN `outgoing`/`incoming`, which are sequence-flow
  // typed — a data shape has neither, and the task keeps only its sequence flow.
  expect(bo(data).get('outgoing')).toBeUndefined();
  expect(bo(task).get('incoming').map((f: any) => f.id)).toEqual(['Flow_1']);
});

test('the compact form a create leaves behind is exactly what core expands on save', async () => {
  const loaded = await loadCanvas(COMPACT_XML);
  const { canvas, definitions } = loaded;
  canvas.createDataAssociation(node(canvas, 'Data_In'), node(canvas, 'Task_1'));
  canvas.createDataAssociation(node(canvas, 'Task_1'), node(canvas, 'Store_Out'));

  // Core's own save-side pass turns the compact refs into a full ioSpecification…
  expect(expandIoSpecification(definitions)).toBe(true);
  const task = boOf(definitions, 'Task_1');
  const io = task.get('ioSpecification');
  expect(io.get('dataInputs').map((d: any) => d.get('name'))).toEqual(['Raw']);
  expect(io.get('dataOutputs').map((d: any) => d.get('name'))).toEqual(['result']);
  expect(task.get('dataInputAssociations')[0].get('targetRef')).toBe(io.get('dataInputs')[0]);
  expect(task.get('dataOutputAssociations')[0].get('sourceRef')).toEqual([io.get('dataOutputs')[0]]);

  // …and its load-side inverse folds it back to what the canvas wrote.
  expect(inlineIoSpecification(definitions)).toBe(true);
  expect(task.get('ioSpecification')).toBeUndefined();
  expect(task.get('dataInputAssociations')[0].get('targetRef')).toBeUndefined();
  expect(task.get('dataOutputAssociations')[0].get('sourceRef')).toEqual([]);
});

// --- create: the declared form ----------------------------------------------

test('an activity that already declares an ioSpecification gets a real slot minted', async () => {
  const loaded = await loadCanvas(DECLARED_XML);
  const { canvas, definitions } = loaded;
  const task = boOf(definitions, 'Task_D');

  const input = canvas.createDataAssociation(node(canvas, 'Model'), node(canvas, 'Task_D'))!;
  const io = task.get('ioSpecification');
  const slot = bo(input).get('targetRef');
  expect(slot.$type).toBe('bpmn:DataInput');
  expect(slot.get('name')).toBe('Model');
  expect(slot.id).toBe('Task_D_in_Model');
  expect(io.get('dataInputs')).toContain(slot);
  expect(io.get('inputSets')[0].get('dataInputRefs')).toContain(slot);

  const output = canvas.createDataAssociation(node(canvas, 'Task_D'), node(canvas, 'Model'))!;
  const outSlot = bo(output).get('sourceRef')[0];
  expect(outSlot.$type).toBe('bpmn:DataOutput');
  expect(outSlot.get('name')).toBe('result');
  expect(io.get('dataOutputs')).toEqual([outSlot]);
  expect(io.get('outputSets')[0].get('dataOutputRefs')).toEqual([outSlot]);

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain('<bpmn:dataInput id="Task_D_in_Model" name="Model" />');
  expect(xml).toContain('<bpmn:dataOutput id="Task_D_result" name="result" />');
  // The reloaded document resolves every ref — no dangling IDREF.
  const reloadedIo = boOf(reloaded, 'Task_D').ioSpecification;
  expect(reloadedIo.dataInputs.map((d: any) => d.id)).toEqual(['Task_D_in_seed', 'Task_D_in_Model']);
  expect(boOf(reloaded, input.id).targetRef).toBe(boOf(reloaded, 'Task_D_in_Model'));
  expect(boOf(reloaded, output.id).sourceRef).toEqual([boOf(reloaded, 'Task_D_result')]);
});

// --- delete ------------------------------------------------------------------

test('deleting a created association removes BOTH the BO and the BPMNEdge', async () => {
  const loaded = await loadCanvas(COMPACT_XML);
  const { canvas, definitions } = loaded;
  const before = await toXML(loaded);
  const edge = canvas.createDataAssociation(node(canvas, 'Data_In'), node(canvas, 'Task_1'))!;

  expect(canvas.deleteElements(edge).map((e) => e.id)).toEqual([edge.id]);

  const task = boOf(definitions, 'Task_1');
  expect(task.get('dataInputAssociations')).toHaveLength(0);
  expect(bo(edge).get('sourceRef')).toEqual([]);
  expect(canvas.getScene()!.elementsById.has(edge.id)).toBe(false);
  expect(canvas.getGraphics(edge.id)).toBeUndefined();
  expect(node(canvas, 'Data_In').outgoing).toHaveLength(0);
  expect(node(canvas, 'Task_1').incoming.map((e: SceneEdge) => e.id)).toEqual(['Flow_1']);

  // Create + delete is a no-op on the document, byte for byte.
  const xml = await toXML(loaded);
  expect(xml).toBe(before);
  expect(xml).not.toContain('dataInputAssociation');
  expect(xml).not.toContain(edge.id);
});

test('deleting an association gives back the ioSpecification slot it minted', async () => {
  const loaded = await loadCanvas(DECLARED_XML);
  const { canvas, definitions } = loaded;
  const before = await toXML(loaded);
  const edge = canvas.createDataAssociation(node(canvas, 'Model'), node(canvas, 'Task_D'))!;

  canvas.deleteElements(edge);

  const io = boOf(definitions, 'Task_D').get('ioSpecification');
  // The slot AND its input-set entry are gone; the pre-existing one is untouched.
  expect(io.get('dataInputs').map((d: any) => d.id)).toEqual(['Task_D_in_seed']);
  expect(io.get('inputSets')[0].get('dataInputRefs').map((d: any) => d.id)).toEqual(['Task_D_in_seed']);

  const xml = await toXML(loaded);
  expect(xml).toBe(before);
  expect(xml).not.toContain('Task_D_in_Model');
});

test('deleting the LAST association drops an ioSpecification that now declares nothing', async () => {
  const loaded = await loadCanvas(DECLARED_XML);
  const { canvas, definitions } = loaded;
  const seed = canvas.getScene()!.elementsById.get('DataInput_Seed') as SceneEdge;
  expect(seed.type).toBe('bpmn:DataInputAssociation');

  canvas.deleteElements(seed);

  const task = boOf(definitions, 'Task_D');
  expect(task.get('dataInputAssociations')).toHaveLength(0);
  expect(task.get('ioSpecification')).toBeUndefined();

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).not.toContain('ioSpecification');
  expect(xml).not.toContain('Task_D_in_seed');
  expect(xml).not.toContain('DataInput_Seed');
  // The data shapes themselves survive — only the association went.
  expect(boOf(reloaded, 'Seed')).toBeTruthy();
  expect(diElements(reloaded).has('Seed')).toBe(true);
  expect(diElements(reloaded).has('DataInput_Seed')).toBe(false);
});

test('deleting the data shape takes its associations with it', async () => {
  const loaded = await loadCanvas(COMPACT_XML);
  const { canvas, definitions } = loaded;
  const input = canvas.createDataAssociation(node(canvas, 'Data_In'), node(canvas, 'Task_1'))!;
  const output = canvas.createDataAssociation(node(canvas, 'Task_1'), node(canvas, 'Store_Out'))!;

  const removed = canvas.deleteElements(node(canvas, 'Data_In')).map((e) => e.id).sort();
  expect(removed).toEqual([input.id, 'Data_In'].sort());

  const task = boOf(definitions, 'Task_1');
  expect(task.get('dataInputAssociations')).toHaveLength(0);
  // The unrelated output association is untouched.
  expect(task.get('dataOutputAssociations')).toEqual([bo(output)]);

  const { xml } = await roundTrip(loaded);
  expect(xml).not.toContain('Data_In');
  expect(xml).not.toContain(input.id);
  expect(xml).toContain(output.id);
});

test('deleting the activity takes every association hanging off it', async () => {
  const loaded = await loadCanvas(COMPACT_XML);
  const { canvas } = loaded;
  const input = canvas.createDataAssociation(node(canvas, 'Data_In'), node(canvas, 'Task_1'))!;
  const output = canvas.createDataAssociation(node(canvas, 'Task_1'), node(canvas, 'Store_Out'))!;

  const removed = canvas.deleteElements(node(canvas, 'Task_1')).map((e) => e.id).sort();
  expect(removed).toEqual(['Flow_1', 'Task_1', input.id, output.id].sort());

  const { xml, reloaded } = await roundTrip(loaded);
  for (const id of ['Task_1', 'Flow_1', input.id, output.id]) expect(xml).not.toContain(id);
  // The data shapes and their DI survive on their own.
  expect(boOf(reloaded, 'Data_In')).toBeTruthy();
  expect(boOf(reloaded, 'Store_Out')).toBeTruthy();
  expect(xml).not.toContain('sourceRef');
  expect(xml).not.toContain('targetRef');
});

// --- the shipped example -----------------------------------------------------

test('the sklearn_pipeline example imports its data associations with both ends resolved', async () => {
  const { canvas } = await loadCanvas(exampleXml('sklearn_pipeline.studyflow.png'));
  const scene = canvas.getScene()!;
  const associations = [...scene.elementsById.values()].filter(
    (el): el is SceneEdge => el.kind === 'edge'
      && (el.type === 'bpmn:DataInputAssociation' || el.type === 'bpmn:DataOutputAssociation'),
  );
  expect(associations.length).toBeGreaterThan(0);

  for (const edge of associations) {
    // Only ONE end is a ref; the other is the activity the association hangs off,
    // which the importer resolves from the moddle `$parent`.
    expect(edge.source, `${edge.id} source`).toBeTruthy();
    expect(edge.target, `${edge.id} target`).toBeTruthy();
    const ends = dataAssociationEnds(edge.source, edge.target)!;
    expect(ends, `${edge.id} ends`).toBeTruthy();
    expect(ends.direction).toBe(edge.type === 'bpmn:DataInputAssociation' ? 'input' : 'output');
    expect(ends.activity.businessObject).toBe(bo(edge).$parent);
  }
});

test('a real example round-trips byte-identically through a create+delete', async () => {
  const loaded = await loadCanvas(exampleXml('sklearn_pipeline.studyflow.png'));
  const { canvas } = loaded;
  const before = await toXML(loaded);
  const scene = canvas.getScene()!;
  const nodes = [...scene.elementsById.values()].filter(
    (el): el is SceneNode => el.kind === 'node',
  );
  const data = nodes.find((el) => el.type === 'bpmn:DataObjectReference')!;
  // Any activity the rules will take a data association from — the same verdict the
  // connect gesture would reach.
  const activity = nodes.find(
    (el) => el !== data && canvas.getRules().canConnect(data, el) !== false,
  )!;
  expect(activity).toBeTruthy();

  const edge = canvas.createDataAssociation(data, activity)!;
  expect(edge).toBeTruthy();
  expect(await toXML(loaded)).not.toBe(before);

  canvas.deleteElements(edge);
  expect(await toXML(loaded)).toBe(before);
});
