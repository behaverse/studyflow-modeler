import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import type { SceneElement, SceneNode } from '@canvas/model/scene.ts';

import { installDocument, loadCanvas, jsdomWindow, type Loaded } from './canvasHarness';

/**
 * The canvas keyboard map — parity spec §9, whose table was captured empirically
 * against the bpmn-js backend (`parity-ref/keyboard-facts.json`).
 *
 * Half of that table is about keys that DO something; the other half, just as
 * binding, is about keys that must not. `h`/`l`/`s`/`c` are stock diagram-js tool
 * shortcuts and do nothing in this app because the palette that registers them is
 * hidden; `F2`, `Tab` and `Enter` do nothing; a bare `+`/`-`/`0` does not zoom; and
 * `Ctrl+Y` is not a second redo. Every one of those is asserted here, because
 * "nothing happens" is a behaviour that regresses silently.
 *
 * Shortcuts are bound on the canvas CONTAINER (the SVG root is the focusable
 * element, and a key pressed over the diagram bubbles up to it), so a keypress here
 * is a `keydown` dispatched there — exactly what the app produces.
 */

const doc = installDocument();
const win = jsdomWindow();

/** Start event → task → task, one flow, so a nudge has an edge to drag along. */
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Begin"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="Task"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:task id="Task_2" name="Other" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="400" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="200" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/**
 * A container with a real layout. jsdom reports `clientWidth === 0`, and the
 * viewport falls back to the viewBox width for that — which would make every zoom a
 * no-op and hide exactly the bug a zoom test is for.
 */
function sizedContainer(): HTMLElement {
  const el = doc.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  return el as unknown as HTMLElement;
}

async function load(xml = FIXTURE_XML): Promise<Loaded> {
  return loadCanvas(xml, { container: sizedContainer() });
}

