import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, setDocument } from '@canvas/index.ts';
import type { SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import type { SelectionChangedEvent } from '@canvas/interaction/selection.ts';
import type { ElementsRemovedEvent } from '@canvas/model/remove.ts';
import type { ElementChangedEvent } from '@canvas/model/writeback.ts';

import { loadSchemaModels } from './schemas';

/**
 * P5 deletion writeback (design §1 "delete → remove BO from its container **and**
 * its `planeElement`", §6 P5).
 *
 * The contract: a delete leaves NO trace of the removed elements in the document —
 * no business object in any container, no `BPMNShape`/`BPMNEdge` in any plane, no
 * `sourceRef`/`targetRef` pointing at something that is gone, no surviving
 * neighbour still listing the removed flow in `outgoing`/`incoming`, no lane still
 * claiming it through `flowNodeRef`, and no orphaned nested `BPMNDiagram`. Every
 * assertion is made against `bpmn-moddle`'s `toXML` of the SAME live tree the
 * canvas edited (and a reload of it), never against the scene alone.
 *
 * And the flip side: everything the delete did not touch must come out byte for
 * byte as it went in.
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
 * A linear process — `Start_1 → Task_1 → End_1` — plus `Task_2`, an untouched
 * sibling that shares nothing with the chain. `<bpmn:incoming>`/`<bpmn:outgoing>`
 * are spelled out (as every real exporter does), so the reciprocal reference lists
 * exist and pruning them is observable.
 */
const CHAIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Go">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_1" name="Middle">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_1" name="Stop">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:task id="Task_2" name="Sibling" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="360" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="200" y="300" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" />
        <di:waypoint x="200" y="118" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="300" y="118" />
        <di:waypoint x="360" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/**
 * A sub-process drilled down into its own `BPMNDiagram` — the nested plane P5 must
 * take with the container (design §1 "Nested planes").
 */
const SUBPROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_3" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_3" isExecutable="false">
    <bpmn:startEvent id="Start_3">
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:subProcess id="Sub_1" name="Nested">
      <bpmn:incoming>Flow_3</bpmn:incoming>
      <bpmn:startEvent id="Inner_Start">
        <bpmn:outgoing>Inner_Flow</bpmn:outgoing>
      </bpmn:startEvent>
      <bpmn:task id="Inner_Task" name="Inner">
        <bpmn:incoming>Inner_Flow</bpmn:incoming>
      </bpmn:task>
      <bpmn:sequenceFlow id="Inner_Flow" sourceRef="Inner_Start" targetRef="Inner_Task" />
    </bpmn:subProcess>
    <bpmn:task id="Keep_1" name="Untouched" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Start_3" targetRef="Sub_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_3">
    <bpmndi:BPMNPlane id="Plane_3" bpmnElement="Process_3">
      <bpmndi:BPMNShape id="Start_3_di" bpmnElement="Start_3">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub_1_di" bpmnElement="Sub_1" isExpanded="false">
        <dc:Bounds x="200" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Keep_1_di" bpmnElement="Keep_1">
        <dc:Bounds x="200" y="300" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_3_di" bpmnElement="Flow_3">
        <di:waypoint x="136" y="118" />
        <di:waypoint x="200" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="Diag_Sub_1">
    <bpmndi:BPMNPlane id="Plane_Sub_1" bpmnElement="Sub_1">
      <bpmndi:BPMNShape id="Inner_Start_di" bpmnElement="Inner_Start">
        <dc:Bounds x="600" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Inner_Task_di" bpmnElement="Inner_Task">
        <dc:Bounds x="700" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Inner_Flow_di" bpmnElement="Inner_Flow">
        <di:waypoint x="636" y="118" />
        <di:waypoint x="700" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** A pool split into one lane that claims its member by `flowNodeRef`. */
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
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_1" name="Operator">
        <bpmn:flowNodeRef>Task_L</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Boundary_1</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:task id="Task_L" name="In a lane" />
    <bpmn:boundaryEvent id="Boundary_1" attachedToRef="Task_L" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_2">
    <bpmndi:BPMNPlane id="Plane_2" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Pool_1_di" bpmnElement="Pool_1" isHorizontal="true">
        <dc:Bounds x="100" y="100" width="600" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_1_di" bpmnElement="Lane_1" isHorizontal="true">
        <dc:Bounds x="130" y="100" width="570" height="250" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_L_di" bpmnElement="Task_L">
        <dc:Bounds x="200" y="180" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Boundary_1_di" bpmnElement="Boundary_1">
        <dc:Bounds x="282" y="242" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

interface Loaded {
  canvas: Canvas;
  definitions: any;
  moddle: any;
}

async function load(xml = CHAIN_XML): Promise<Loaded> {
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(xml);
  const canvas = new Canvas();
  canvas.importDefinitions(definitions);
  return { canvas, definitions, moddle };
}

// --- live-tree readers (never the scene) -------------------------------------

function root(definitions: any, id: string): any {
  return definitions.rootElements.find((el: any) => el.id === id);
}

function planeElements(definitions: any, index = 0): any[] {
  return definitions.diagrams[index]?.plane.planeElement ?? [];
}

function diIds(definitions: any, index = 0): string[] {
  return planeElements(definitions, index).map((pe: any) => pe.bpmnElement?.id);
}

function flowIds(container: any): string[] {
  return (container.flowElements ?? []).map((el: any) => el.id);
}

async function toXML(loaded: Loaded): Promise<string> {
  const { xml } = await loaded.moddle.toXML(loaded.definitions);
  return xml;
}

async function roundTrip(loaded: Loaded): Promise<{ xml: string; reloaded: any }> {
  const xml = await toXML(loaded);
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  return { xml, reloaded };
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function edge(canvas: Canvas, id: string): SceneEdge {
  return canvas.getScene()!.elementsById.get(id) as SceneEdge;
}

function ids(elements: readonly SceneElement[]): string[] {
  return elements.map((element) => element.id).sort();
}

/** The exact serialized text of one element, for a byte-identical comparison. */
function fragment(xml: string, pattern: RegExp): string {
  const match = xml.match(pattern);
  expect(match, `no match for ${pattern} in\n${xml}`).not.toBeNull();
  return match![0];
}

const TASK_2_BO = /<bpmn:task id="Task_2"[^>]*\/>/;
const TASK_2_DI = /<bpmndi:BPMNShape id="Task_2_di"[\s\S]*?<\/bpmndi:BPMNShape>/;

// --- deleting a node ---------------------------------------------------------

test('deleting a node takes both incident edges with it, everywhere', async () => {
  const loaded = await load();
  const { canvas, definitions } = loaded;
  const scene = canvas.getScene()!;
  const before = await toXML(loaded);
  const revision = scene.revision;

  const removedEvents: string[][] = [];
  const changedEvents: string[] = [];
  canvas.getEventBus().on<ElementsRemovedEvent>('elements.removed', (e) => removedEvents.push(ids(e.elements)));
  canvas.getEventBus().on<ElementChangedEvent>('element.changed', (e) => changedEvents.push(e.element.id));

  const start = node(canvas, 'Start_1');
  const end = node(canvas, 'End_1');
  const removed = canvas.deleteElements(node(canvas, 'Task_1'));

  // The closure: the node the caller named plus both flows docked to it.
  expect(ids(removed)).toEqual(['Flow_1', 'Flow_2', 'Task_1']);
  expect(removedEvents).toEqual([['Flow_1', 'Flow_2', 'Task_1']]);
  expect(changedEvents.sort()).toEqual(['End_1', 'Start_1']);
  expect(scene.revision).toBeGreaterThan(revision);

  // Scene indexes and the neighbours' edge lists.
  for (const id of ['Task_1', 'Flow_1', 'Flow_2']) {
    expect(scene.elementsById.has(id)).toBe(false);
    expect(canvas.getGraphics(id)).toBeUndefined();
  }
  expect(scene.byBusinessObject.size).toBe(scene.elementsById.size);
  expect(start.outgoing).toEqual([]);
  expect(end.incoming).toEqual([]);
  expect(scene.rootPlane.children.map((el) => el.id).sort()).toEqual(['End_1', 'Start_1', 'Task_2']);

  // The live moddle tree: containers, reciprocal references, DI.
  const process = root(definitions, 'Process_1');
  expect(flowIds(process).sort()).toEqual(['End_1', 'Start_1', 'Task_2']);
  expect(start.businessObject.outgoing).toEqual([]);
  expect(end.businessObject.incoming).toEqual([]);
  expect(diIds(definitions).sort()).toEqual(['End_1', 'Start_1', 'Task_2']);

  // …and the serialized document has no trace of any of it.
  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).not.toContain('Task_1');
  expect(xml).not.toContain('Flow_1');
  expect(xml).not.toContain('Flow_2');
  expect(xml).not.toMatch(/sourceRef|targetRef/);
  expect(flowIds(root(reloaded, 'Process_1')).sort()).toEqual(['End_1', 'Start_1', 'Task_2']);
  expect(planeElements(reloaded)).toHaveLength(3);

  // The untouched sibling comes out byte for byte as it went in.
  expect(fragment(xml, TASK_2_BO)).toBe(fragment(before, TASK_2_BO));
  expect(fragment(xml, TASK_2_DI)).toBe(fragment(before, TASK_2_DI));
});

test('deleting an edge only detaches its endpoints', async () => {
  const loaded = await load();
  const { canvas, definitions } = loaded;
  const before = await toXML(loaded);
  const start = node(canvas, 'Start_1');
  const task = node(canvas, 'Task_1');

  const removed = canvas.deleteElements(edge(canvas, 'Flow_1'));
  expect(ids(removed)).toEqual(['Flow_1']);

  // Both endpoints survive — only the reference lists shrink.
  expect(canvas.getScene()!.elementsById.has('Start_1')).toBe(true);
  expect(canvas.getScene()!.elementsById.has('Task_1')).toBe(true);
  expect(start.outgoing).toEqual([]);
  expect(task.incoming).toEqual([]);
  expect(start.businessObject.outgoing).toEqual([]);
  expect(task.businessObject.incoming).toEqual([]);
  expect(task.businessObject.outgoing).toHaveLength(1); // Flow_2 untouched
  expect(flowIds(root(definitions, 'Process_1')).sort())
    .toEqual(['End_1', 'Flow_2', 'Start_1', 'Task_1', 'Task_2']);
  expect(diIds(definitions)).toContain('Task_1');
  expect(diIds(definitions)).not.toContain('Flow_1');

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).not.toContain('Flow_1');
  expect(xml).toContain('<bpmn:task id="Task_1"');
  expect(xml).toContain('sourceRef="Task_1" targetRef="End_1"');
  expect(root(reloaded, 'Process_1').flowElements).toHaveLength(5);
  expect(fragment(xml, TASK_2_BO)).toBe(fragment(before, TASK_2_BO));
  expect(fragment(xml, TASK_2_DI)).toBe(fragment(before, TASK_2_DI));
});

