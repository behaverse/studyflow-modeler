import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { evaluateFeel } from '@core/expression/feel';

/** [expression, context, value | {error: true}]: the rows skills/local/feel.py must agree with too (test_feel.py). */
const rows: [string, Record<string, unknown>, unknown][] = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests/fixtures/feel.json'), 'utf8'),
);

test('FEEL evaluates each fixture row as the local runtime does', () => {
  for (const [expression, context, expected] of rows) {
    const { value, error } = evaluateFeel(expression, context);
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && 'error' in expected) {
      expect(error, expression).toBeTruthy();
    } else {
      expect(error, expression).toBeUndefined();
      expect(value, expression).toEqual(expected);
    }
  }
});
