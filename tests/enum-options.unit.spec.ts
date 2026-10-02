import { expect, test } from '@playwright/test';

import { filterOptions, resolveTyped, type Option } from '@modeler/inspector/options';

/** An editable enum's field: what typing in it suggests, and what the text typed stores. */

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
