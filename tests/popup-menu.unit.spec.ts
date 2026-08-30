import { expect, test } from '@playwright/test';

import { buildCatalog, setCatalog, type TypeEntry } from '@core/notation';
import { buildElementEntries, isAppendable } from '@modeler/popup/entries';
import { canAppendFrom, mustDragToAppend, runAppendElement, runStartAppendElement } from '@modeler/popup/commands';
import { loadSchemaModels } from './schemas';

/**
 * The catalog half of the app-rendered create/append menus, and the two routes out
 * of them (P6b §3A).
 *
 * Browserless: the entry builder is pure, and the commands only ever touch the
 * `Editor`, so a hand-written stand-in serves for the whole editor. Where the
 * appended element LANDS is the editor's business and is measured in
 * `tests/canvas-autoplace.unit.spec.ts`.
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

/** A minimal `Editor` — only the members the append commands reach. */
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
    canvas: {
      createShape: (attrs: any) => ({ ...attrs, width: 36, height: 36 }),
      startCreate: (...args: any[]) => calls.push(['startCreate', ...args]),
    },
    // An append WRITES — one shape, one flow, one undo step — so it is a mutation
    // and not a gesture (`@canvas/model/mutations.ts`).
    mutate: {
      appendShape: (source: any, shape: any) => {
        calls.push(['appendShape', source, shape]);
        return created;
      },
    },
    selection: { get: () => [], select: (e: any) => calls.push(['select', e]) },
    revision: () => 0,
  };
  return { port, calls, created };
}

test.describe('append commands', () => {
  const source = { id: 'Task_1', x: 100, y: 200, width: 100, height: 80, parent: undefined };

  test('a click-append hands the source and a freshly minted shape to the editor', () => {
    const { port, calls, created } = fakePort();

    const result = runAppendElement(port, {
      type: 'AppendElement',
      source,
      bpmnType: 'bpmn:EndEvent',
      extensionType: 'studyflow:EndEvent',
    });

    expect(result).toBe(created);

    const [, from, shape] = calls.find((c) => c[0] === 'appendShape')!;
    expect(from).toBe(source);
    expect(shape.type).toBe('bpmn:EndEvent');
    expect(shape.businessObject.$type).toBe('bpmn:EndEvent');
    // Nobody selected it, so the command does.
    expect(calls.some((c) => c[0] === 'select' && c[1] === created)).toBe(true);
  });

  test('a refused append selects nothing', () => {
    const { port, calls } = fakePort();
    port.mutate.appendShape = () => undefined;

    expect(runAppendElement(port, { type: 'AppendElement', source, bpmnType: 'bpmn:Task' })).toBeUndefined();
    expect(calls.some((c) => c[0] === 'select')).toBe(false);
  });

  test('a drag-append starts a create gesture instead of placing anything', () => {
    const { port, calls } = fakePort();
    const event = { clientX: 10, clientY: 20 };

    runStartAppendElement(port, {
      type: 'StartAppendElement',
      source,
      bpmnType: 'bpmn:BoundaryEvent',
      event,
    });

    // The palette's own event, and the shape to drag — the canvas create gesture
    // takes nothing else. (The facade used to accept a `{ source }` context here and
    // drop it unread, so a drag-append has never connected on drop; it still does
    // not, but the call site no longer implies otherwise.)
    const [, gestureEvent, shape, ...rest] = calls.find((c) => c[0] === 'startCreate')!;
    expect(gestureEvent).toBe(event);
    expect(shape.type).toBe('bpmn:BoundaryEvent');
    expect(rest).toEqual([]);
    expect(calls.some((c) => c[0] === 'appendShape')).toBe(false);
  });

  test('a boundary event is the one type that must be dragged, never auto-placed', () => {
    expect(mustDragToAppend('bpmn:BoundaryEvent')).toBe(true);
    expect(mustDragToAppend('bpmn:Task')).toBe(false);
  });

  test('the append affordance asks the editor, and answers no without a selection', () => {
    const { port } = fakePort();
    expect(canAppendFrom(port, source)).toBe(true);
    expect(canAppendFrom(port, undefined)).toBe(false);
  });
});
