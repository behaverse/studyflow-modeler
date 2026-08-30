import { expect, test } from '@playwright/test';

import {
  DEFAULT_BOTTOM as CORE_DEFAULT_BOTTOM,
  DEFAULT_TOP as CORE_DEFAULT_TOP,
} from '@core/document';
import type { Canvas } from '@canvas/index.ts';
import { choreographyBandAt, editorBounds, labelBounds } from '@canvas/interaction/labelEditing.ts';
import { CANVAS_CSS } from '@canvas/view/theme.ts';
import { DEFAULT_BOTTOM, DEFAULT_TOP } from '@canvas/model/choreography.ts';
import type { DirectEditingEvent, ElementDblClickEvent } from '@canvas/interaction/labelEditing.ts';
import { externalLabelBounds, LABEL_FONT, measureLabelWidth } from '@canvas/render/labels.ts';
import { choreographyBandHeight } from '@canvas/render/shapes.ts';
import type { SceneNode } from '@canvas/model/scene.ts';
import type { ElementChangedEvent } from '@canvas/model/writeback.ts';

import { freshModdle, loadCanvas, jsdomWindow, type Loaded } from './canvasHarness';
import { exampleXml } from './utils';

/**
 * P3 inline label editing (design §3 `interaction/labelEditing.ts`, §6). Same jsdom
 * harness as `canvas-render`/`canvas-selection`/`canvas-drag`: the canvas is driven
 * through `setDocument`, and a double click is a real DOM event on the SVG root.
 *
 * The contract under test mirrors the geometry write-through of `canvas-drag`, one
 * level up: committing the inline editor writes the typed text onto the LIVE business
 * object through moddle `set`, so re-serializing the SAME `Definitions` tree emits the
 * new `name=` — and Escape leaves the document byte-identical.
 *
 * The overlay is a plain `<textarea>` in the canvas container (not an SVG
 * `foreignObject`), so "typing" here is setting `.value` and pressing a key, exactly
 * what a user's keystrokes end up producing.
 */

const win = jsdomWindow();

/** Start event (named, so it has an external label) → task → exclusive gateway. */
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Begin"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="Task"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:exclusiveGateway id="Gate_1" name="Correct?" />
    <bpmn:task id="Task_2" name="Untouched" />
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
      <bpmndi:BPMNShape id="Gate_1_di" bpmnElement="Gate_1" isMarkerVisible="true">
        <dc:Bounds x="400" y="95" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_2_di" bpmnElement="Task_2">
        <dc:Bounds x="600" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="200" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** A named sequence flow — the connection-caption half of the external-label tests. */
const EDGE_LABEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_3" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_3" isExecutable="false">
    <bpmn:startEvent id="Start_3"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_3"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="Flow_1" name="again" sourceRef="Start_3" targetRef="Task_3" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_3">
    <bpmndi:BPMNPlane id="Plane_3" bpmnElement="Process_3">
      <bpmndi:BPMNShape id="Start_3_di" bpmnElement="Start_3">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_3_di" bpmnElement="Task_3">
        <dc:Bounds x="300" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" /><di:waypoint x="300" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** A choreography task with NO participants — exercises the create-on-first-edit path. */
const BARE_CHOREOGRAPHY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_2" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_2" isExecutable="false">
    <bpmn:choreographyTask id="Chore_1" name="Exchange" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_2">
    <bpmndi:BPMNPlane id="Plane_2" bpmnElement="Process_2">
      <bpmndi:BPMNShape id="Chore_1_di" bpmnElement="Chore_1">
        <dc:Bounds x="100" y="100" width="200" height="120" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function load(xml: string): Promise<Loaded> {
  return loadCanvas(xml);
}

/** Serialize the SAME tree back to XML and re-parse it — the edit→save→reload path. */
async function roundTrip(loaded: Loaded): Promise<{ xml: string; reloaded: any }> {
  const { xml } = await loaded.moddle.toXML(loaded.definitions);
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  return { xml, reloaded };
}

/** The business object of `id` in a (possibly reloaded) tree — never via the scene. */
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

// --- DOM helpers -------------------------------------------------------------

interface Pt { x: number; y: number; }

function fireMouse(canvas: Canvas, target: EventTarget, type: string, diagram: Pt): void {
  const screen = canvas.getViewport().toScreen(diagram);
  target.dispatchEvent(new win.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: screen.x,
    clientY: screen.y,
    button: 0,
  }));
}

/** A double click at a diagram point — what opens the inline editor. */
function dblclick(canvas: Canvas, at: Pt): void {
  fireMouse(canvas, canvas.getSvg(), 'dblclick', at);
}

function key(canvas: Canvas, name: string, init: KeyboardEventInit = {}): void {
  const input = canvas.getLabelEditing().getInput();
  if (!input) throw new Error('no inline editor is open');
  input.dispatchEvent(new win.KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  }));
}

/**
 * A canvas-scoped keypress: the canvas binds its shortcuts on the CONTAINER (the SVG
 * root is the focusable element and the event bubbles up to it), so this is what a
 * key pressed over the diagram actually looks like.
 */
function pressKey(canvas: Canvas, name: string, init: KeyboardEventInit = {}): void {
  canvas.getContainer().dispatchEvent(new win.KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  }));
}

/** Replace the editor's text, as a user's keystrokes would. */
function type(canvas: Canvas, text: string): void {
  const input = canvas.getLabelEditing().getInput();
  if (!input) throw new Error('no inline editor is open');
  input.value = text;
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
}

