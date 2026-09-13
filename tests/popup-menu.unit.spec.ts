import { expect, test } from '@playwright/test';

import { type TypeEntry } from '@core/notation';
import { buildElementEntries, isAppendable } from '@modeler/popup/entries';

/**
 * The catalog half of the app-rendered create/append menus. The entry builder is
 * pure, so this needs no editor; where an appended element lands is the canvas's
 * business (`packages/canvas/tests/canvas-autoplace.unit.spec.ts`).
 */

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

    // The palette half is keyed by label (variants share a BPMN type); the schema half by extension type.
    expect(all.find((e) => e.id === 'create-Service')?.label).toBe('Service');
    expect(all.some((e) => e.id.startsWith('append-cognitive:'))).toBe(true);
    // Search matches the label AND the type, so "usertask" finds "User".
    expect(all.find((e) => e.id === 'create-User')?.keywords).toContain('usertask');
  });
});
