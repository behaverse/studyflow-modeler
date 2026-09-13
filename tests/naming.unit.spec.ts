import { expect, test } from '@playwright/test';
import { firstSentence } from '@core/naming';

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