/** A scene element's business object, as the untyped moddle bag it really is. */
function bo(element: SceneNode): any {
  return element.businessObject as any;
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function center(n: SceneNode): Pt {
  return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
}

/** The text the renderer drew inside an element's `<g>`. */
function renderedText(canvas: Canvas, id: string): string {
  const g = canvas.getGraphics(id);
  if (!g) return '';
  return Array.from(g.querySelectorAll('text')).map((t) => t.textContent ?? '').join(' ');
}

/** The overlay `<textarea>` currently mounted in the canvas container, if any. */
function overlay(canvas: Canvas): HTMLTextAreaElement | null {
  return canvas.getContainer().querySelector('textarea.sf-label-editor');
}

// --- opening -----------------------------------------------------------------

test('dblclick on a task opens an inline editor seeded with the current name', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');

  expect(canvas.getLabelEditing().isActive()).toBe(false);
  dblclick(canvas, center(task));

  const editing = canvas.getLabelEditing();
  expect(editing.isActive()).toBe(true);
  expect(editing.getValue()).toBe('Task');
  expect(editing.getSession()!.band).toBe('name');
  expect(editing.getSession()!.element.id).toBe('Task_1');
  // Mounted in the container as a real, editable DOM node (works under jsdom).
  const input = overlay(canvas);
  expect(input).not.toBeNull();
  expect(input!.getAttribute('data-element-id')).toBe('Task_1');
  // A task's label is internal: the editor covers the shape itself.
  expect(editing.getSession()!.bounds).toEqual({ x: 200, y: 80, width: 100, height: 80 });
});

test('dblclick fires element.dblclick on the bus before the editor opens', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const seen: ElementDblClickEvent[] = [];
  canvas.getEventBus().on<ElementDblClickEvent>('element.dblclick', (e) => seen.push(e));

  const task = node(canvas, 'Task_1');
  dblclick(canvas, center(task));

  expect(seen).toHaveLength(1);
  expect(seen[0].element.id).toBe('Task_1');
  expect(seen[0].originalEvent).toBeTruthy();
  expect(seen[0].point).toEqual(center(task));
});

test('dblclick on an event external label opens the editor for the event, placed on the label', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const start = node(canvas, 'Start_1');
  const box = externalLabelBounds(start, start.label);
  // A point in the label box below the circle — outside every shape's bounds.
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  expect(canvas.hitTest(at)).toBeUndefined();

  dblclick(canvas, at);

  const session = canvas.getLabelEditing().getSession()!;
  expect(session.element.id).toBe('Start_1');
  expect(session.initial).toBe('Begin');
  // External placement: the editor is centred on the text below the shape, not on it.
  expect(session.bounds).toEqual(box);
  expect(session.bounds.y + session.bounds.height / 2).toBeGreaterThan(start.y + start.height);
  expect(session.bounds.width).toBeGreaterThan(start.width);
});

test('a gateway edits its external label; label placement follows the drawer', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const gate = node(canvas, 'Gate_1');
  dblclick(canvas, center(gate));

  const session = canvas.getLabelEditing().getSession()!;
  expect(session.initial).toBe('Correct?');
  expect(session.bounds).toEqual(externalLabelBounds(gate, gate.label));
  expect(labelBounds(gate, 'name')).toEqual(externalLabelBounds(gate, gate.label));
});

// --- committing --------------------------------------------------------------

test('commit writes businessObject.name through moddle, bumps the revision, fires element.changed', async () => {
  const { canvas, definitions } = await load(FIXTURE_XML);
  const changed: ElementChangedEvent[] = [];
  canvas.getEventBus().on<ElementChangedEvent>('element.changed', (e) => changed.push(e));

  const task = node(canvas, 'Task_1');
  const revisionBefore = canvas.getScene()!.revision;

  dblclick(canvas, center(task));
  type(canvas, 'Practice block');
  key(canvas, 'Enter');

  // The scene's business object IS the tree's, mutated in place (no rebuild).
  expect(task.businessObject).toBe(boOf(definitions, 'Task_1'));
  expect(bo(task).get('name')).toBe('Practice block');
  expect(canvas.getScene()!.revision).toBe(revisionBefore + 1);
  expect(changed.map((e) => e.element.id)).toEqual(['Task_1']);
  // The editor closed and its DOM node is gone.
  expect(canvas.getLabelEditing().isActive()).toBe(false);
  expect(overlay(canvas)).toBeNull();
});

test('commit re-renders the label text', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  expect(renderedText(canvas, 'Task_1')).toContain('Task');

  dblclick(canvas, center(task));
  type(canvas, 'Encoding');
  key(canvas, 'Enter');

  expect(renderedText(canvas, 'Task_1')).toContain('Encoding');
  expect(renderedText(canvas, 'Task_1')).not.toContain('Task');
});

test('commit → save → reload: the XML carries the new name, other names are untouched', async () => {
  const loaded = await load(FIXTURE_XML);
  const { canvas } = loaded;

  dblclick(canvas, center(node(canvas, 'Task_1')));
  type(canvas, 'Practice block');
  key(canvas, 'Enter');

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain('name="Practice block"');
  expect(xml).not.toContain('<bpmn:task id="Task_1" name="Task"');
  expect(boOf(reloaded, 'Task_1').name).toBe('Practice block');
  // Every other name round-trips unchanged.
  expect(boOf(reloaded, 'Task_2').name).toBe('Untouched');
  expect(boOf(reloaded, 'Start_1').name).toBe('Begin');
  expect(boOf(reloaded, 'Gate_1').name).toBe('Correct?');
});

test('commit trims the typed text', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  dblclick(canvas, center(task));
  type(canvas, '  Encoding  ');
  key(canvas, 'Enter');
  expect(bo(task).get('name')).toBe('Encoding');
});

test('committing unchanged text writes nothing — no revision bump, no event', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const changed: ElementChangedEvent[] = [];
  canvas.getEventBus().on<ElementChangedEvent>('element.changed', (e) => changed.push(e));
  const revisionBefore = canvas.getScene()!.revision;

  dblclick(canvas, center(node(canvas, 'Task_1')));
  key(canvas, 'Enter');

  expect(canvas.getScene()!.revision).toBe(revisionBefore);
  expect(changed).toHaveLength(0);
  expect(canvas.getLabelEditing().isActive()).toBe(false);
});

test('blur commits the editor', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  dblclick(canvas, center(task));
  type(canvas, 'Blurred');
  canvas.getLabelEditing().getInput()!.dispatchEvent(new win.Event('blur'));

  expect(bo(task).get('name')).toBe('Blurred');
  expect(overlay(canvas)).toBeNull();
});

