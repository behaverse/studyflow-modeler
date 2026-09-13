import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import { isOrthogonal } from '@canvas/routing/orthogonal.ts';
import type { SceneEdge, SceneNode } from '@canvas/model/scene.ts';

import { loadCanvas } from './canvasHarness';

/**
 * Retyping an element in place — the context pad's wrench, "Change element",
 * `Canvas.replaceElement`.
 *
 * There is no rewriting a moddle object's `$type`, so a replace is a create, a
 * rewire and a delete pretending to be one edit. What has to be true afterwards is
 * therefore all document-level, and all of it is asserted here through `toXML`
 * rather than off the scene alone: the old business object is GONE from the process
 * and from the plane, the new one is filed in its place, every flow that reached the
 * old one now names the new one on BOTH sides of the reference (`sourceRef`/
 * `targetRef` and the `incoming`/`outgoing` back-references bpmn-moddle serializes),
 * and the whole thing re-imports.
 */

/** `Start_1 → Task_1 → End_1`, so the replaced task has a flow on each side. */
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="Read the brief">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="400" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="200" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="300" y="120" /><di:waypoint x="400" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(xml = FIXTURE_XML): Promise<{ canvas: Canvas; definitions: any; moddle: any }> {
  return loadCanvas(xml);
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function edge(canvas: Canvas, id: string): SceneEdge {
  return canvas.getScene()!.elementsById.get(id) as SceneEdge;
}

const serialize = (moddle: any, definitions: any): Promise<string> =>
  moddle.toXML(definitions, { format: true }).then((r: any) => r.xml);

test('replacing a task mints the new type, keeps the name, rewires both flows — proven by toXML — and selects it', async () => {
  const { canvas, definitions, moddle } = await load();
  const task = node(canvas, 'Task_1');

  const replacement = canvas.replaceElement(task, { type: 'bpmn:UserTask' });

  expect(replacement, 'the swap was allowed').toBeTruthy();
  expect(replacement!.type).toBe('bpmn:UserTask');
  expect(replacement!.id).not.toBe('Task_1');

  const xml = await (canvas.syncDi(), serialize(moddle, definitions));

  // The old element is gone from the document, not merely from the scene.
  expect(xml).not.toContain('id="Task_1"');
  expect(xml).not.toContain('bpmnElement="Task_1"');
  // …and the new one is filed in the process with the name carried across.
  expect(xml).toMatch(/<bpmn:userTask[^>]*id="([^"]+)"[^>]*name="Read the brief"/);

  // Both flows name the replacement on the reference AND on the back-reference.
  const id = replacement!.id;
  expect(xml).toMatch(new RegExp(`<bpmn:sequenceFlow[^>]*id="Flow_1"[^>]*targetRef="${id}"`));
  expect(xml).toMatch(new RegExp(`<bpmn:sequenceFlow[^>]*id="Flow_2"[^>]*sourceRef="${id}"`));
  expect(xml).toContain('<bpmn:incoming>Flow_1</bpmn:incoming>');
  expect(xml).toContain('<bpmn:outgoing>Flow_2</bpmn:outgoing>');

  // The DI followed: one shape for the replacement, none for what it replaced.
  expect(xml).toMatch(new RegExp(`<bpmndi:BPMNShape[^>]*bpmnElement="${id}"`));

  // And the whole thing re-imports — the strongest statement that nothing was left
  // dangling (a flow pointing at an unfiled business object throws here).
  const { rootElement: reimported } = await moddle.fromXML(xml);
  const reloaded = new Canvas();
  reloaded.importDefinitions(reimported);
  expect(reloaded.getScene()!.elementsById.get(id)).toBeTruthy();

  expect(canvas.getSelection().get()).toEqual([replacement]);
});

