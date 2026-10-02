import { expect, test } from '@playwright/test';

import { filterOptions, resolveTyped, toggleLiteral, type Option } from '@modeler/inspector/options';

/** An enum's field: what typing in an editable one suggests and stores, and what a tick in a many-valued one keeps. */

const TASKS: Option[] = [
  { name: 'N-Back (NB)', value: 'NB', description: 'working memory' },
  { name: 'Go/No-Go', value: 'GNG', description: 'response inhibition' },
  { name: 'Stroop', value: 'Stroop' },
];

test('typing suggests the literals whose label, value or description holds the text, in any case', () => {
  const CASES: [query: string, suggested: string[]][] = [
    ['', ['NB', 'GNG', 'Stroop']],
    [' back ', ['NB']],
    ['gng', ['GNG']],
    ['INHIB', ['GNG']],
    ['Flanker', []],
  ];
  for (const [query, suggested] of CASES) {
    expect(filterOptions(TASKS, query).map((option) => option.value), JSON.stringify(query)).toEqual(suggested);
  }
});

test('the text typed stores the value of the literal it names, by label or value in any case, and else itself', () => {
  const CASES: [typed: string, stored: string][] = [
    ['N-Back (NB)', 'NB'],
    ['  n-back (nb) ', 'NB'],
    ['gng', 'GNG'],
    [' Flanker ', 'Flanker'],
    ['  ', ''],
  ];
  for (const [typed, stored] of CASES) expect(resolveTyped(TASKS, typed), JSON.stringify(typed)).toBe(stored);
});

test("a tick in a many-valued enum keeps the literals ticked in the schema's order, then the values it does not name", () => {
  const CASES: [values: string[], ticked: string, kept: string[]][] = [
    [[], 'GNG', ['GNG']],
    [['Stroop'], 'NB', ['NB', 'Stroop']],
    [['NB', 'GNG'], 'NB', ['GNG']],
    [['Flanker', 'Stroop'], 'GNG', ['GNG', 'Stroop', 'Flanker']],
  ];
  for (const [values, ticked, kept] of CASES) {
    expect(toggleLiteral(TASKS, values, ticked), `${JSON.stringify(values)}, ${ticked}`).toEqual(kept);
  }
});
