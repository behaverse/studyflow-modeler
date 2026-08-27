import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import type { EditorHistory, EditorModel } from '@canvas/editor.ts';

import { createEditor, type EditorCore } from '@modeler/editor/editor';

import { freshModdle, installDocument } from './canvasHarness';

/**
 * The `Editor` facade (`@modeler/editor/editor.ts`, `@canvas/editor.ts`).
 *
 * What is asserted here is only what the facade ADDS to the canvas: the moddle
 * round trip of `importXML`/`saveXML`, the plane projected as `elements.root()`,
 * the "one call = one undo step" bracket of `mutate.*`, the `!!` over the rules and
 * the history quintet. Everything else the facade publishes IS a canvas service
 * under another name — `selection` is the `Selection`, `events` is the `EventBus`,
 * `canvas` is the `Canvas` — and is covered where that service is: `canvas-selection`,
 * `canvas-create`, `canvas-connect`, `canvas-viewport`, `canvas-rules`.
 *
 * jsdom via `setDocument`, same setup as the other `canvas-*` specs.
 */

installDocument();

/** The `EditorModel` slice the app injects — always bpmn-moddle. */
function editorModel(moddle: any): EditorModel {
  return {
    moddle: () => moddle,
    create: (type, properties) => moddle.create(type, properties),
    createBusinessObject: (type, properties) => moddle.create(type, properties),
    fromXML: (xml) => moddle.fromXML(xml),
    toXML: (definitions, options) => moddle.toXML(definitions, options),
    ids: {
      nextPrefixed: (prefix, element) => moddle.ids?.nextPrefixed(prefix, element) ?? `${prefix}1`,
      assigned: (id) => moddle.ids?.assigned(id),
    },
  };
}

/** A recording stand-in for the app's snapshot history (design §4 (1)). */
function recordingHistory(): EditorHistory & { log: string[]; bumps: number } {
  const state = {
    log: [] as string[],
    bumps: 0,
    revision: () => state.bumps,
    undo: () => state.log.push('undo'),
    redo: () => state.log.push('redo'),
    canUndo: () => state.bumps > 0,
    canRedo: () => false,
    record: () => {
      state.log.push('record');
      state.bumps += 1;
    },
    reset: () => {
      state.log.push('reset');
      state.bumps = 0;
    },
  };
  return state;
}

const PROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" name="Study" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Go" />
    <bpmn:task id="Task_1" name="Task" />
    <bpmn:endEvent id="End_1" name="Done" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
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
        <dc:Bounds x="400" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" />
        <di:waypoint x="200" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

interface Mounted {
  canvas: Canvas;
  port: EditorCore;
  moddle: any;
  history: ReturnType<typeof recordingHistory>;
}

async function mount(xml = PROCESS_XML): Promise<Mounted> {
  const moddle = freshModdle();
  const canvas = new Canvas();
  const history = recordingHistory();
  const port = createEditor(canvas, { model: editorModel(moddle), history });
  await port.importXML(xml);
  return { canvas, port, moddle, history };
}

// --- the aliases are the canvas ----------------------------------------------

test('the facade publishes the canvas services themselves, not copies of them', async () => {
  const { canvas, port } = await mount();

  // The whole point of the collapse: these are not projections to keep in step with
  // anything — they ARE the objects, so there is nothing to drift.
  expect(port.selection).toBe(canvas.getSelection());
  expect(port.events).toBe(canvas.getEventBus());
  expect(port.canvas).toBe(canvas);
  expect(port.elements).toBe(canvas.getElements());

  // `templates`/`simulation`/`destroy` are absent by design: the app fastens those
  // on (`editor/mount.ts`), and neither the canvas nor this assembly has any part
  // of them.
  expect('templates' in port).toBe(false);
  expect('simulation' in port).toBe(false);
});

// --- import + element lookup -------------------------------------------------