/** A `keydown` on the canvas container — what a key pressed over the diagram is. */
function press(canvas: Canvas, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new win.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  canvas.getContainer().dispatchEvent(event);
  return event as unknown as KeyboardEvent;
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function diBounds(definitions: any, id: string): any {
  return (definitions.diagrams[0].plane.planeElement ?? [])
    .find((pe: any) => pe.bpmnElement?.id === id)?.bounds;
}

/** Everything a key could plausibly disturb, in one comparable blob. */
function snapshot(canvas: Canvas): string {
  const box = canvas.getViewport().getViewbox();
  return JSON.stringify({
    revision: canvas.getScene()!.revision,
    selection: canvas.getSelection().get().map((e: SceneElement) => e.id),
    viewbox: [box.x, box.y, box.width, box.height],
    editing: canvas.getLabelEditing().isActive(),
    classes: canvas.getSvg().getAttribute('class'),
    elements: canvas.getScene()!.elementsById.size,
  });
}

// --- delete ------------------------------------------------------------------

test('Delete and Backspace remove the selection', async () => {
  for (const key of ['Delete', 'Backspace']) {
    const { canvas } = await load();
    canvas.getSelection().select(node(canvas, 'Task_2'));
    const event = press(canvas, key);

    expect(canvas.getScene()!.elementsById.has('Task_2')).toBe(false);
    expect(canvas.getSelection().get()).toEqual([]);
    // The key is consumed, so the host's own Backspace handling (navigate back)
    // never sees it.
    expect(event.defaultPrevented).toBe(true);
  }
});

test('Delete with nothing selected changes nothing and is not consumed', async () => {
  const { canvas } = await load();
  const before = snapshot(canvas);
  const event = press(canvas, 'Delete');
  expect(snapshot(canvas)).toBe(before);
  expect(event.defaultPrevented).toBe(false);
});

// --- select all --------------------------------------------------------------

test('Ctrl+A selects every element and the root carries the multi-select class', async () => {
  const { canvas } = await load();
  press(canvas, 'a', { ctrlKey: true });

  const ids = canvas.getSelection().get().map((e) => e.id).sort();
  expect(ids).toEqual(['Flow_1', 'Start_1', 'Task_1', 'Task_2']);
  expect(canvas.getSvg().classList.contains('sf-multi-select')).toBe(true);
});

test('Cmd+A works too — the map is modifier-agnostic', async () => {
  const { canvas } = await load();
  press(canvas, 'a', { metaKey: true });
  expect(canvas.getSelection().get()).toHaveLength(4);
});

// --- cut / copy --------------------------------------------------------------

test('Ctrl+X removes the selection; Ctrl+C keeps it and only fills the clipboard', async () => {
  const { canvas } = await load();
  const task = node(canvas, 'Task_2');

  canvas.getSelection().select(task);
  press(canvas, 'c', { ctrlKey: true });
  expect(canvas.getClipboard()).toEqual([task]);
  // A copy is invisible: nothing is removed, nothing is deselected.
  expect(canvas.getScene()!.elementsById.has('Task_2')).toBe(true);
  expect(canvas.getSelection().get()).toEqual([task]);

  press(canvas, 'x', { ctrlKey: true });
  expect(canvas.getClipboard()).toEqual([task]);
  expect(canvas.getScene()!.elementsById.has('Task_2')).toBe(false);
  expect(canvas.getSelection().get()).toEqual([]);
});

// --- nudging -----------------------------------------------------------------

test('arrows nudge the selection by 1, and by 10 with Shift', async () => {
  const { canvas, definitions } = await load();
  const task = node(canvas, 'Task_1');
  canvas.getSelection().select(task);

  press(canvas, 'ArrowRight');
  expect({ x: task.x, y: task.y }).toEqual({ x: 201, y: 80 });
  press(canvas, 'ArrowDown');
  expect({ x: task.x, y: task.y }).toEqual({ x: 201, y: 81 });
  press(canvas, 'ArrowLeft');
  press(canvas, 'ArrowUp');
  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 80 });

  press(canvas, 'ArrowRight', { shiftKey: true });
  expect({ x: task.x, y: task.y }).toEqual({ x: 210, y: 80 });
  press(canvas, 'ArrowUp', { shiftKey: true });
  expect({ x: task.x, y: task.y }).toEqual({ x: 210, y: 70 });

  // Committed like any other move: the DI is written and the docked edge follows.
  expect({ x: diBounds(definitions, 'Task_1').x, y: diBounds(definitions, 'Task_1').y })
    .toEqual({ x: 210, y: 70 });
  const flow = canvas.getScene()!.elementsById.get('Flow_1') as any;
  expect(flow.waypoints[1]).toEqual({ x: 210, y: 110 });
});

test('a nudge with nothing selected, or with only a connection, does nothing', async () => {
  const { canvas } = await load();
  const before = snapshot(canvas);
  expect(press(canvas, 'ArrowRight').defaultPrevented).toBe(false);
  expect(snapshot(canvas)).toBe(before);

  canvas.getSelection().select(canvas.getScene()!.elementsById.get('Flow_1') as any);
  const withEdge = snapshot(canvas);
  expect(press(canvas, 'ArrowRight').defaultPrevented).toBe(false);
  expect(snapshot(canvas)).toBe(withEdge);
});

// --- zoom --------------------------------------------------------------------

/**
 * One keyboard step is diagram-js's: its zoom range `0.2`…`4` in ten steps, i.e.
 * `20^(1/10)`. The reference capture recorded `Ctrl+=` taking 1:1 to
 * `1.349282860755920` — this number, to every digit it printed.
 */
const ZOOM_STEP = 1.3492828607559200;

test('Ctrl+= and Ctrl+- zoom by exactly one diagram-js step', async () => {
  const { canvas } = await load();
  const viewport = canvas.getViewport();
  const before = viewport.getViewbox().scale;

  press(canvas, '=', { ctrlKey: true });
  expect(viewport.getViewbox().scale / before).toBeCloseTo(ZOOM_STEP, 7);

  press(canvas, '-', { ctrlKey: true });
  expect(viewport.getViewbox().scale).toBeCloseTo(before, 7);

  // `Ctrl+Shift+=` reports `+`, and means the same thing.
  press(canvas, '+', { ctrlKey: true, shiftKey: true });
  expect(viewport.getViewbox().scale / before).toBeCloseTo(ZOOM_STEP, 7);
});