test('a delete of nothing writes nothing', async () => {
  const loaded = await load();
  const { canvas } = loaded;
  const before = await toXML(loaded);
  const revision = canvas.getScene()!.revision;

  expect(canvas.deleteElements([])).toEqual([]);
  expect(canvas.deleteSelection()).toEqual([]);
  expect(canvas.getScene()!.revision).toBe(revision);
  expect(await toXML(loaded)).toBe(before);
});

// --- containers --------------------------------------------------------------

test('deleting a sub-process removes its children and its nested plane', async () => {
  const loaded = await load(SUBPROCESS_XML);
  const { canvas, definitions } = loaded;
  const scene = canvas.getScene()!;
  const before = await toXML(loaded);

  expect(scene.planes).toHaveLength(2);
  expect(definitions.diagrams).toHaveLength(2);

  const start = node(canvas, 'Start_3');
  const removed = canvas.deleteElements(node(canvas, 'Sub_1'));

  // Everything the sub-process depicted, plus the flow that ran into it.
  expect(ids(removed)).toEqual(['Flow_3', 'Inner_Flow', 'Inner_Start', 'Inner_Task', 'Sub_1']);
  for (const id of ['Sub_1', 'Inner_Start', 'Inner_Task', 'Inner_Flow', 'Flow_3']) {
    expect(scene.elementsById.has(id)).toBe(false);
    expect(canvas.getGraphics(id)).toBeUndefined();
  }
  expect(start.outgoing).toEqual([]);
  expect(start.businessObject.outgoing).toEqual([]);

  // The nested plane is gone from the scene AND from the document.
  expect(scene.planes).toHaveLength(1);
  expect(definitions.diagrams).toHaveLength(1);
  expect(flowIds(root(definitions, 'Process_3')).sort()).toEqual(['Keep_1', 'Start_3']);
  expect(diIds(definitions).sort()).toEqual(['Keep_1', 'Start_3']);

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).not.toContain('Sub_1');
  expect(xml).not.toContain('Inner_');
  expect(xml).not.toContain('Flow_3');
  expect(reloaded.diagrams).toHaveLength(1);
  expect(planeElements(reloaded)).toHaveLength(2);

  const KEEP = /<bpmndi:BPMNShape id="Keep_1_di"[\s\S]*?<\/bpmndi:BPMNShape>/;
  expect(fragment(xml, KEEP)).toBe(fragment(before, KEEP));
});

