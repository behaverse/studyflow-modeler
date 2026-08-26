import { expect, test } from '@playwright/test';

import { buildCatalog, setCatalog, type TypeEntry } from '@core/notation';
import { buildElementEntries, isAppendable } from '@modeler/popup/entries';
import { APPEND_DISTANCE, canAppendFrom, mustDragToAppend, runAppendElement, runStartAppendElement } from '@modeler/popup/commands';
import { loadSchemaModels } from './schemas';

/**
 * The catalog half of the app-rendered create/append menus, and the click-append
 * geometry that stands in for the `autoPlace` the canvas does not have (P6b §3A).
 *
 * Browserless: the entry builder is pure, and the commands only ever touch the
 * `EditorPort`, so a hand-written port is a complete stand-in for either backend.
 */

setCatalog(buildCatalog(loadSchemaModels()));

const entry = (name: string, over: Partial<TypeEntry> = {}): TypeEntry => ({
  name,
  ns: { prefix: name.split(':')[0], localName: name.split(':')[1] } as any,
  isAbstract: false,
  style: 'wrapper',
  extends: [],
  meta: {} as any,
  bpmnType: 'bpmn:Task',
  attributes: [],
  defaults: {},
  roles: [],
  hiddenFromPalette: false,
  paletteLabel: name,
  paletteCategories: [],
  ...over,
});

test.describe('popup menu entries', () => {
  test('a type is appendable when it is concrete, not palette-owned, and has a BPMN type', () => {
    expect(isAppendable(entry('cognitive:Instruction'))).toBe(true);
    expect(isAppendable(entry('cognitive:Abstract', { isAbstract: true }))).toBe(false);
    expect(isAppendable(entry('cognitive:Value', { bpmnType: null }))).toBe(false);
    // The static palette groups already offer these, so the menu must not double them.
    expect(isAppendable(entry('studyflow:StartEvent'))).toBe(false);
    expect(isAppendable(entry('studyflow:EndEvent'))).toBe(false);
  });

  test('the menu leads with the BPMN groups and follows with one group per schema', () => {
    const groups = buildElementEntries();
    const names = groups.map((group) => group.name);

    expect(names.slice(0, 5)).toEqual(['Events', 'Activities', 'Gateways', 'Data', 'Containers']);
    expect(names.length).toBeGreaterThan(5);

    const all = groups.flatMap((group) => group.entries);
    // Every row can be acted on: a BPMN type to mint, an id, a label.
    expect(all.every((e) => !!e.bpmnType && !!e.id && !!e.label)).toBe(true);
    // Ids are unique — they are React keys and e2e handles.
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);

    // The palette half keeps its ids; the schema half is keyed by extension type.
    expect(all.find((e) => e.id === 'create-bpmn:ServiceTask')?.label).toBe('Service');
    expect(all.some((e) => e.id.startsWith('append-cognitive:'))).toBe(true);
    // Search matches the label AND the type, so "usertask" finds "User".
    expect(all.find((e) => e.id === 'create-bpmn:UserTask')?.keywords).toContain('usertask');
  });
});

/** A minimal `EditorPort` — only the members the append commands reach. */
function fakePort() {
  const calls: any[] = [];
  const root = { id: 'Process_1' };
  const created: any = { id: 'Task_2', businessObject: { id: 'Task_2' } };
  const port: any = {
    model: {
      moddle: () => ({}),
      create: (type: string, props: any) => ({ $type: type, ...props }),
      createBusinessObject: (type: string, props: any) => ({ $type: type, ...props }),
      ids: { nextPrefixed: (prefix: string) => `${prefix}2`, assigned: () => false },
    },
    elements: { root: () => root, findRoot: () => root },
    rules: { allowed: (action: string, ctx: any) => action === 'shape.append' && !!ctx.element },
    gestures: {
      createShape: (attrs: any) => ({ ...attrs, width: 36, height: 36 }),
      startCreate: (...args: any[]) => calls.push(['startCreate', ...args]),
      primeHover: () => calls.push(['primeHover']),
    },
    mutate: {
      createShape: (shape: any, position: any, parent: any) => {
        calls.push(['createShape', shape, position, parent]);
        return created;
      },
      createConnection: (...args: any[]) => {
        calls.push(['createConnection', ...args]);
        return { id: 'Flow_1' };
      },
    },
    selection: { get: () => [], select: (e: any) => calls.push(['select', e]) },
    revision: () => 0,
  };
  return { handle: { backend: 'canvas', editor: port, destroy: () => {} } as any, port, calls, created, root };
}

test.describe('append commands', () => {
  const source = { id: 'Task_1', x: 100, y: 200, width: 100, height: 80, parent: undefined };

  test('a click-append lands one gap right of its source, centred on it, and is connected', () => {
    const { handle, calls, created, root } = fakePort();

    const result = runAppendElement(handle, {
      type: 'AppendElement',
      source,
      bpmnType: 'bpmn:EndEvent',
      extensionType: 'studyflow:EndEvent',
    });

    expect(result).toBe(created);

    const [, shape, position, parent] = calls.find((c) => c[0] === 'createShape')!;
    expect(shape.type).toBe('bpmn:EndEvent');
    // 100 + 100 + 50 + half the 36-wide event.
    expect(position).toEqual({ x: 100 + 100 + APPEND_DISTANCE + 18, y: 240 });
    // No parent of its own: the source's plane.
    expect(parent).toBe(root);

    const [, from, to] = calls.find((c) => c[0] === 'createConnection')!;
    expect([from, to]).toEqual([source, created]);
    // Nobody selected it, so the command does.
    expect(calls.some((c) => c[0] === 'select' && c[1] === created)).toBe(true);
  });

  test('a rejected drop writes no connection', () => {
    const { handle, port, calls } = fakePort();
    port.mutate.createShape = () => undefined;

    expect(runAppendElement(handle, { type: 'AppendElement', source, bpmnType: 'bpmn:Task' })).toBeUndefined();
    expect(calls.some((c) => c[0] === 'createConnection')).toBe(false);
  });

  test('a drag-append hands the source to the create gesture instead of placing anything', () => {
    const { handle, calls } = fakePort();
    const event = { clientX: 10, clientY: 20 };

    runStartAppendElement(handle, {
      type: 'StartAppendElement',
      source,
      bpmnType: 'bpmn:BoundaryEvent',
      event,
    });

    const [, gestureEvent, , context] = calls.find((c) => c[0] === 'startCreate')!;
    expect(gestureEvent).toBe(event);
    expect(context).toEqual({ source });
    expect(calls.some((c) => c[0] === 'createShape')).toBe(false);
  });

  test('a boundary event is the one type that must be dragged, as on the bpmn backend', () => {
    expect(mustDragToAppend('bpmn:BoundaryEvent')).toBe(true);
    expect(mustDragToAppend('bpmn:Task')).toBe(false);
  });

  test('the append affordance asks the editor, and answers no without a selection', () => {
    const { handle } = fakePort();
    expect(canAppendFrom(handle, source)).toBe(true);
    expect(canAppendFrom(handle, undefined)).toBe(false);
  });
});
