import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';

import { expect, test } from '@playwright/test';

/** A skill's Python runner may carry an assert-based self-check (`skills/<name>/test_*.py`), and so does the runner SDK
 * (`packages/runtime-local/python`); each runs here, so CI runs it too. */

function works(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/* The runners are `uv` scripts that declare PyYAML, as the local runtime starts them; a bare python3 may lack it. */
const python: [string, string[]] | undefined = works('uv', ['--version'])
  ? ['uv', ['run', '--quiet', '--no-project', '--with', 'pyyaml>=6.0', 'python3']]
  : works('python3', ['--version']) ? ['python3', []] : undefined;

for (const file of [...globSync('skills/*/test_*.py'), ...globSync('packages/runtime-local/python/test_*.py')]) {
  test(file, () => {
    test.skip(!python, 'neither uv nor python3 is on PATH');
    const [command, args] = python!;
    expect(() => execFileSync(command, [...args, file], { stdio: 'pipe' })).not.toThrow();
  });
}