// --- cancelling --------------------------------------------------------------

test('Escape leaves the name unchanged and the document byte-identical', async () => {
  const loaded = await load(FIXTURE_XML);
  const { canvas } = loaded;
  const before = (await loaded.moddle.toXML(loaded.definitions)).xml;
  const changed: ElementChangedEvent[] = [];
  canvas.getEventBus().on<ElementChangedEvent>('element.changed', (e) => changed.push(e));

  const task = node(canvas, 'Task_1');
  const revisionBefore = canvas.getScene()!.revision;

  dblclick(canvas, center(task));
  type(canvas, 'Never committed');
  key(canvas, 'Escape');

  expect(bo(task).get('name')).toBe('Task');
  expect(canvas.getScene()!.revision).toBe(revisionBefore);
  expect(changed).toHaveLength(0);
  expect(canvas.getLabelEditing().isActive()).toBe(false);
  expect(overlay(canvas)).toBeNull();
  expect(renderedText(canvas, 'Task_1')).toContain('Task');

  const { xml } = await roundTrip(loaded);
  expect(xml).toBe(before);
});

test('directEditing.activate / .complete / .cancel report the session', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const bus = canvas.getEventBus();
  const log: string[] = [];
  bus.on<DirectEditingEvent>('directEditing.activate', (e) => log.push(`activate:${e.initial}`));
  bus.on<DirectEditingEvent>('directEditing.complete', (e) => log.push(`complete:${e.value}`));
  bus.on<DirectEditingEvent>('directEditing.cancel', (e) => log.push(`cancel:${e.initial}`));

  dblclick(canvas, center(node(canvas, 'Task_1')));
  type(canvas, 'One');
  key(canvas, 'Enter');
  dblclick(canvas, center(node(canvas, 'Task_1')));
  key(canvas, 'Escape');

  expect(log).toEqual(['activate:Task', 'complete:One', 'activate:One', 'cancel:One']);
});

// --- choreography bands ------------------------------------------------------

test('the canvas band placeholders match @core/document/choreography', async () => {
  expect(DEFAULT_TOP).toBe(CORE_DEFAULT_TOP);
  expect(DEFAULT_BOTTOM).toBe(CORE_DEFAULT_BOTTOM);
});

test('choreography: the band under the pointer decides what is edited', async () => {
  const { canvas } = await load(exampleXml('choreography_demo.studyflow.png'));
  const chore = node(canvas, 'Consent');
  const band = choreographyBandHeight(chore.height);

  expect(choreographyBandAt(chore, { x: chore.x + 10, y: chore.y + 1 })).toBe('top');
  expect(choreographyBandAt(chore, center(chore))).toBe('name');
  expect(choreographyBandAt(chore, { x: chore.x + 10, y: chore.y + chore.height - 1 })).toBe('bottom');

  dblclick(canvas, { x: chore.x + chore.width / 2, y: chore.y + band / 2 });
  const session = canvas.getLabelEditing().getSession()!;
  expect(session.band).toBe('top');
  expect(session.initial).toBe('Subject');
  expect(session.bounds).toEqual({ x: chore.x, y: chore.y, width: chore.width, height: band });
});

test('choreography: editing a band writes the PARTICIPANT name, not the task name', async () => {
  const loaded = await load(exampleXml('choreography_demo.studyflow.png'));
  const { canvas, definitions } = loaded;
  const chore = node(canvas, 'Consent');
  const band = choreographyBandHeight(chore.height);
  const changed: ElementChangedEvent[] = [];
  canvas.getEventBus().on<ElementChangedEvent>('element.changed', (e) => changed.push(e));

  dblclick(canvas, { x: chore.x + chore.width / 2, y: chore.y + band / 2 });
  type(canvas, 'Volunteer');
  key(canvas, 'Enter');

  // The participant moddle object was mutated in place…
  expect(boOf(definitions, 'Participant_Subject').get('name')).toBe('Volunteer');
  // …and the choreography task's own name is untouched.
  expect(bo(chore).get('name')).toBe('Give consent');
  expect(renderedText(canvas, 'Consent')).toContain('Volunteer');

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain('<bpmn2:participant id="Participant_Subject" name="Volunteer" />');
  expect(boOf(reloaded, 'Participant_Subject').name).toBe('Volunteer');
  expect(boOf(reloaded, 'Participant_Experimenter').name).toBe('Experimenter');
  expect(boOf(reloaded, 'Consent').name).toBe('Give consent');

  // The participant is shared: every task that draws a band for it goes stale at
  // once, so all three are re-drawn and all three report `element.changed`.
  for (const id of ['Consent', 'Round', 'Round2']) {
    expect(renderedText(canvas, id)).toContain('Volunteer');
    expect(renderedText(canvas, id)).not.toContain('Subject');
  }
  expect(new Set(changed.map((e) => e.element.id))).toEqual(
    new Set(['Consent', 'Round', 'Round2']),
  );
  expect(canvas.getScene()!.revision).toBe(1);
});

test('choreography: editing the middle band edits the task name', async () => {
  const loaded = await load(exampleXml('choreography_demo.studyflow.png'));
  const { canvas, definitions } = loaded;
  const chore = node(canvas, 'Consent');

  dblclick(canvas, center(chore));
  expect(canvas.getLabelEditing().getSession()!.band).toBe('name');
  expect(canvas.getLabelEditing().getValue()).toBe('Give consent');
  // The middle band is an ordinary internal label: 400, like the one drawn under it.
  expect(overlay(canvas)!.style.fontWeight).toBe('400');
  type(canvas, 'Sign consent');
  key(canvas, 'Enter');

  expect(bo(chore).get('name')).toBe('Sign consent');
  expect(boOf(definitions, 'Participant_Subject').get('name')).toBe('Subject');
  const { xml } = await roundTrip(loaded);
  expect(xml).toContain('name="Sign consent"');
});