test('importXML builds the scene, announces it, and projects the plane as the root element', async () => {
  const moddle = freshModdle();
  const canvas = new Canvas();
  const port = createEditor(canvas, {
    model: editorModel(moddle),
    history: recordingHistory(),
  });

  const seen: string[] = [];
  port.events.on('import.done', () => seen.push('import.done'));
  port.events.on('root.set', () => seen.push('root.set'));

  const { warnings } = await port.importXML(PROCESS_XML);
  expect(warnings).toEqual([]);
  expect(seen).toEqual(['import.done', 'root.set']);

  // `elements.root()` is what the nav bar reads the diagram name from and what
  // export scopes against — the plane's business object, not a scene node.
  const root = port.elements.root();
  expect(root.id).toBe('Process_1');
  expect(root.businessObject.$type).toBe('bpmn:Process');
  expect(root.businessObject.name).toBe('Study');
  // Memoized: `e.element === editor.elements.root()` identity checks must hold.
  expect(port.elements.root()).toBe(root);
  expect(port.elements.get('Process_1')).toBe(root);

  // `getDefinitions` hands back the very tree the canvas writes through.
  expect(port.getDefinitions()?.$type).toBe('bpmn:Definitions');
  expect(port.getDefinitions()?.id).toBe('Defs_1');
});

test('elements.get / forEach / filter / findRoot / getGraphics span the scene', async () => {
  const { canvas, port } = await mount();

  const task = port.elements.get('Task_1');
  expect(task?.type).toBe('bpmn:Task');
  expect(task?.businessObject.name).toBe('Task');
  expect(port.elements.get('nope')).toBeUndefined();

  // Root first, then import order (`export/drawio.ts` walks it that way), labels
  // excluded — app code filters `element.type === 'label'` anyway.
  const ids: string[] = [];
  port.elements.forEach((element: any) => ids.push(element.id));
  expect(ids[0]).toBe('Process_1');
  expect(ids).toEqual(['Process_1', 'Start_1', 'Task_1', 'End_1', 'Flow_1']);

  expect(port.elements.filter((e: any) => !!e.waypoints).map((e: any) => e.id)).toEqual(['Flow_1']);

  expect(port.elements.findRoot(task)).toBe(port.elements.root());
  expect(port.elements.findRoot(undefined)).toBeUndefined();

  const gfx = port.elements.getGraphics(task);
  expect(gfx).toBe(canvas.getGraphics('Task_1'));
  expect(port.elements.getGraphics(port.elements.root())).toBe(canvas.getSvg());
});

// --- the view members app chrome reaches on `Editor.canvas` -------------------

