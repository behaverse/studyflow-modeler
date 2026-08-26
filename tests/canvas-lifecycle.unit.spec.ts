import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { Canvas, setDocument } from '@canvas/index.ts';
import type { SceneNode } from '@canvas/model/scene.ts';

import { loadSchemaModels } from './schemas';

/**
 * `Canvas` teardown (CanvasReview H4).
 *
 * A canvas installs listeners on THREE owners: its own SVG root (`pointerdown`,
 * `dblclick`), the HOST container (`keydown` — the shortcut scope), and, for the
 * duration of a gesture, the document (`pointermove`/`pointerup`/`keydown`). The
 * container outlives the canvas — a route change, a backend switch, "New diagram"
 * all keep the same `<div>` — so a canvas that cannot be torn down keeps answering
 * keystrokes forever and pins its whole `bpmn:Definitions` moddle tree.
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

const PROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_1" name="Task" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function parse(xml = PROCESS_XML): Promise<any> {
  const { rootElement } = await freshModdle().fromXML(xml);
  return rootElement;
}

function container(): HTMLElement {
  const el = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(el);
  return el as unknown as HTMLElement;
}

/** Records add/removeEventListener pairs on an element without changing behaviour. */
function trackListeners(target: any): { live: () => string[] } {
  const live = new Map<string, number>();
  const add = target.addEventListener.bind(target);
  const off = target.removeEventListener.bind(target);
  target.addEventListener = (type: string, fn: any, opts?: any) => {
    live.set(type, (live.get(type) ?? 0) + 1);
    add(type, fn, opts);
  };
  target.removeEventListener = (type: string, fn: any, opts?: any) => {
    const n = (live.get(type) ?? 0) - 1;
    if (n > 0) live.set(type, n);
    else live.delete(type);
    off(type, fn, opts);
  };
  return { live: () => [...live.keys()].sort() };
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

function firePointer(canvas: Canvas, target: EventTarget, type: string, diagram: { x: number; y: number }): void {
  const screen = canvas.getViewport().toScreen(diagram);
  target.dispatchEvent(new dom.window.MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: screen.x, clientY: screen.y, button: 0,
  }));
}

// --- H4: destroy() ------------------------------------------------------------

test('destroy removes every listener the canvas installed and detaches the SVG', async () => {
  const host = container();
  const tracked = trackListeners(host);
  const canvas = new Canvas({ container: host });
  const rootTracked = trackListeners(canvas.getSvg());
  canvas.importDefinitions(await parse());

  expect(tracked.live(), 'the shortcut listener sits on the host container').toEqual(['keydown']);
  expect(host.contains(canvas.getSvg() as unknown as Node)).toBe(true);

  canvas.destroy();

  expect(canvas.isDestroyed()).toBe(true);
  expect(tracked.live(), 'the container is handed back clean').toEqual([]);
  expect(rootTracked.live(), 'pointerdown/dblclick come off the root too').toEqual([]);
  expect(host.contains(canvas.getSvg() as unknown as Node)).toBe(false);
  // Idempotent.
  canvas.destroy();
  expect(tracked.live()).toEqual([]);
});

test('destroy: a stale canvas no longer answers Delete on a container it shared', async () => {
  const host = container();
  const stale = new Canvas({ container: host });
  const staleDefs = await parse();
  stale.importDefinitions(staleDefs);
  stale.getSelection().select(node(stale, 'Task_1'));

  // The host reuses the same element for the next editor (backend switch / new file).
  stale.destroy();
  const live = new Canvas({ container: host });
  const liveDefs = await parse();
  live.importDefinitions(liveDefs);
  live.getSelection().select(node(live, 'Start_1'));

  host.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

  const ids = (defs: any): string[] =>
    defs.rootElements[0].flowElements.map((el: any) => el.id).sort();
  expect(ids(staleDefs), 'the destroyed canvas kept its hands off its document')
    .toEqual(['Start_1', 'Task_1']);
  expect(ids(liveDefs), 'the live canvas deleted its own selection').toEqual(['Task_1']);
  live.destroy();
});

test('destroy mid-gesture abandons the drag and drops the document-level listeners', async () => {
  const host = container();
  const canvas = new Canvas({ container: host });
  const definitions = await parse();
  canvas.importDefinitions(definitions);
  const doc = canvas.getSvg().ownerDocument!;
  const tracked = trackListeners(doc);
  const task = node(canvas, 'Task_1');

  firePointer(canvas, canvas.getSvg(), 'pointerdown', { x: 250, y: 120 });
  firePointer(canvas, doc, 'pointermove', { x: 310, y: 180 });
  expect(tracked.live()).toEqual(['keydown', 'pointermove', 'pointerup']);
  expect(task.x, 'the scene moved live').toBe(260);

  canvas.destroy();

  expect(tracked.live(), 'the document trio is removed even mid-drag').toEqual([]);
  // The gesture was abandoned, not committed: the snapshot is back and the DI,
  // which a live drag never touches, still describes the original box.
  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 80 });
  const bounds = definitions.diagrams[0].plane.planeElement
    .find((pe: any) => pe.bpmnElement?.id === 'Task_1').bounds;
  expect({ x: bounds.x, y: bounds.y }).toEqual({ x: 200, y: 80 });

  // A late event from the in-flight gesture must not reach a torn-down canvas.
  firePointer(canvas, doc, 'pointerup', { x: 310, y: 180 });
  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 80 });
});
