import { expect, test } from '@playwright/test';

import { type TypeEntry } from '@core/notation';
import { PALETTE_GROUPS } from '@modeler/palette/groups';
import { buildElementEntries, isAppendable } from '@modeler/popup/entries';

// Installs the shipped catalog, which the menu's schema half reads.
import '@tests/schemas';

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

test('the menu lists the palette\'s groups, then the appendable types of each schema', () => {
  const groups = buildElementEntries();
  expect(groups.slice(0, PALETTE_GROUPS.length).map((group) => group.name)).toEqual(PALETTE_GROUPS.map((group) => group.label));
  expect(groups.length).toBeGreaterThan(PALETTE_GROUPS.length);

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

  // A schema type is listed when it is concrete, has a BPMN type to mint, and is not one the palette groups offer.
  const CASES: [label: string, type: TypeEntry, listed: boolean][] = [
    ['a concrete type', entry('cognitive:Instruction'), true],
    ['an abstract one', entry('cognitive:Abstract', { isAbstract: true }), false],
    ['one with no BPMN type', entry('cognitive:Value', { bpmnType: null }), false],
    ['studyflow:StartEvent, which the palette offers', entry('studyflow:StartEvent'), false],
    ['studyflow:EndEvent, which the palette offers', entry('studyflow:EndEvent'), false],
  ];
  for (const [label, type, listed] of CASES) expect(isAppendable(type), label).toBe(listed);
});