// There is no `view` projection: viewport, layers and markers are the canvas's own,
// and `Editor.canvas` is how app chrome calls them (`provenance/Replay.tsx`,
// `contextPad/ContextPad.tsx`, `drilldown/commands.ts`). Asserted here because this
// is the set the facade is answerable for handing over intact — including the three
// LENIENT ones (`addMarker`/`removeMarker`/`scrollToElement`), which resolve whatever
// a host names an element by.
test('the canvas exposes the viewbox (with outer extents), zoom, layers and markers', async () => {
  const { canvas, port } = await mount();

  canvas.zoomToFit();
  const box = canvas.getViewbox();
  expect(box.width).toBeGreaterThan(0);
  expect(box.scale).toBeGreaterThan(0);
  // `provenance/Replay.tsx` divides by `outer.width`/`outer.height`; both must exist.
  expect(typeof box.outer.width).toBe('number');
  expect(typeof box.outer.height).toBe('number');
  // `inner` is the drawn extent: the diagram spans x=100..436.
  expect(box.inner.x).toBe(100);
  expect(box.inner.width).toBe(336);

  canvas.getViewport().setViewbox({ x: 0, y: 0, width: 500, height: 500 });
  expect(canvas.getViewbox()).toMatchObject({ x: 0, y: 0, width: 500, height: 500 });
  expect(canvas.getViewport().zoom()).toBeCloseTo(1, 5);

  // Screen-space bbox of a shape at the current viewbox (jsdom: 1:1, origin 0,0).
  expect(canvas.getAbsoluteBBox(port.elements.get('Task_1')))
    .toMatchObject({ x: 200, y: 78, width: 100, height: 80 });

  expect(port.canvas.getContainer()).toBe(canvas.getContainer());

  // A named custom layer (`getHostLayer('provenance-replay', 1000)`), created on
  // first use, stable afterwards, and attached inside the canvas overlay stack.
  const layer = canvas.getHostLayer('provenance-replay', 1000);
  expect(layer.getAttribute('data-layer')).toBe('provenance-replay');
  expect(canvas.getHostLayer('provenance-replay')).toBe(layer);
  expect(layer.parentNode).toBeTruthy();

  // Lenient in what it names an element by — an id here, an element below.
  canvas.addMarker('Task_1', 'replay-hit');
  expect(canvas.getSelection().hasMarker('Task_1', 'replay-hit')).toBe(true);
  canvas.removeMarker('Task_1', 'replay-hit');
  expect(canvas.getSelection().hasMarker('Task_1', 'replay-hit')).toBe(false);

  // ...and a name nothing answers to is dropped, not remembered against the id.
  canvas.addMarker('Ghost_1', 'replay-hit');
  expect(canvas.getSelection().hasMarker('Ghost_1', 'replay-hit')).toBe(false);

  // Scrolling recentres the viewport on the element.
  canvas.scrollToElement(port.elements.get('Task_1'));
  const after = canvas.getViewbox();
  expect(after.x + after.width / 2).toBeCloseTo(250, 5);

  // Off-plane elements decline rather than answer (`Replay.tsx` guards on it).
  expect(() => canvas.scrollToElement('Ghost_1')).toThrow(/not on the current plane/);
});

// --- mutation + XML round-trip ----------------------------------------------

test('mutate.updateProperties writes the business object and saveXML emits it', async () => {
  const { port, history } = await mount();

  const changed: string[] = [];
  const commands: number[] = [];
  port.events.on('element.changed', (e: any) => changed.push(e.element.id));
  port.events.on('commandStack.changed', () => commands.push(1));

  expect(port.revision()).toBe(0);
  port.mutate.updateProperties(port.elements.get('Task_1'), { name: 'Renamed' });

  // One logical undo step, closed on the app's snapshot layer.
  expect(history.log).toEqual(['reset', 'record']);
  expect(port.revision()).toBe(1);
  // …and NOT announced by `mutate`: `commandStack.changed` belongs to the history,
  // which hears every mutation source where `mutate.*` hears only its own calls.
  // Firing it there too would double-count every write.
  expect(commands.length).toBe(0);
  expect(changed).toContain('Task_1');

  const { xml } = await port.saveXML({ format: true });
  expect(xml).toContain('name="Renamed"');

  // …and it is the LIVE tree, so a reload sees it.
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  const process = reloaded.rootElements.find((el: any) => el.id === 'Process_1');
  expect(process.flowElements.find((el: any) => el.id === 'Task_1').name).toBe('Renamed');
});

test('mutate.updateProperties renames the root (the diagram-name path)', async () => {
  const { port } = await mount();
  const root = port.elements.root();

  const changed: any[] = [];
  port.events.on('element.changed', (e: any) => changed.push(e.element));

  port.mutate.updateProperties(root, { name: 'Renamed study' });
  // `navBar/useDiagramName.ts` compares by identity against `elements.root()`.
  expect(changed).toContain(root);

  const { xml } = await port.saveXML();
  expect(xml).toContain('name="Renamed study"');
});

