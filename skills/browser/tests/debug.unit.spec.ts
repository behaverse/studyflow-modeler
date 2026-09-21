import { expect, test } from '@playwright/test';

import { describeForDebug, isDebug } from '@runner/debug';
import { readSubjectId, seedFromSubject, withSubjectSeed } from '@runner/subject';

/** The debug flag that stands name cards in for the heavy screens, and the subject id that fixes allocation. */

test('debug is on for the flag spellings a link actually carries', () => {
  for (const search of ['?debug=1', '?debug=true', '?debug', '?debug=', '?diagram=x&debug=yes']) {
    expect(isDebug(search), search).toBe(true);
  }
});

test('debug is off when absent or switched off', () => {
  for (const search of ['', '?diagram=x', '?debug=0', '?debug=false', '?debug=off']) {
    expect(isDebug(search), search).toBe(false);
  }
});

test('a card names the node and carries what tells the steps apart', () => {
  const card = describeForDebug(
    { id: 'Task_DS_01', businessObject: { name: 'Digit Span', $attrs: { instrument: 'BM', timeline: 'Test' } } },
    'behaverse',
  );
  expect(card).toEqual({
    name: 'Digit Span',
    kind: 'behaverse',
    details: { id: 'Task_DS_01', instrument: 'BM', timeline: 'Test' },
  });
});

test('a card falls back to the id when the node is unnamed', () => {
  expect(describeForDebug({ id: 'Task_7', businessObject: {} }, 'questionnaire').name).toBe('Task_7');
});

test('the same subject always seeds the same, and different subjects differ', () => {
  expect(seedFromSubject('P042')).toBe(seedFromSubject('P042'));
  expect(seedFromSubject('P042')).not.toBe(seedFromSubject('P043'));
  expect(Number.isSafeInteger(seedFromSubject('P042'))).toBe(true);
});

test('a subject id supplies the seed, and an explicit seed still wins', () => {
  const derived = withSubjectSeed({ subject_id: 'P042' });
  expect(derived.seed).toBe(String(seedFromSubject('P042')));
  expect(withSubjectSeed({ subject_id: 'P042', seed: '42' }).seed).toBe('42');
  expect(withSubjectSeed({ diagram: 'x' })).toEqual({ diagram: 'x' });
});

test('the subject id is read under the spellings in use, and blanks do not count', () => {
  expect(readSubjectId({ subjectId: ' P042 ' })).toBe('P042');
  expect(readSubjectId({ participant_id: 'P9' })).toBe('P9');
  expect(readSubjectId({ subject_id: '   ' })).toBeUndefined();
  expect(readSubjectId({})).toBeUndefined();
});
