import { expect, test } from '@playwright/test';

import { type TypeEntry } from '@core/notation';
import { KINDS, TEMPLATES, addEntries, byKind, isAddable, type AddEntry } from '@modeler/palette/catalog';
import { matchesTerms, wordsOf } from '@modeler/popup/search';

// Installs the shipped catalog, which the skills' half of the list reads.
import '@tests/schemas';

/**
 * The one list of what the modeler adds, which the tools' flyouts, the Add panel, the pins and the Change menu read,
 * and the search the panel finds its rows with. Where a pick lands is the canvas's business
 * (`packages/canvas/tests/canvas-autoplace.unit.spec.ts`), and the panel wired end to end `tests/modeler.popup.spec.ts`'s.
 */

const type = (name: string, over: Partial<TypeEntry> = {}): TypeEntry => ({
  name,
  ns: { prefix: name.split(':')[0], localName: name.split(':')[1] } as any,
  isAbstract: false,
  style: 'wrapper',
  extends: [],
  meta: {} as any,
  bpmnType: 'bpmn:Task',
  attributes: [],
  defaults: {},
  tags: [],
  hiddenFromPalette: false,
  paletteLabel: name,
  ...over,
});

const find = (entries: AddEntry[], id: string): AddEntry => entries.find((entry) => entry.id === id)!;

test('the list is BPMN\'s own kind by kind, then the skills\' types and templates, each filed under a kind', () => {
  const entries = addEntries();
  // Every row can be acted on, and its id is unique: a pin and an e2e spec name it.
  expect(entries.every((entry) => !!entry.bpmnType && !!entry.id && !!entry.label)).toBe(true);
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);

  // BPMN's own come first, in the tools' order of kinds, named by label; a skill's type by its name; a template by its id.
  const own = entries.filter((entry) => !entry.skill);
  expect([...new Set(own.map((entry) => entry.kind))]).toEqual(KINDS);
  expect(entries.indexOf(own.at(-1)!)).toBe(own.length - 1);
  expect(find(entries, 'create-Service')).toMatchObject({ kind: 'Activities', bpmnType: 'bpmn:ServiceTask' });
  expect(find(entries, 'create-cognitive:CognitiveTask')).toMatchObject({ kind: 'Activities', skill: { prefix: 'cognitive', required: false } });
  // A skill that always loads says so: its types join BPMN's own above a flyout's rule.
  expect(find(entries, 'create-studyflow:Schema')).toMatchObject({ kind: 'Data', skill: { prefix: 'studyflow', required: true } });
  expect(entries.some((entry) => entry.id.startsWith('template-') && entry.kind === TEMPLATES && !!entry.template)).toBe(true);

  // Every shipped type has a kind, a choreography task's among them: none falls to a section of its skill's.
  expect(entries.filter((entry) => !entry.template && !KINDS.includes(entry.kind))).toEqual([]);

  // Filed for a list: the kinds in the tools' order, a category no kind takes after them, the templates last.
  const odd = { ...find(entries, 'create-cognitive:CognitiveTask'), id: 'odd', kind: 'Robots' };
  expect(byKind([...entries, odd]).map((section) => section.kind)).toEqual([...KINDS, 'Robots', TEMPLATES]);

  // A skill's type is offered when a person makes it (the palette does not hide it) and a BPMN type mints it.
  const CASES: [label: string, entry: TypeEntry, offered: boolean][] = [
    ['a concrete type', type('cognitive:Instruction'), true],
    ['one the palette hides: abstract, a trait, a value, or one BPMN\'s own stands for', type('studyflow:StartEvent', { hiddenFromPalette: true }), false],
    ['one with no BPMN type', type('cognitive:Value', { bpmnType: null }), false],
  ];
  for (const [label, entry, offered] of CASES) expect(isAddable(entry), label).toBe(offered);
});

test('a search finds a row by the start of its words: its label\'s, its type\'s, its skill\'s, its kind\'s', () => {
  const entries = addEntries();
  const found = (query: string): string[] => entries
    .filter((entry) => matchesTerms(`${entry.label} ${entry.keywords}`, wordsOf(query)))
    .map((entry) => entry.id);

  const CASES: [query: string, id: string, listed: boolean][] = [
    ['task', 'create-Task', true],
    ['task', 'create-cognitive:CognitiveTask', true],
    // BPMN's own are found by their type's name, in one word or two.
    ['user task', 'create-User', true],
    ['usertask', 'create-User', true],
    // A skill's type by its own name, not the BPMN type it rides on.
    ['task', 'create-reachy:LookAt', false],
    ['look', 'create-reachy:LookAt', true],
    ['reachy', 'create-reachy:LookAt', true],
    ['gateway', 'create-Exclusive', true],
    // Not from the middle of a word.
    ['ask', 'create-Task', false],
  ];
  for (const [query, id, listed] of CASES) expect(found(query).includes(id), `"${query}" finds ${id}`).toBe(listed);
});
