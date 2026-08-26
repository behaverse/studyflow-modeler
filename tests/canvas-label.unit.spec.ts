import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import {
  DEFAULT_BOTTOM as CORE_DEFAULT_BOTTOM,
  DEFAULT_TOP as CORE_DEFAULT_TOP,
} from '@core/document';
import { Canvas, setDocument } from '@canvas/index.ts';
import { choreographyBandAt, labelBounds } from '@canvas/interaction/labelEditing.ts';
import { DEFAULT_BOTTOM, DEFAULT_TOP } from '@canvas/model/choreography.ts';
import type { DirectEditingEvent, ElementDblClickEvent } from '@canvas/interaction/labelEditing.ts';
import { externalLabelBounds } from '@canvas/render/labels.ts';
import { choreographyBandHeight } from '@canvas/render/shapes.ts';
import type { SceneNode } from '@canvas/model/scene.ts';
import type { ElementChangedEvent } from '@canvas/model/writeback.ts';

import { loadSchemaModels } from './schemas';
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

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const dom = new JSDOM('<!doctype html><html><body></body></html>');
setDocument(dom.window.document as unknown as Document);

interface Loaded {
  canvas: Canvas;
  definitions: any;
  /** The moddle instance the tree was parsed with — reused to serialize it back. */
  moddle: any;
}

function freshModdle(): any {
  return new BpmnModdle(structuredClone(packages)) as any;
}

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
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(xml);
  const canvas = new Canvas();
  canvas.importDefinitions(definitions);
  return { canvas, definitions, moddle };
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
  target.dispatchEvent(new dom.window.MouseEvent(type, {
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
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
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
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
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
  canvas.getLabelEditing().getInput()!.dispatchEvent(new dom.window.Event('blur'));

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