test('choreography: a band edit mints the participant pair when the task has none', async () => {
  const loaded = await load(BARE_CHOREOGRAPHY_XML);
  const { canvas } = loaded;
  const chore = node(canvas, 'Chore_1');
  const band = choreographyBandHeight(chore.height);
  expect(bo(chore).get('participantRef')).toHaveLength(0);

  dblclick(canvas, { x: chore.x + chore.width / 2, y: chore.y + chore.height - band / 2 });
  const session = canvas.getLabelEditing().getSession()!;
  expect(session.band).toBe('bottom');
  // With no participants yet, the bands read as the placeholder names.
  expect(session.initial).toBe(DEFAULT_BOTTOM);
  type(canvas, 'Experimenter');
  key(canvas, 'Enter');

  const refs = bo(chore).get('participantRef');
  expect(refs).toHaveLength(2);
  expect(refs[0].get('name')).toBe(DEFAULT_TOP);
  expect(refs[1].get('name')).toBe('Experimenter');
  expect(bo(chore).get('initiatingParticipantRef')).toBe(refs[0]);

  const { xml, reloaded } = await roundTrip(loaded);
  // The pair lives in a collaboration created alongside the process (it has no DI
  // plane, so the participants exist in the XML without drawing on the canvas).
  expect(xml).toContain('name="Experimenter"');
  const reloadedTask = boOf(reloaded, 'Chore_1');
  expect(reloadedTask.participantRef.map((p: any) => p.name)).toEqual([DEFAULT_TOP, 'Experimenter']);
});

// --- the editor's own chrome (parity spec §5) --------------------------------

/**
 * bpmn-js draws two visually different direct editors, and the difference is the
 * whole point: over a task the text simply becomes editable where it already is
 * (transparent, borderless, centred on the label), while an event's or gateway's
 * caption gets a small white box with a 1px #ccc border, sized TIGHT to the text.
 *
 * The chrome itself is declared once in `view/theme.ts` (asserted below against
 * `CANVAS_CSS`, the way the rest of the canvas chrome is): the overlay carries only
 * the class that selects a variant plus the geometry the viewport computes.
 */

test('editor chrome: an internal editor is transparent and borderless, an external one is a bordered white box', () => {
  // Base: no chrome at all, and nothing that would draw a focus ring.
  expect(CANVAS_CSS).toContain('.sf-label-editor {');
  expect(CANVAS_CSS).toContain('background: transparent;');
  expect(CANVAS_CSS).toContain('box-shadow: none;');
  expect(CANVAS_CSS).toContain('outline: none;');
  // Pure black in both variants — deliberately NOT the #22242A render stroke.
  expect(CANVAS_CSS).toContain('--sf-label-editor-color: #000000');
  expect(CANVAS_CSS).toContain('text-align: center;');
  expect(CANVAS_CSS).toContain('line-height: 1.2;');

  // Internal: the padding bpmn-js's contenteditable carries, and no border.
  expect(CANVAS_CSS).toContain('.sf-label-editor-internal {\n  padding: 7px 5px;\n}');

  // External: white, 1px #ccc, square corners.
  expect(CANVAS_CSS).toContain('--sf-label-editor-external-stroke-color: #ccc');
  expect(CANVAS_CSS).toContain('border: 1px solid var(--sf-label-editor-external-stroke-color)');
  expect(CANVAS_CSS).toContain('border-radius: 0;');
});

test('editor chrome: a task takes the internal variant over its own box', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  dblclick(canvas, center(task));

  const input = overlay(canvas)!;
  expect(input.classList.contains('sf-label-editor')).toBe(true);
  expect(input.classList.contains('sf-label-editor-internal')).toBe(true);
  expect(input.classList.contains('sf-label-editor-external')).toBe(false);
  expect(input.getAttribute('data-placement')).toBe('internal');
  // 12px internal, in the same font the label is drawn with, so nothing jumps.
  expect(input.style.fontSize).toBe('12px');
  // The one invariant that matters about the family: the overlay is set in the SAME
  // stack the renderer drew the label with, so the text does not jump when it opens.
  // (Compared through the CSSOM's own normalisation, which quotes `Segoe UI`.)
  const drawnText = canvas.getGraphics('Task_1')!.querySelector('text')!;
  const drawn = drawnText.getAttribute('font-family');
  const families = (value: string) => value.replace(/["']/g, '').split(',').map((f) => f.trim());
  expect(families(input.style.fontFamily)).toEqual(families(drawn!));
  expect(families(LABEL_FONT)).toEqual(families(drawn!));
  // …and in the same WEIGHT, for the same reason: an editor set 200 heavier than the
  // label it replaces makes the text visibly thicken the moment it opens (the
  // reference measures 400 on both, and so does the renderer).
  expect(drawnText.getAttribute('font-weight')).toBe('400');
  expect(input.style.fontWeight).toBe('400');
  // No paint is written inline: the variant class owns all of it.
  expect(input.style.border).toBe('');
  expect(input.style.background).toBe('');
  // Exactly the shape's box (zoom 1 under the jsdom viewport).
  expect(parseFloat(input.style.width)).toBeCloseTo(100, 6);
  expect(parseFloat(input.style.height)).toBeCloseTo(80, 6);
});

test('editor chrome: an external label takes the bordered variant, sized tight to its text', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const gate = node(canvas, 'Gate_1');
  dblclick(canvas, center(gate));

  const input = overlay(canvas)!;
  expect(input.classList.contains('sf-label-editor-external')).toBe(true);
  expect(input.classList.contains('sf-label-editor-internal')).toBe(false);
  expect(input.getAttribute('data-placement')).toBe('external');
  expect(input.style.fontSize).toBe('11px');
  expect(input.style.fontWeight).toBe('400');

  // Tight to "Correct?" — NOT the whole label region the text is centred in.
  const region = externalLabelBounds(gate, gate.label);
  const box = editorBounds(gate, 'name', 'Correct?');
  expect(box.width).toBeCloseTo(measureLabelWidth('Correct?', 11), 6);
  expect(box.width).toBeLessThan(region.width);
  expect(parseFloat(input.style.width)).toBeCloseTo(box.width, 6);
  // …and still centred on the same text.
  expect(box.x + box.width / 2).toBeCloseTo(region.x + region.width / 2, 6);
  expect(box.y + box.height / 2).toBeCloseTo(region.y + region.height / 2, 6);
  // The session still reports the label REGION — the editor box is chrome, not model.
  expect(canvas.getLabelEditing().getSession()!.bounds).toEqual(region);
});