test('mutate.update routes BO writes and moddle writes apart, and resize/color/connect apply', async () => {
  const { canvas, port, moddle } = await mount();
  const task = port.elements.get('Task_1');

  // `update` is `@core/element`'s AttributeUpdater: the element's own BO goes
  // through updateProperties, anything else through updateModdleProperties.
  port.mutate.update(task, task.businessObject, { name: 'Via update' });
  expect(task.businessObject.name).toBe('Via update');

  const extension = moddle.create('bpmn:ExtensionElements', { values: [] });
  port.mutate.update(task, extension, { values: [] });
  expect(task.businessObject.name).toBe('Via update');

  port.mutate.resizeShape(task, { x: 200, y: 78, width: 160, height: 120 });
  expect({ width: task.width, height: task.height }).toEqual({ width: 160, height: 120 });
  expect(task.di.bounds.width).toBe(160);

  port.mutate.setColor(task, { fill: '#ff0000', stroke: '#000000' });
  expect(task.di.get('color:background-color')).toBe('#ff0000');

  const created = port.mutate.createShape(
    canvas.createShape({ type: 'bpmn:Task', attrs: { name: 'Made' } }),
    { x: 600, y: 400 },
    port.elements.root(),
  );
  expect(created?.type).toBe('bpmn:Task');

  const connection = port.mutate.createConnection(task, created, undefined, port.elements.root());
  expect(connection?.businessObject.$type).toBe('bpmn:SequenceFlow');
  expect(connection.source.id).toBe('Task_1');

  const { xml } = await port.saveXML();
  expect(xml).toContain('name="Made"');
  expect(xml).toContain(`sourceRef="Task_1"`);
});

// --- rules -------------------------------------------------------------------

test('rules.allowed coerces the canvas verdict to a boolean', async () => {
  const { port } = await mount();
  const task = port.elements.get('Task_1');
  const end = port.elements.get('End_1');

  // A ConnectionSpec verdict ("allowed, and here is the type") reads as `true`.
  expect(port.rules.allowed('connection.create', { source: task, target: end })).toBe(true);
  // An end event takes no outgoing flow, and nothing connects to itself.
  expect(port.rules.allowed('connection.create', { source: end, target: task })).toBe(false);
  expect(port.rules.allowed('connection.create', { source: task, target: task })).toBe(false);
  expect(port.rules.allowed('shape.append', { source: task })).toBe(true);
  expect(port.rules.allowed('shape.append', { source: end })).toBe(false);
  // Unknown actions default to allowed, like diagram-js.
  expect(port.rules.allowed('nothing.knows.this')).toBe(true);
});

// --- events ------------------------------------------------------------------

test('events.on / off / fire round-trip, in subscription order, with a payload always', async () => {
  const { port } = await mount();
  const order: string[] = [];
  const payloads: unknown[] = [];

  const first = (event: any) => {
    order.push('first');
    payloads.push(event);
  };
  const second = () => order.push('second');
  port.events.on('tokenSimulation.toggle', first);
  port.events.on('tokenSimulation.toggle', second);

  // No priorities: listeners run in the order they subscribed, and nothing in the
  // canvas or the app has ever needed to jump that queue.
  port.events.fire('tokenSimulation.toggle');
  expect(order).toEqual(['first', 'second']);
  // A payload-less fire still delivers an OBJECT: app listeners read `event.element`
  // off whatever arrives, and `undefined` would throw inside the listener.
  expect(payloads).toEqual([{}]);

  port.events.off('tokenSimulation.toggle', second);
  order.length = 0;
  port.events.fire('tokenSimulation.toggle', { active: true });
  expect(order).toEqual(['first']);
  expect(payloads[1]).toEqual({ active: true });
});

// --- the injected half -------------------------------------------------------

test('the history quintet is served by the injected snapshot layer', async () => {
  const { port, history } = await mount();

  // Re-homed, member for member, to the history the app injects (design §4 (1)) —
  // the canvas has no undo of its own, which is why the dependency is required.
  port.mutate.updateProperties(port.elements.get('Task_1'), { name: 'x' });
  expect(port.revision()).toBe(1);
  expect(port.canUndo()).toBe(true);
  expect(port.canRedo()).toBe(false);
  port.undo();
  port.redo();
  expect(history.log.slice(-2)).toEqual(['undo', 'redo']);
});
