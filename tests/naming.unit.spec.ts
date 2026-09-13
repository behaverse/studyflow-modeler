import { expect, test } from '@playwright/test';
import { firstSentence } from '@core/naming';

/** The one-line blurb a settings row or a gallery card shows. */

test('firstSentence takes the first sentence, on one line', () => {
  const CASES: [input: string, expected: string][] = [
    ['', ''],
    ['One sentence.', 'One sentence.'],
    ['First. Second.', 'First.'],
    ['No terminator at all', 'No terminator at all'],
    ['Multi\nline text. Rest.', 'Multi line text.'],
    ['Question? Statement.', 'Question?'],
    ['Bang! Then more.', 'Bang!'],
    // A dot ends the sentence only before a capital or the end.
    ['Reads a pandas.DataFrame and fits it. Then scores.', 'Reads a pandas.DataFrame and fits it.'],
    ['Runs a battery, e.g. an N-back block. Then a survey.', 'Runs a battery, e.g. an N-back block.'],
  ];
  for (const [input, expected] of CASES) {
    expect(firstSentence(input), JSON.stringify(input)).toBe(expected);
  }
});