test('editor chrome: an external box follows its text as it is typed', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const gate = node(canvas, 'Gate_1');
  dblclick(canvas, center(gate));

  const input = overlay(canvas)!;
  const before = { left: input.style.left, width: input.style.width };
  type(canvas, 'A much longer question than before');

  expect(parseFloat(input.style.width)).toBeGreaterThan(parseFloat(before.width));
  // It grows about its centre, so the box stays over the text it edits.
  const centreBefore = parseFloat(before.left) + parseFloat(before.width) / 2;
  const centreAfter = parseFloat(input.style.left) + parseFloat(input.style.width) / 2;
  expect(centreAfter).toBeCloseTo(centreBefore, 6);
});

// --- opening from the keyboard (parity spec §9 `e`) ---------------------------

test("pressing 'e' on the selection opens the editor pre-filled, exactly as a double click does", async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  canvas.getSelection().select(task);

  expect(canvas.getLabelEditing().isActive()).toBe(false);
  pressKey(canvas, 'e');

  const editing = canvas.getLabelEditing();
  expect(editing.isActive()).toBe(true);
  expect(editing.getValue()).toBe('Task');
  expect(editing.getSession()!.element.id).toBe('Task_1');
});

test("'e' needs exactly one selected element, and never fires while the editor has the key", async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');

  // Nothing selected: nothing happens.
  pressKey(canvas, 'e');
  expect(canvas.getLabelEditing().isActive()).toBe(false);

  // Two selected: no editor either (which one would it be?).
  canvas.getSelection().select([task, node(canvas, 'Task_2')]);
  pressKey(canvas, 'e');
  expect(canvas.getLabelEditing().isActive()).toBe(false);

  // With the editor open, `e` is a letter being typed, not a command.
  canvas.getSelection().select(task);
  pressKey(canvas, 'e');
  const input = overlay(canvas)!;
  type(canvas, 'Task');
  pressKey(canvas, 'e');
  expect(overlay(canvas)).toBe(input);
});

test('the drawn label steps aside while the editor stands in for it', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  const gfx = () => canvas.getGraphics('Task_1')!;

  // The label text is marked as a label; the shape's other glyphs are not.
  expect(gfx().querySelectorAll('.sf-label')).toHaveLength(1);
  expect(gfx().classList.contains('sf-label-hidden')).toBe(false);

  dblclick(canvas, center(task));
  // A transparent editor over a visible label would double the text — bpmn-js hides
  // it with the same marker, and the style layer decides what hiding means.
  expect(gfx().classList.contains('sf-label-hidden')).toBe(true);
  expect(CANVAS_CSS).toContain('.sf-canvas .sf-label-hidden .sf-label {\n  display: none;\n}');

  key(canvas, 'Escape');
  expect(gfx().classList.contains('sf-label-hidden')).toBe(false);

  // …and it comes back after a commit, which re-draws the element from scratch.
  dblclick(canvas, center(node(canvas, 'Task_1')));
  type(canvas, 'Renamed');
  key(canvas, 'Enter');
  expect(gfx().classList.contains('sf-label-hidden')).toBe(false);
  expect(renderedText(canvas, 'Task_1')).toContain('Renamed');
});

test('a gateway hides its caption while editing but keeps its × marker', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const gate = node(canvas, 'Gate_1');
  dblclick(canvas, center(gate));

  const gfx = canvas.getGraphics('Gate_1')!;
  expect(gfx.classList.contains('sf-label-hidden')).toBe(true);
  // Exactly one text is a label; the × is a glyph the shape is made of and stays.
  const texts = Array.from(gfx.querySelectorAll('text'));
  expect(texts.filter((t) => t.classList.contains('sf-label')).map((t) => t.textContent))
    .toEqual(['Correct?']);
  expect(texts.filter((t) => !t.classList.contains('sf-label')).map((t) => t.textContent))
    .toEqual(['×']);
});

test('an internal editor centres its text on the label, and re-centres as lines are added', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const task = node(canvas, 'Task_1');
  dblclick(canvas, center(task));
  const input = overlay(canvas)!;

  // One 12px line at line-height 1.2 in an 80px box: (80 - 14.4) / 2.
  expect(parseFloat(input.style.paddingTop)).toBeCloseTo((80 - 12 * 1.2) / 2, 6);

  input.value = 'Two\nlines';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  expect(parseFloat(input.style.paddingTop)).toBeCloseTo((80 - 2 * 12 * 1.2) / 2, 6);

  // It never goes under the 7px the spec measured, however many lines there are.
  input.value = 'a\nb\nc\nd\ne\nf\ng\nh';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  expect(parseFloat(input.style.paddingTop)).toBe(7);
});

// --- external labels as elements (parity spec §2) ----------------------------

/**
 * bpmn-js registers a caption as its own element (`<owner>_label`, carrying the
 * OWNER's business object) and that element is what a click selects, what gets the
 * `textW+10` outline, and what a double click edits. These cover the canvas half of
 * that: `model/externalLabel.ts` mints the element, `render/labels.ts` draws it into
 * its own translated `<g>`, and `render/outline.ts` gives it the default rect.
 */

/** A press–release at a diagram point (what selects an element). */
function clickAt(canvas: Canvas, at: Pt): void {
  const svg = canvas.getSvg();
  fireMouse(canvas, svg, 'pointerdown', at);
  fireMouse(canvas, svg.ownerDocument!, 'pointerup', at);
}

