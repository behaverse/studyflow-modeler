import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import { isOrthogonal } from '@canvas/routing/orthogonal.ts';

import { edge, loadYaml, node, xmlOf, type Loaded } from './canvasHarness';

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
const FIXTURE_YAML = `id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    Start_1:
      type: StartEvent
      bounds: 100 100 36 36
    Task_1:
      type: Task
      name: Read the brief
      bounds: 200 80 100 80
    End_1:
      type: EndEvent
      bounds: 400 100 36 36
    Flow_1:
      sourceRef: Start_1
      targetRef: Task_1
      waypoint: 136,118 200,120
    Flow_2:
      sourceRef: Task_1
      targetRef: End_1
      waypoint: 300,120 400,118
`;

function load(yaml = FIXTURE_YAML): Loaded {
  return loadYaml(yaml);
}

test('replacing a task mints the new type, keeps the name, rewires both flows — proven by toXML — and selects it', async () => {
  const loaded = load();
  const { canvas, moddle } = loaded;
  const task = node(canvas, 'Task_1');

  const replacement = canvas.replaceElement(task, { type: 'bpmn:UserTask' });

  expect(replacement, 'the swap was allowed').toBeTruthy();
  expect(replacement!.type).toBe('bpmn:UserTask');
  expect(replacement!.id).not.toBe('Task_1');

  const xml = await xmlOf(loaded);

  // The old element is gone from the document, not merely from the scene.
  expect(xml).not.toContain('id="Task_1"');
  expect(xml).not.toContain('bpmnElement="Task_1"');
  // …and the new one is filed in the process with the name carried across.
  expect(xml).toMatch(/<bpmn:userTask\b[^>]*\bname="Read the brief"/);

  // Both flows name the replacement on the reference AND on the back-reference.
  const id = replacement!.id;
  expect(xml).toMatch(new RegExp(`<bpmn:userTask\\b[^>]*\\bid="${id}"`));
  /** The opening tag of the element `elementId` names. */
  const tagOf = (elementId: string): string => xml.match(new RegExp(`<bpmn:\\w+\\b[^>]*\\bid="${elementId}"[^>]*>`))?.[0] ?? '';
  expect(tagOf('Flow_1')).toContain(`targetRef="${id}"`);
  expect(tagOf('Flow_2')).toContain(`sourceRef="${id}"`);
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
    const { canvas } = load();
    const task = node(canvas, 'Task_1');
    canvas.getMutator()!.setNodeBounds(task, { x: 200, y: 80, width: 160, height: 120 });

    const replacement = canvas.replaceElement(task, { type })!;

    expect({ width: replacement.width, height: replacement.height }, label).toEqual(size);
    expect({ x: replacement.x + replacement.width / 2, y: replacement.y + replacement.height / 2 }, label).toEqual({ x: 280, y: 140 });
  }
});

test('the flows are re-routed onto the replacement, squarely', async () => {
  const { canvas } = load();

  const replacement = canvas.replaceElement(node(canvas, 'Task_1'), { type: 'bpmn:EndEvent' })!;

  for (const flow of [edge(canvas, 'Flow_1'), edge(canvas, 'Flow_2')]) {
    expect(isOrthogonal(flow.waypoints), `${flow.id} is square`).toBe(true);
  }
  expect(edge(canvas, 'Flow_1').target).toBe(replacement);
  expect(edge(canvas, 'Flow_2').source).toBe(replacement);
});

test('replacing an element with the type it already is writes nothing', async () => {
  const loaded = load();
  const { canvas } = loaded;
  const before = await xmlOf(loaded);
  const revision = canvas.getScene()!.revision;

  expect(canvas.replaceElement(node(canvas, 'Task_1'), { type: 'bpmn:Task' })).toBeUndefined();

  expect(canvas.getScene()!.revision).toBe(revision);
  expect(await xmlOf(loaded)).toBe(before);
});

test('a container with contents is not replaceable, so nothing inside it can be lost', async () => {
  // Task_1 as a sub-process with a task inside it.
  const { canvas } = load(FIXTURE_YAML.replace(
    '      type: Task\n',
    '      type: SubProcess\n      flowElements:\n        Inner: { type: Task, bounds: 220 100 60 40 }\n',
  ));
  const container = node(canvas, 'Task_1');

  expect(canvas.getRules().canReplace(container, 'bpmn:Task')).toBe(false);
  expect(canvas.replaceElement(container, { type: 'bpmn:Task' })).toBeUndefined();
  // Emptied, it is replaceable.
  canvas.deleteElements(node(canvas, 'Inner'));
  expect(canvas.getRules().canReplace(container, 'bpmn:Task')).toBe(true);
});

test('replacing an event with a variant of the same type mints the event definition', async () => {
  const { canvas } = load();
  const task = node(canvas, 'Task_1');
  const end = canvas.replaceElement(task, { type: 'bpmn:EndEvent' })!;
  const attrs = { eventDefinitions: [{ type: 'bpmn:ErrorEventDefinition' }] };
  const errorEnd = canvas.replaceElement(end, { type: 'bpmn:EndEvent', attrs })!;
  expect(errorEnd).toBeDefined();
  expect((errorEnd.businessObject as any).eventDefinitions[0].$type).toBe('bpmn:ErrorEventDefinition');
  // The same variant again is "what it already is".
  expect(canvas.replaceElement(errorEnd, { type: 'bpmn:EndEvent', attrs })).toBeUndefined();
});