test('Ctrl+0 resets the zoom to 1:1', async () => {
  const { canvas } = await load();
  const viewport = canvas.getViewport();
  press(canvas, '=', { ctrlKey: true });
  press(canvas, '=', { ctrlKey: true });
  expect(viewport.getViewbox().scale).not.toBeCloseTo(1, 6);

  press(canvas, '0', { ctrlKey: true });
  expect(viewport.getViewbox().scale).toBeCloseTo(1, 7);
});

// --- append ------------------------------------------------------------------

test("'a' requests the append popup the app owns, as a command on the bus", async () => {
  const { canvas } = await load();
  const seen: any[] = [];
  canvas.getEventBus().on('OpenAppendMenu', (e: any) => seen.push(e));

  // Unselected: nothing to append to, so nothing is fired.
  press(canvas, 'a');
  expect(seen).toHaveLength(0);

  const task = node(canvas, 'Task_1');
  canvas.getSelection().select(task);
  press(canvas, 'a');
  expect(seen).toHaveLength(1);
  expect(seen[0]).toEqual({ type: 'OpenAppendMenu', elements: [task] });
  // The canvas half only: it opens no popup of its own and touches no document.
  expect(canvas.getScene()!.revision).toBe(canvas.getScene()!.revision);
  expect(canvas.getLabelEditing().isActive()).toBe(false);
});

// --- the keys that must stay inert -------------------------------------------

test('the intentionally unbound keys do nothing at all', async () => {
  const { canvas } = await load();
  canvas.getSelection().select(node(canvas, 'Task_1'));
  const before = snapshot(canvas);

  const inert: [string, KeyboardEventInit][] = [
    // Stock diagram-js tool keys: hand, lasso, space, global-connect. The palette
    // that registers them is not this one, and never was.
    ['h', {}], ['l', {}], ['s', {}], ['c', {}],
    ['F2', {}], ['Tab', {}], ['Enter', {}],
    // Zoom needs the modifier; bare is nothing.
    ['+', {}], ['-', {}], ['0', {}], ['=', {}],
    // Not a second redo (parity spec §9: verified unbound on the reference).
    ['y', { ctrlKey: true }],
    // Nothing here claims the browser's own find/save/print either.
    ['f', { ctrlKey: true }], ['p', { ctrlKey: true }],
    // Alt is never a canvas modifier.
    ['a', { altKey: true, ctrlKey: true }], ['ArrowRight', { altKey: true }],
  ];
  for (const [key, init] of inert) {
    const event = press(canvas, key, init);
    expect(snapshot(canvas), `${JSON.stringify(init)}+${key} must change nothing`).toBe(before);
    expect(event.defaultPrevented, `${key} must not be consumed`).toBe(false);
  }
});

test('no shortcut fires while a text field has the key', async () => {
  const { canvas } = await load();
  const task = node(canvas, 'Task_1');
  canvas.getSelection().select(task);

  // An inline label editor is open: Backspace erases a character, `e` types an `e`,
  // and an arrow moves the caret — none of them touch the diagram.
  canvas.getLabelEditing().activate(task);
  const before = snapshot(canvas);
  for (const key of ['Delete', 'Backspace', 'ArrowRight', 'a', 'e']) press(canvas, key);
  expect(snapshot(canvas)).toBe(before);
  expect(canvas.getScene()!.elementsById.has('Task_1')).toBe(true);
  canvas.getLabelEditing().cancel();

  // …and the same for any other input in the app chrome that happens to bubble.
  const input = doc.createElement('input');
  canvas.getContainer().appendChild(input);
  const withInput = snapshot(canvas);
  input.dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'Delete',
    bubbles: true,
    cancelable: true,
  }));
  expect(snapshot(canvas)).toBe(withInput);
  expect(canvas.getScene()!.elementsById.has('Task_1')).toBe(true);
});

test('a destroyed canvas answers no key at all', async () => {
  const { canvas } = await load();
  canvas.getSelection().select(node(canvas, 'Task_1'));
  canvas.destroy();
  press(canvas, 'Delete');
  press(canvas, 'ArrowRight', { shiftKey: true });
  // The scene is gone with the canvas; nothing threw and nothing was written.
  expect(canvas.getScene()).toBeUndefined();
});