/** The `translate(x, y)` an element's `<g>` carries. */
function translateOf(g: Element): Pt {
  const m = (g.getAttribute('transform') ?? '').match(/translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
}

/** The centre of an element's external label box. */
function labelCentre(canvas: Canvas, id: string): Pt {
  const box = canvas.labelFor(node(canvas, id))!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('external label: it is drawn as its own translated <g>, keyed by <owner>_label', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const g = canvas.getGraphics('Start_1_label')!;
  expect(g, 'the caption has its own graphics').not.toBeNull();
  expect(g.getAttribute('class')).toBe('sf-external-label');
  expect(g.getAttribute('data-label-owner')).toBe('Start_1');
  // The caption's group sits INSIDE the owner's (which already carries the shape's
  // translate), so its own transform is node-local — and everything under it is
  // label-local, which is the frame the `x=-5 y=-5` outline is expressed in.
  const owner = node(canvas, 'Start_1');
  const label = canvas.labelFor(owner)!;
  const local = translateOf(g);
  expect(local.x).toBeCloseTo(label.x - owner.x, 6);
  expect(local.y).toBeCloseTo(label.y - owner.y, 6);
  // Tight to the glyphs — the box a click has to hit.
  expect(label.width).toBeCloseTo(measureLabelWidth('Begin', 11), 6);
  expect(label.height).toBe(15);
  // …and it carries the owner's business object, exactly as bpmn-js's label does.
  expect(label.businessObject).toBe(node(canvas, 'Start_1').businessObject);
});

test('external label: clicking it selects the LABEL, with its own outline rect', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const at = labelCentre(canvas, 'Start_1');
  expect(canvas.hitTest(at), 'the caption is clear of every shape').toBeUndefined();

  clickAt(canvas, at);

  const selected = canvas.getSelection().get();
  expect(selected.map((e) => e.id)).toEqual(['Start_1_label']);
  expect(selected[0].labelTarget?.id).toBe('Start_1');

  const g = canvas.getGraphics('Start_1_label')!;
  expect(g.classList.contains('selected')).toBe(true);
  const outline = g.querySelector('.sf-outline')!;
  const label = canvas.labelFor(node(canvas, 'Start_1'))!;
  expect(outline.tagName.toLowerCase()).toBe('rect');
  expect([
    outline.getAttribute('x'),
    outline.getAttribute('y'),
    outline.getAttribute('width'),
    outline.getAttribute('height'),
    outline.getAttribute('rx'),
  ]).toEqual(['-5', '-5', String(label.width + 10), String(label.height + 10), '4']);
  // The owner is NOT selected, and keeps no outline of its own.
  expect(canvas.getGraphics('Start_1')!.classList.contains('selected')).toBe(false);
});

test('external label: no resize handles, and Delete on one is a no-op', async () => {
  const { canvas, definitions } = await load(FIXTURE_XML);
  clickAt(canvas, labelCentre(canvas, 'Gate_1'));
  expect(canvas.getSelection().get().map((e) => e.id)).toEqual(['Gate_1_label']);
  // A caption is sized by its text: the overlay offers no resize gesture.
  expect(canvas.getSvg().querySelectorAll('.sf-resizer')).toHaveLength(0);

  const before = canvas.getScene()!.elementsById.size;
  expect(canvas.deleteSelection()).toEqual([]);
  expect(canvas.getScene()!.elementsById.size).toBe(before);
  expect(boOf(definitions, 'Gate_1')).toBeTruthy();
});

test('external label: dblclick on the caption opens the editor for its owner', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const at = labelCentre(canvas, 'Start_1');

  dblclick(canvas, at);

  const session = canvas.getLabelEditing().getSession()!;
  expect(session.element.id, 'the OWNER is what carries the name').toBe('Start_1');
  expect(session.initial).toBe('Begin');
  expect(overlay(canvas)!.classList.contains('sf-label-editor-external')).toBe(true);
});

test('external label: an edge caption is an element too, and has no white plate', async () => {
  const { canvas } = await load(EDGE_LABEL_XML);
  const g = canvas.getGraphics('Flow_1_label')!;
  expect(g.getAttribute('data-label-owner')).toBe('Flow_1');
  // bpmn-js draws bare text over the canvas — no halo rect behind the glyphs.
  expect(g.querySelectorAll('rect')).toHaveLength(0);
  expect(g.querySelectorAll('text')).toHaveLength(1);

  const flow = canvas.getScene()!.elementsById.get('Flow_1') as any;
  const label = canvas.labelFor(flow)!;
  clickAt(canvas, { x: label.x + label.width / 2, y: label.y + label.height / 2 });
  expect(canvas.getSelection().get().map((e) => e.id)).toEqual(['Flow_1_label']);
  expect(g.querySelector('.sf-outline')!.getAttribute('rx')).toBe('4');
});

test('connection label: dblclick on a flow caption opens the editor on the flow', async () => {
  const loaded = await load(EDGE_LABEL_XML);
  const { canvas } = loaded;
  const flow = canvas.getScene()!.elementsById.get('Flow_1') as any;
  const label = canvas.labelFor(flow)!;

  dblclick(canvas, { x: label.x + label.width / 2, y: label.y + label.height / 2 });

  const editing = canvas.getLabelEditing();
  expect(editing.isActive(), 'a connection caption is editable, like every other one').toBe(true);
  const session = editing.getSession()!;
  // The session reports the CONNECTION — that is what carries the name.
  expect(session.element.id).toBe('Flow_1');
  expect(session.initial).toBe('again');
  expect(editing.getValue()).toBe('again');

  // The same white bordered chrome a node's caption gets, sized tight to the text.
  const input = overlay(canvas)!;
  expect(input.classList.contains('sf-label-editor-external')).toBe(true);
  expect(input.classList.contains('sf-label-editor-internal')).toBe(false);
  expect(input.getAttribute('data-placement')).toBe('external');
  expect(input.getAttribute('data-element-id')).toBe('Flow_1');
  expect(input.style.fontSize).toBe('11px');
  expect(input.style.fontWeight).toBe('400');
  expect(parseFloat(input.style.width)).toBeCloseTo(measureLabelWidth('again', 11), 6);
  // The drawn caption steps aside while the editor stands over it.
  expect(canvas.getGraphics('Flow_1')!.classList.contains('sf-label-hidden')).toBe(true);

  type(canvas, 'once more');
  key(canvas, 'Enter');

  expect(bo(flow).get('name')).toBe('once more');
  expect(renderedText(canvas, 'Flow_1')).toContain('once more');
  expect(canvas.getGraphics('Flow_1')!.classList.contains('sf-label-hidden')).toBe(false);
  const { xml } = await roundTrip(loaded);
  expect(xml).toContain('name="once more"');
});