test('a replacement keeps the centre, in its own type\'s footprint unless both types share a shape', async () => {
  // Task_1 is resized to 160x120 first: a size the user chose.
  const CASES: [label: string, type: string, size: { width: number; height: number }][] = [
    ['a task becomes an end event: a circle, not a 160x120 one', 'bpmn:EndEvent', { width: 36, height: 36 }],
    ['a task becomes a service task: the size the user chose', 'bpmn:ServiceTask', { width: 160, height: 120 }],
  ];
  for (const [label, type, size] of CASES) {
    const { canvas } = await load();
    const task = node(canvas, 'Task_1');
    canvas.getMutator()!.setNodeBounds(task, { x: 200, y: 80, width: 160, height: 120 });

    const replacement = canvas.replaceElement(task, { type })!;

    expect({ width: replacement.width, height: replacement.height }, label).toEqual(size);
    expect({ x: replacement.x + replacement.width / 2, y: replacement.y + replacement.height / 2 }, label).toEqual({ x: 280, y: 140 });
  }
});

test('the flows are re-routed onto the replacement, squarely', async () => {
  const { canvas } = await load();

  const replacement = canvas.replaceElement(node(canvas, 'Task_1'), { type: 'bpmn:EndEvent' })!;

  for (const flow of [edge(canvas, 'Flow_1'), edge(canvas, 'Flow_2')]) {
    expect(isOrthogonal(flow.waypoints), `${flow.id} is square`).toBe(true);
  }
  expect(edge(canvas, 'Flow_1').target).toBe(replacement);
  expect(edge(canvas, 'Flow_2').source).toBe(replacement);
});

test('replacing an element with the type it already is writes nothing', async () => {
  const { canvas, definitions, moddle } = await load();
  const before = await (canvas.syncDi(), serialize(moddle, definitions));
  const revision = canvas.getScene()!.revision;

  expect(canvas.replaceElement(node(canvas, 'Task_1'), { type: 'bpmn:Task' })).toBeUndefined();

  expect(canvas.getScene()!.revision).toBe(revision);
  expect(await (canvas.syncDi(), serialize(moddle, definitions))).toBe(before);
});

test('a container with contents is not replaceable, so nothing inside it can be lost', async () => {
  const { canvas } = await load(FIXTURE_XML
    .replace('<bpmn:task id="Task_1" name="Read the brief">', '<bpmn:subProcess id="Task_1" name="Read the brief">')
    .replace('</bpmn:task>', '<bpmn:task id="Inner" /></bpmn:subProcess>')
    .replace('</bpmndi:BPMNPlane>', '<bpmndi:BPMNShape id="Inner_di" bpmnElement="Inner"><dc:Bounds x="220" y="100" width="60" height="40" /></bpmndi:BPMNShape></bpmndi:BPMNPlane>'));
  const container = node(canvas, 'Task_1');

  expect(canvas.getRules().canReplace(container, 'bpmn:Task')).toBe(false);
  expect(canvas.replaceElement(container, { type: 'bpmn:Task' })).toBeUndefined();
  // Emptied, it is replaceable.
  canvas.deleteElements(node(canvas, 'Inner'));
  expect(canvas.getRules().canReplace(container, 'bpmn:Task')).toBe(true);
});

test('replacing an event with a variant of the same type mints the event definition', async () => {
  const { canvas } = await load();
  const task = node(canvas, 'Task_1');
  const end = canvas.replaceElement(task, { type: 'bpmn:EndEvent' })!;
  const attrs = { eventDefinitions: [{ type: 'bpmn:ErrorEventDefinition' }] };
  const errorEnd = canvas.replaceElement(end, { type: 'bpmn:EndEvent', attrs })!;
  expect(errorEnd).toBeDefined();
  expect((errorEnd.businessObject as any).eventDefinitions[0].$type).toBe('bpmn:ErrorEventDefinition');
  // The same variant again is "what it already is".
  expect(canvas.replaceElement(errorEnd, { type: 'bpmn:EndEvent', attrs })).toBeUndefined();
});