test('deleting a lane member drops it from `flowNodeRef`, and its boundary event follows', async () => {
  const loaded = await load(POOL_XML);
  const { canvas, definitions } = loaded;
  const lane = node(canvas, 'Lane_1');

  const removed = canvas.deleteElements(node(canvas, 'Task_L'));
  // The boundary event cannot outlive the activity it is attached to.
  expect(ids(removed)).toEqual(['Boundary_1', 'Task_L']);

  expect(lane.businessObject.flowNodeRef).toEqual([]);
  expect(flowIds(root(definitions, 'Process_2'))).toEqual([]);
  expect(diIds(definitions).sort()).toEqual(['Lane_1', 'Pool_1']);

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).not.toContain('Task_L');
  expect(xml).not.toContain('Boundary_1');
  expect(xml).not.toContain('attachedToRef');
  expect(xml).not.toContain('flowNodeRef');
  expect(root(reloaded, 'Process_2').laneSets[0].lanes[0].id).toBe('Lane_1');
});

test('deleting a pool takes its contents and the process it depicted', async () => {
  const loaded = await load(POOL_XML);
  const { canvas, definitions } = loaded;

  const removed = canvas.deleteElements(node(canvas, 'Pool_1'));
  expect(ids(removed)).toEqual(['Boundary_1', 'Lane_1', 'Pool_1', 'Task_L']);

  const collaboration = root(definitions, 'Collab_1');
  expect(collaboration.participants).toEqual([]);
  // The process only existed to back the pool — it would be unreachable now.
  expect(root(definitions, 'Process_2')).toBeUndefined();
  expect(planeElements(definitions)).toEqual([]);

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).not.toContain('Process_2');
  expect(xml).not.toContain('Pool_1');
  expect(xml).not.toContain('processRef');
  expect(reloaded.rootElements).toHaveLength(1);
  expect(reloaded.diagrams[0].plane.planeElement ?? []).toEqual([]);
});