test('the editor opens with a caret at the end, not the whole label selected', async () => {
  const { canvas } = await load(FIXTURE_XML);

  // Internal…
  dblclick(canvas, center(node(canvas, 'Task_1')));
  const internal = overlay(canvas)!;
  expect(internal.value).toBe('Task');
  expect(internal.selectionEnd - internal.selectionStart).toBe(0);
  expect(internal.selectionStart).toBe('Task'.length);
  key(canvas, 'Escape');

  // …and external: the reference collapses its range onto the end of the text in
  // both, so the label reads as plain text rather than a blue selection band.
  dblclick(canvas, center(node(canvas, 'Gate_1')));
  const external = overlay(canvas)!;
  expect(external.value).toBe('Correct?');
  expect(external.selectionEnd - external.selectionStart).toBe(0);
  expect(external.selectionStart).toBe('Correct?'.length);
});

test('external label: it follows its owner, outline included', async () => {
  const { canvas } = await load(FIXTURE_XML);
  clickAt(canvas, labelCentre(canvas, 'Start_1'));
  const before = canvas.labelFor(node(canvas, 'Start_1'))!;
  const beforeX = before.x;

  // Move the owner through the same path a drag commits on — with the CAPTION still
  // selected, so its chrome has to survive the owner's re-draw.
  const drag = canvas.getDrag()!;
  drag.startMove([node(canvas, 'Start_1')], { x: 0, y: 0 });
  drag.end({ x: 40, y: 0 });

  const owner = node(canvas, 'Start_1');
  const after = canvas.labelFor(owner)!;
  expect(after.x).toBe(beforeX + 40);
  // Same element object, re-pointed — so a selection holding it stays true.
  expect(after).toBe(before);
  // It rides inside the owner's `<g>`, so its own transform never had to change…
  const g = canvas.getGraphics('Start_1_label')!;
  const local = translateOf(g);
  expect(local.x).toBeCloseTo(after.x - owner.x, 6);
  expect(local.y).toBeCloseTo(after.y - owner.y, 6);
  // …and the selection chrome survived the owner's re-draw.
  expect(g.classList.contains('selected')).toBe(true);
  expect(g.querySelector('.sf-outline')).not.toBeNull();
});

test('labels: the font stack and weight the reference renders with', async () => {
  const { canvas } = await load(FIXTURE_XML);
  expect(LABEL_FONT).toBe('"IBM Plex Sans", Helvetica, sans-serif');

  const internal = canvas.getGraphics('Task_1')!.querySelector('text.sf-label')!;
  expect(internal.getAttribute('font-family')).toBe(LABEL_FONT);
  // 400, not 600: a task's own name is no bolder than any other label.
  expect(internal.getAttribute('font-weight')).toBe('400');
  expect(internal.getAttribute('font-size')).toBe('12');

  const external = canvas.getGraphics('Start_1_label')!.querySelector('text.sf-label')!;
  expect(external.getAttribute('font-family')).toBe(LABEL_FONT);
  expect(external.getAttribute('font-weight')).toBe('400');
  expect(external.getAttribute('font-size')).toBe('11');
});

// --- the label's own chrome (parity spec addendum 3 §1/§3) -------------------
//
// A caption that has been dragged clear of the element it names is only readable if
// something says which element that is: `edge-videos/labels/frame_08` draws a blue
// DASHED leader from the label box to its flow, plus eight blue chips around the
// box. The chips are decoration — a label is not resizable — so the leader is the
// half that carries meaning, and the half these tests are about.

/** The caption element of a connection, and the centre of its box. */
function edgeLabel(canvas: Canvas, id: string): SceneNode {
  const owner = canvas.getScene()!.elementsById.get(id) as any;
  return canvas.labelFor(owner)!;
}

