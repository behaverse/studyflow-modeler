import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';

import { expect, test } from '@playwright/test';

/** A skill's Python runner may carry an assert-based self-check (`skills/<name>/test_*.py`); each runs here, so CI runs it too. */

function hasPython(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

for (const file of globSync('skills/*/test_*.py')) {
  test(file, () => {
    test.skip(!hasPython(), 'python3 is not on PATH');
    expect(() => execFileSync('python3', [file], { stdio: 'pipe' })).not.toThrow();
  });
}