// --- the canvas surface ------------------------------------------------------

test('deleteSelection removes the selection and narrows it to the survivors', async () => {
  const loaded = await load();
  const { canvas } = loaded;
  const selectionEvents: string[][] = [];
  canvas.getEventBus().on<SelectionChangedEvent>('selection.changed', (e) => {
    selectionEvents.push(ids(e.newSelection));
  });

  canvas.getSelection().select([node(canvas, 'Task_1'), node(canvas, 'Task_2')]);
  const removed = canvas.deleteSelection();

  expect(ids(removed)).toEqual(['Flow_1', 'Flow_2', 'Task_1', 'Task_2']);
  expect(canvas.getSelection().get()).toEqual([]);
  expect(selectionEvents.at(-1)).toEqual([]);
  expect(canvas.getScene()!.elementsById.size).toBe(2); // Start_1, End_1
});

test('Delete and Backspace on the canvas delete the selection', async () => {
  for (const key of ['Delete', 'Backspace']) {
    const { canvas } = await load();
    canvas.getSelection().select(node(canvas, 'Task_2'));
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    canvas.getSvg().dispatchEvent(event);

    expect(canvas.getScene()!.elementsById.has('Task_2')).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  }
});

test('Backspace inside the inline label editor edits text instead of deleting', async () => {
  const { canvas } = await load();
  const task = node(canvas, 'Task_2');
  canvas.getSelection().select(task);
  expect(canvas.getLabelEditing().activate(task)).toBe(true);

  const input = canvas.getLabelEditing().getInput()!;
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  expect(canvas.getScene()!.elementsById.has('Task_2')).toBe(true);

  // With no editor open the same key does delete it.
  canvas.getLabelEditing().cancel();
  canvas.getSvg().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  expect(canvas.getScene()!.elementsById.has('Task_2')).toBe(false);
});

test('a key with no selection deletes nothing', async () => {
  const loaded = await load();
  const { canvas } = loaded;
  const before = await toXML(loaded);
  const event = new dom.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
  canvas.getSvg().dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(await toXML(loaded)).toBe(before);
});