function boxCentre(box: { x: number; y: number; width: number; height: number }): Pt {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('a selected caption draws a dashed leader to the flow it names', async () => {
  const { canvas } = await load(EDGE_LABEL_XML);
  const label = edgeLabel(canvas, 'Flow_1');

  clickAt(canvas, boxCentre(label));

  const leaders = canvas.getSvg().querySelectorAll('.sf-label-leader');
  expect(leaders).toHaveLength(1);
  const leader = leaders[0];
  expect(leader.getAttribute('data-label-owner')).toBe('Flow_1');

  const x1 = Number(leader.getAttribute('x1'));
  const y1 = Number(leader.getAttribute('y1'));
  const y2 = Number(leader.getAttribute('y2'));
  // It leaves the box from the side that FACES the flow — here the bottom edge of
  // the outline rect, which is the text box grown by the 5-unit outline offset.
  expect(x1).toBeCloseTo(boxCentre(label).x, 6);
  expect(y1).toBeCloseTo(label.y + label.height + 5, 6);
  // …and lands on the line itself, below the caption.
  const flow = canvas.getScene()!.elementsById.get('Flow_1') as any;
  expect(y2).toBeGreaterThan(y1);
  expect(y2).toBeGreaterThanOrEqual(Math.min(...flow.waypoints.map((p: Pt) => p.y)));
  expect(y2).toBeLessThanOrEqual(Math.max(...flow.waypoints.map((p: Pt) => p.y)));
});

test('the leader and the chips go away when the caption is deselected', async () => {
  const { canvas } = await load(EDGE_LABEL_XML);
  clickAt(canvas, boxCentre(edgeLabel(canvas, 'Flow_1')));
  expect(canvas.getSvg().querySelectorAll('.sf-label-leader')).toHaveLength(1);

  canvas.getSelection().clear();

  expect(canvas.getSvg().querySelectorAll('.sf-label-leader')).toHaveLength(0);
  expect(canvas.getSvg().querySelectorAll('.sf-label-chip')).toHaveLength(0);
});

test('a selected caption draws eight chips that start no gesture', async () => {
  const { canvas } = await load(EDGE_LABEL_XML);
  const label = edgeLabel(canvas, 'Flow_1');

  clickAt(canvas, boxCentre(label));

  const chips = Array.from(canvas.getSvg().querySelectorAll('.sf-label-chip'));
  expect(chips).toHaveLength(8);
  // Inert by construction: no `data-handle`, so `Selection.handleAt` can never
  // report one and no resize gesture can start on a caption (§5-D2).
  expect(chips.some((chip) => chip.hasAttribute('data-handle'))).toBe(false);
  expect(canvas.getSvg().querySelectorAll('.sf-resizer')).toHaveLength(0);
  // They sit on the OUTLINE rect (the text box + 5), corners first.
  const nw = chips.find((chip) => chip.classList.contains('sf-label-chip-nw'))!;
  expect(Number(nw.getAttribute('x'))).toBeCloseTo(label.x - 5 - 4, 6);
  expect(Number(nw.getAttribute('y'))).toBeCloseTo(label.y - 5 - 4, 6);
});

test('the leader survives the caption being dragged, the chips step aside', async () => {
  const { canvas } = await load(EDGE_LABEL_XML);
  const label = edgeLabel(canvas, 'Flow_1');
  const from = boxCentre(label);
  const svg = canvas.getSvg();
  const doc = svg.ownerDocument!;

  fireMouse(canvas, svg, 'pointerdown', from);
  fireMouse(canvas, doc, 'pointermove', { x: from.x, y: from.y - 60 });

  // Mid-gesture: the association is exactly what the user needs to see.
  expect(canvas.getSvg().querySelectorAll('.sf-label-leader')).toHaveLength(1);
  expect(canvas.getSvg().querySelectorAll('.sf-label-chip')).toHaveLength(0);
  // The caption itself is the blue ghost, with the frozen original behind it.
  expect(canvas.getGraphics('Flow_1_label')!.classList.contains('sf-dragger')).toBe(true);
  expect(canvas.getSvg().querySelectorAll('.sf-drag-originals')).toHaveLength(1);

  fireMouse(canvas, doc, 'pointerup', { x: from.x, y: from.y - 60 });
  expect(canvas.getGraphics('Flow_1_label')!.classList.contains('sf-dragger')).toBe(false);
  expect(canvas.getSvg().querySelectorAll('.sf-label-chip')).toHaveLength(8);
});

test('dblclick on an UNLABELED flow opens an editor at the midpoint and mints a BPMNLabel', async () => {
  const loaded = await load(FIXTURE_XML);
  const { canvas, definitions } = loaded;
  const flow = canvas.getScene()!.elementsById.get('Flow_1') as any;
  expect(nameOfBo(definitions, 'Flow_1')).toBe(undefined);
  const mid = {
    x: (flow.waypoints[0].x + flow.waypoints[1].x) / 2,
    y: (flow.waypoints[0].y + flow.waypoints[1].y) / 2,
  };

  dblclick(canvas, mid);

  const editing = canvas.getLabelEditing();
  expect(editing.isActive(), 'an unnamed flow is nameable in place').toBe(true);
  expect(editing.getSession()!.element.id).toBe('Flow_1');
  expect(editing.getValue()).toBe('');
  // The box opens ABOVE the line, centred on the midpoint (`labels/frame_02`).
  const box = editing.getSession()!.bounds;
  expect(box.x + box.width / 2).toBeCloseTo(mid.x, 6);
  expect(box.y + box.height / 2).toBeLessThan(mid.y);

  editing.setValue('Hello. this is a label');
  key(canvas, 'Enter');

  const di = diEdgeOf(definitions, 'Flow_1');
  expect(di.label, 'naming a flow mints its bpmndi:BPMNLabel').toBeTruthy();
  expect(di.label.bounds).toBeTruthy();
  expect(di.label.bounds.x).toBeCloseTo(canvas.labelFor(flow)!.x, 6);
  expect(di.label.bounds.y).toBeCloseTo(canvas.labelFor(flow)!.y, 6);

  const { xml } = await roundTrip(loaded);
  expect(xml).toContain('bpmndi:BPMNLabel');
  expect(xml).toContain('Hello. this is a label');
});

test('minting a flow caption is ONE edit — one revision bump, one undo step', async () => {
  const { canvas } = await load(FIXTURE_XML);
  const scene = canvas.getScene()!;
  const flow = scene.elementsById.get('Flow_1') as any;
  const before = scene.revision;
  const mid = {
    x: (flow.waypoints[0].x + flow.waypoints[1].x) / 2,
    y: (flow.waypoints[0].y + flow.waypoints[1].y) / 2,
  };

  dblclick(canvas, mid);
  canvas.getLabelEditing().setValue('go');
  key(canvas, 'Enter');

  // The label mint is applied silently and the NAME write is what commits, so the
  // history (which counts revisions) records exactly one step.
  expect(scene.revision).toBe(before + 1);
});

/** The `name` of a business object in the live tree, or `undefined`. */
function nameOfBo(definitions: any, id: string): string | undefined {
  return boOf(definitions, id)?.name;
}

/** The `bpmndi:BPMNEdge` of `id` in the live tree. */
function diEdgeOf(definitions: any, id: string): any {
  for (const diagram of definitions.diagrams ?? []) {
    for (const pe of diagram.plane?.planeElement ?? []) {
      if (pe.$type === 'bpmndi:BPMNEdge' && pe.bpmnElement?.id === id) return pe;
    }
  }
  return undefined;
}
