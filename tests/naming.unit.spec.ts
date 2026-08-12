import { expect, test } from '@playwright/test';
import { firstSentence, splitQName, toLocalName, toPrefix } from '@behaverse/studyflow-core/naming';

/** Table-driven coverage for the naming helpers. */

test.describe('firstSentence', () => {
  const CASES: [input: string, expected: string][] = [
    ['', ''],
    ['One sentence.', 'One sentence.'],
    ['First. Second.', 'First.'],
    ['No terminator at all', 'No terminator at all'],
    // Whitespace flattens: the result is a one-line blurb for settings rows.
    ['Multi\nline text. Rest.', 'Multi line text.'],
    ['Question? Statement.', 'Question?'],
    ['Bang! Then more.', 'Bang!'],
  ];

  for (const [input, expected] of CASES) {
    test(`"${input.slice(0, 30)}" -> "${expected.slice(0, 30)}"`, () => {
      expect(firstSentence(input)).toBe(expected);
    });
  }
});

test.describe('qualified names', () => {
  test('splitQName splits prefix and local name', () => {
    expect(splitQName('cognitive:CognitiveTask')).toEqual({ prefix: 'cognitive', localName: 'CognitiveTask' });
  });

  test('splitQName on a bare name has no prefix', () => {
    expect(splitQName('Task')).toEqual({ prefix: undefined, localName: 'Task' });
  });

  test('splitQName tolerates undefined', () => {
    expect(splitQName(undefined)).toEqual({ prefix: undefined, localName: undefined });
  });

  test('toLocalName / toPrefix are the two halves', () => {
    expect(toLocalName('studyflow:Dataset')).toBe('Dataset');
    expect(toPrefix('studyflow:Dataset')).toBe('studyflow');
  });
});
