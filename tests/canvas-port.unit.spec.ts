import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, createCanvasEditorPort, setDocument } from '@canvas/index.ts';
import type {
  CanvasEditorPort,
  CanvasPortHistory,
  PortModel,
} from '@canvas/port/adapter.ts';
import type { SceneNode } from '@canvas/model/scene.ts';
// The ONLY place the two halves meet: `packages/canvas` never imports the modeler,
// so the "one interface, two adapters" claim is checked here, in the test project.
import type { EditorPort } from '@modeler/editor/port';

import { loadSchemaModels } from './schemas';

/**
 * P6a — the canvas `EditorPort` adapter (design §3 `port/adapter.ts`, §4 mapping).
 *
 * The contract under test is the *facade*, not the canvas: everything the app
 * reaches the editor through must behave the same whichever backend is mounted.
 * The (C) half is driven end to end here — import, element lookup, viewport,
 * mutation + XML round-trip, selection, rules, gestures, SVG export — while the
 * (A) half (history, model, popup, templates, simulation) is injected through
 * `deps` and asserted to be *forwarded*, since that is all the adapter owes it.
 *
 * jsdom via `setDocument`, same setup as the other `canvas-*` specs.
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

/** The `EditorModel` slice the app injects — always bpmn-moddle, on both backends. */
function editorModel(moddle: any): PortModel {
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
function recordingHistory(): CanvasPortHistory & { log: string[]; bumps: number } {
  const state = {
    log: [] as string[],
    bumps: 0,
    revision: () => state.bumps,
    undo: () => state.log.push('undo'),
    redo: () => state.log.push('redo'),
    canUndo: () => state.bumps > 0,
    canRedo: () => false,
    beginMutation: (label: string) => state.log.push(`begin:${label}`),
    endMutation: (label: string) => {
      state.log.push(`end:${label}`);
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
  port: CanvasEditorPort;
  moddle: any;
  history: ReturnType<typeof recordingHistory>;
}

async function mount(xml = PROCESS_XML): Promise<Mounted> {
  const moddle = freshModdle();
  const canvas = new Canvas();
  const history = recordingHistory();
  const port = createCanvasEditorPort(canvas, { model: editorModel(moddle), history });
  await port.importXML(xml);
  return { canvas, port, moddle, history };
}

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

// --- the facade contract -----------------------------------------------------

test('the canvas adapter is structurally an EditorPort', () => {
  // A compile-time assertion first (this line fails `npm run typecheck` if the two
  // shapes drift), then a runtime spot-check that every member is really there.
  const port: EditorPort = createCanvasEditorPort(new Canvas(), { model: editorModel(freshModdle()) });

  for (const method of ['revision', 'undo', 'redo', 'canUndo', 'canRedo', 'importXML', 'saveXML', 'saveSVG', 'getDefinitions'] as const) {
    expect(typeof port[method]).toBe('function');
  }
  for (const slice of ['elements', 'view', 'mutate', 'selection', 'events', 'rules', 'gestures', 'popup', 'model', 'templates', 'simulation'] as const) {
    expect(port[slice]).toBeTruthy();
  }
});

// --- import + element lookup -------------------------------------------------

test('importXML builds the scene, announces it, and projects the plane as the root element', async () => {
  const moddle = freshModdle();
  const canvas = new Canvas();
  const port = createCanvasEditorPort(canvas, { model: editorModel(moddle) });

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

// --- view --------------------------------------------------------------------

test('view exposes the viewbox (with outer extents), zoom, layers and markers', async () => {
  const { canvas, port } = await mount();

  port.view.zoomToFit();
  const box = port.view.viewbox();
  expect(box.width).toBeGreaterThan(0);
  expect(box.scale).toBeGreaterThan(0);
  // `provenance/Replay.tsx` divides by `outer.width`/`outer.height`; both must exist.
  expect(typeof box.outer.width).toBe('number');
  expect(typeof box.outer.height).toBe('number');
  // `inner` is the drawn extent: the diagram spans x=100..436.
  expect(box.inner.x).toBe(100);
  expect(box.inner.width).toBe(336);

  port.view.setViewbox({ x: 0, y: 0, width: 500, height: 500 });
  expect(port.view.viewbox()).toMatchObject({ x: 0, y: 0, width: 500, height: 500 });
  expect(port.view.zoom()).toBeCloseTo(1, 5);

  // Screen-space bbox of a shape at the current viewbox (jsdom: 1:1, origin 0,0).
  expect(port.view.getAbsoluteBBox(port.elements.get('Task_1')))
    .toMatchObject({ x: 200, y: 78, width: 100, height: 80 });

  expect(port.view.getContainer()).toBe(canvas.getContainer());

  // A named custom layer (`view.getLayer('provenance-replay', 1000)`), created on
  // first use, stable afterwards, and attached inside the canvas overlay stack.
  const layer = port.view.getLayer('provenance-replay', 1000);
  expect(layer.getAttribute('data-layer')).toBe('provenance-replay');
  expect(port.view.getLayer('provenance-replay')).toBe(layer);
  expect(layer.parentNode).toBeTruthy();

  port.view.addMarker('Task_1', 'replay-hit');
  expect(canvas.getSelection().hasMarker('Task_1', 'replay-hit')).toBe(true);
  port.view.removeMarker('Task_1', 'replay-hit');
  expect(canvas.getSelection().hasMarker('Task_1', 'replay-hit')).toBe(false);

  // Scrolling recentres the viewport on the element.
  port.view.scrollToElement(port.elements.get('Task_1'));
  const after = port.view.viewbox();
  expect(after.x + after.width / 2).toBeCloseTo(250, 5);
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

  // One logical undo step: bracketed for the app's snapshot layer, then announced.
  expect(history.log).toEqual(['reset', 'begin:updateProperties', 'end:updateProperties']);
  expect(port.revision()).toBe(1);
  expect(commands.length).toBe(1);
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
  const { port, moddle } = await mount();
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
    port.gestures.createShape({ type: 'bpmn:Task', attrs: { name: 'Made' } }),
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

// --- selection ---------------------------------------------------------------

test('selection round-trips through the facade', async () => {
  const { port } = await mount();
  const task = port.elements.get('Task_1');
  const start = port.elements.get('Start_1');

  const batches: string[][] = [];
  // `inspector/Panel.tsx` reads `newSelection` — the canvas bus uses the same name.
  port.events.on('selection.changed', (e: any) => {
    batches.push((e.newSelection as any[]).map((el) => el.id));
  });

  port.selection.select(task);
  expect(port.selection.get().map((e: any) => e.id)).toEqual(['Task_1']);

  port.selection.select(start, true);
  expect(port.selection.get().map((e: any) => e.id).sort()).toEqual(['Start_1', 'Task_1']);

  port.selection.select([task]);
  expect(port.selection.get().map((e: any) => e.id)).toEqual(['Task_1']);

  port.selection.select(null);
  expect(port.selection.get()).toEqual([]);
  expect(batches.length).toBeGreaterThan(0);
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

// --- gestures ----------------------------------------------------------------

test('gestures.startCreate mints a node on drop; primeHover is retired', async () => {
  const { canvas, port } = await mount();
  const doc = dom.window.document;
  const before = canvas.getScene()!.elementsById.size;

  const prototype = port.gestures.createShape({ type: 'bpmn:Task', attrs: { name: 'Dropped' } });
  const start = canvas.getViewport().toScreen({ x: 500, y: 400 });
  port.gestures.startCreate(
    new dom.window.MouseEvent('mousedown', { clientX: start.x, clientY: start.y, button: 0 }),
    prototype,
  );
  firePointer(canvas, doc, 'pointermove', { x: 520, y: 400 });
  firePointer(canvas, doc, 'pointerup', { x: 520, y: 400 });

  expect(canvas.getScene()!.elementsById.size).toBe(before + 1);
  const dropped = port.elements.filter((e: any) => e.businessObject?.name === 'Dropped');
  expect(dropped.length).toBe(1);
  const node = dropped[0] as SceneNode;
  expect(node.type).toBe('bpmn:Task');
  // Centred on the drop point with the palette footprint.
  expect({ x: node.x, y: node.y }).toEqual({ x: 470, y: 360 });
  // …and selected, the way a palette drop leaves it.
  expect(port.selection.get().map((e: any) => e.id)).toEqual([node.id]);

  // Design §4 (3): a diagram-js `dragging` workaround with no native counterpart.
  expect(port.gestures.primeHover(undefined as any)).toBeUndefined();

  // Lasso "activation" only means: do not keep the current selection.
  port.gestures.startLasso(undefined as any);
  expect(port.selection.get()).toEqual([]);
});

test('gestures.startConnect drags a flow out of a node', async () => {
  const { canvas, port } = await mount();
  const doc = dom.window.document;

  expect(port.gestures.startConnect(port.elements.get('Task_1'))).toBe(true);
  firePointer(canvas, doc, 'pointermove', { x: 418, y: 118 });
  firePointer(canvas, doc, 'pointerup', { x: 418, y: 118 });

  const selected = port.selection.get();
  expect(selected.length).toBe(1);
  expect(selected[0].businessObject.$type).toBe('bpmn:SequenceFlow');
  expect(selected[0].source.id).toBe('Task_1');
  expect(selected[0].target.id).toBe('End_1');
});

// --- events ------------------------------------------------------------------

test('events.on / off / fire round-trip, priority included', async () => {
  const { port } = await mount();
  const order: string[] = [];

  const low = () => order.push('low');
  const high = () => order.push('high');
  port.events.on('tokenSimulation.toggle', low);
  port.events.on('tokenSimulation.toggle', 2000, high);

  port.events.fire('tokenSimulation.toggle');
  expect(order).toEqual(['high', 'low']);

  port.events.off('tokenSimulation.toggle', high);
  order.length = 0;
  port.events.fire('tokenSimulation.toggle', { active: true });
  expect(order).toEqual(['low']);
});

// --- SVG export --------------------------------------------------------------

test('saveSVG serializes the live canvas', async () => {
  const { port } = await mount();
  const { svg } = await port.saveSVG();
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg).toContain('sf-canvas');
  expect(svg).toContain('</svg>');
});

// --- the (A) half ------------------------------------------------------------

test('the app-level half is forwarded, and inert when not injected', async () => {
  const { port, history } = await mount();

  // History quartet: re-homed to the injected snapshot layer (design §4 (1)).
  port.mutate.updateProperties(port.elements.get('Task_1'), { name: 'x' });
  expect(port.canUndo()).toBe(true);
  expect(port.canRedo()).toBe(false);
  port.undo();
  port.redo();
  expect(history.log.slice(-2)).toEqual(['undo', 'redo']);

  // Popup / templates / simulation are app services the adapter merely holds.
  const opened: string[] = [];
  const bare = createCanvasEditorPort(new Canvas(), {
    model: editorModel(freshModdle()),
    popup: { open: (providerId) => opened.push(providerId) },
    templates: { getAll: () => [{ id: 'tpl' }], createElement: () => ({ type: 'bpmn:Task' }) },
    simulation: { toggle: () => undefined, isActive: () => true },
  });
  bare.popup.open('bpmn-append', { x: 0, y: 0, cursor: { x: 0, y: 0 } });
  expect(opened).toEqual(['bpmn-append']);
  expect(bare.templates.getAll().length).toBe(1);
  expect(bare.simulation.isActive()).toBe(true);

  // With nothing injected the history is empty rather than broken.
  const inert = createCanvasEditorPort(new Canvas(), { model: editorModel(freshModdle()) });
  expect(inert.revision()).toBe(0);
  expect(inert.canUndo()).toBe(false);
  expect(inert.canRedo()).toBe(false);
  expect(() => inert.undo()).not.toThrow();
  expect(inert.popup.open('x', { x: 0, y: 0, cursor: { x: 0, y: 0 } })).toBeUndefined();
  expect(inert.templates.getAll()).toEqual([]);
  expect(inert.simulation.isActive()).toBe(false);
});
