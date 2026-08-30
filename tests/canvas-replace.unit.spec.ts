import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import { isOrthogonal } from '@canvas/routing/orthogonal.ts';
import type { SceneEdge, SceneNode } from '@canvas/model/scene.ts';

import { loadCanvas } from './canvasHarness';

/**
 * Retyping an element in place — the context pad's wrench, "Change element"
 * (ux-spec §4 entry 4), `Canvas.replaceElement`.
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

test('replacing a task mints the new type, keeps the name and rewires both flows — proven by toXML', async () => {
  const { canvas, definitions, moddle } = await load();
  const task = node(canvas, 'Task_1');

  const replacement = canvas.replaceElement(task, { type: 'bpmn:UserTask' });

  expect(replacement, 'the swap was allowed').toBeTruthy();
  expect(replacement!.type).toBe('bpmn:UserTask');
  expect(replacement!.id).not.toBe('Task_1');

  const xml = await serialize(moddle, definitions);

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
});

test('a task becomes an end event at the same CENTRE, in the end event\'s own footprint', async () => {
  const { canvas } = await load();
  const task = node(canvas, 'Task_1');
  const centre = { x: task.x + task.width / 2, y: task.y + task.height / 2 };

  const replacement = canvas.replaceElement(task, { type: 'bpmn:EndEvent' })!;

  // A circle, not a 100x80 circle: the footprint comes from the type being minted.
  expect(replacement.width).toBe(36);
  expect(replacement.height).toBe(36);
  expect(replacement.x + replacement.width / 2).toBe(centre.x);
  expect(replacement.y + replacement.height / 2).toBe(centre.y);
});

test('two types of the same shape keep a size the user chose', async () => {
  const { canvas } = await load();
  const task = node(canvas, 'Task_1');
  canvas.getWriteback()!.setNodeBounds(task, { x: 200, y: 80, width: 160, height: 120 });

  const replacement = canvas.replaceElement(task, { type: 'bpmn:ServiceTask' })!;

  expect({ width: replacement.width, height: replacement.height })
    .toEqual({ width: 160, height: 120 });
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

test('the replacement becomes the selection', async () => {
  const { canvas } = await load();
  const replacement = canvas.replaceElement(node(canvas, 'Task_1'), { type: 'bpmn:UserTask' })!;
  expect(canvas.getSelection().get()).toEqual([replacement]);
});

test('replacing an element with the type it already is writes nothing', async () => {
  const { canvas, definitions, moddle } = await load();
  const before = await serialize(moddle, definitions);
  const revision = canvas.getScene()!.revision;

  expect(canvas.replaceElement(node(canvas, 'Task_1'), { type: 'bpmn:Task' })).toBeUndefined();

  expect(canvas.getScene()!.revision).toBe(revision);
  expect(await serialize(moddle, definitions)).toBe(before);
});

test('the rules refuse what cannot be retyped in place', async () => {
  const { canvas } = await load();
  const rules = canvas.getRules();

  // A flow node may become another flow node…
  expect(rules.canReplace(node(canvas, 'Task_1'), 'bpmn:UserTask')).toBe(true);
  expect(rules.canReplace(node(canvas, 'Start_1'), 'bpmn:EndEvent')).toBe(true);
  // …but not a connection, and not something that is not a flow node either.
  expect(rules.canReplace(edge(canvas, 'Flow_1'), 'bpmn:Task')).toBe(false);
  expect(rules.canReplace(node(canvas, 'Task_1'), 'bpmn:Participant')).toBe(false);
  expect(rules.canReplace(node(canvas, 'Task_1'), 'bpmn:BoundaryEvent')).toBe(false);
  // With no successor named it is the pad's weaker question — "is this replaceable
  // at all?" — which is what gates the wrench.
  expect(rules.canReplace(node(canvas, 'Task_1'))).toBe(true);
  expect(rules.canReplace(edge(canvas, 'Flow_1'))).toBe(false);
});

test('a container with contents is not replaceable, so nothing inside it can be lost', async () => {
  const { canvas } = await load(FIXTURE_XML.replace(
    '<bpmn:task id="Task_1" name="Read the brief">',
    '<bpmn:subProcess id="Task_1" name="Read the brief">',
  ).replace('</bpmn:task>', '</bpmn:subProcess>'));

  const container = node(canvas, 'Task_1');
  // Empty, so it IS replaceable…
  expect(canvas.getRules().canReplace(container, 'bpmn:Task')).toBe(true);
  // …until something lives in it.
  container.children.push(node(canvas, 'End_1'));
  expect(canvas.getRules().canReplace(container, 'bpmn:Task')).toBe(false);
  expect(canvas.replaceElement(container, { type: 'bpmn:Task' })).toBeUndefined();
});
