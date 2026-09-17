import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import { studyflowToDefinitions } from '@core/document';

import {
  diOf,
  freshModdle,
  installDocument,
  keyEvent,
  node,
  pointerDown,
  pointerMove,
  pointerUp,
} from './canvasHarness';

/**
 * `Canvas.destroy`. A canvas installs listeners on three owners: its own SVG root
 * (`pointerdown`, `dblclick`), the host container (`keydown`, the shortcut scope),
 * and, while a gesture runs, the document (`pointermove`/`pointerup`/`keydown`). The
 * container outlives the canvas (a new diagram keeps the same `<div>`), so a canvas
 * that cannot be torn down keeps answering keystrokes and pins its whole
 * `bpmn:Definitions` tree.
 */

const doc = installDocument();

const PROCESS_YAML = `id: Defs_1
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
      name: Task
      bounds: 200 80 100 80
`;

function parse(): any {
  return studyflowToDefinitions(PROCESS_YAML, freshModdle());
}

function container(): HTMLElement {
  const el = doc.createElement('div');
  doc.body.appendChild(el);
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

test('destroy hands the container back clean, so a stale canvas no longer answers keys on it', async () => {
  const host = container();
  const tracked = trackListeners(host);
  const stale = new Canvas({ container: host });
  const staleDefs = parse();
  stale.importDefinitions(staleDefs);
  stale.getSelection().select(node(stale, 'Task_1'));
  expect(tracked.live(), 'the shortcut listener sits on the host container').toContain('keydown');
  expect(host.contains(stale.getSvg() as unknown as Node)).toBe(true);

  stale.destroy();
  expect(tracked.live(), 'the container is handed back clean').toEqual([]);
  expect(host.contains(stale.getSvg() as unknown as Node), 'the SVG is detached').toBe(false);
  stale.destroy();
  expect(tracked.live(), 'a second destroy is a no-op').toEqual([]);

  // The host reuses the same element for the next editor: Delete reaches only the live canvas.
  const live = new Canvas({ container: host });
  const liveDefs = parse();
  live.importDefinitions(liveDefs);
  live.getSelection().select(node(live, 'Start_1'));
  host.dispatchEvent(keyEvent('keydown', { key: 'Delete' }));

  const ids = (defs: any): string[] => defs.rootElements[0].flowElements.map((el: any) => el.id).sort();
  expect(ids(staleDefs), 'the destroyed canvas kept its hands off its document').toEqual(['Start_1', 'Task_1']);
  expect(ids(liveDefs), 'the live canvas deleted its own selection').toEqual(['Task_1']);
  live.destroy();
});

test('destroy mid-gesture abandons the drag and drops the document-level listeners', async () => {
  const host = container();
  const canvas = new Canvas({ container: host });
  const definitions = parse();
  canvas.importDefinitions(definitions);
  const doc = canvas.getSvg().ownerDocument!;
  const tracked = trackListeners(doc);
  const task = node(canvas, 'Task_1');

  pointerDown(canvas, { x: 250, y: 120 });
  pointerMove(canvas, { x: 310, y: 180 });
  expect(tracked.live()).toEqual(expect.arrayContaining(['pointermove', 'pointerup']));
  expect(task.x, 'the scene moved live').toBe(260);

  canvas.destroy();

  expect(tracked.live(), 'the document trio is removed even mid-drag').toEqual([]);
  // The gesture was abandoned, not committed: the snapshot is back and the DI,
  // which a live drag never touches, still describes the original box.
  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 80 });
  expect(diOf(definitions, 'Task_1').bounds).toMatchObject({ x: 200, y: 80 });

  // A late event from the in-flight gesture must not reach a torn-down canvas.
  pointerUp(canvas, { x: 310, y: 180 });
  expect({ x: task.x, y: task.y }).toEqual({ x: 200, y: 80 });
});
