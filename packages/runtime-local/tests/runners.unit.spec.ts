import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { discoverRunners, shellWords } from '@runtime-local/runners';

/** Where the local runtime finds partial runners, and how it reads the command that starts one
 * (packages/runtime-local/src/runners.ts). What a runner is handed is pinned by
 * packages/runtime-local/tests/cli-run.unit.spec.ts. */

test('a runner\'s command splits into words as a shell splits it', () => {
  for (const [command, words] of [
    ['  python3   local.py  ', ['python3', 'local.py']],
    ['python3 -c "import sys; sys.exit(3)"', ['python3', '-c', 'import sys; sys.exit(3)']],
    // Quotes group inside a word, and an empty pair is a word of its own.
    ["--title='a b'c \"\" end", ['--title=a bc', '', 'end']],
    // A backslash escapes outside quotes and inside double ones; inside single ones it is itself.
    ['my\\ tool "a \\"quoted\\" word" \'no \\escape\'', ['my tool', 'a "quoted" word', 'no \\escape']],
  ] as const) {
    expect(shellWords(command), command).toEqual(words);
  }
});

test('an executable studyflow-<name> on PATH is the <name> runner, even in a folder whose name has a space; one not executable, with an extension, or named as the walk\'s own is not', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-path-'));
  const bin = path.join(home, 'my tools');
  fs.mkdirSync(bin);
  for (const [name, mode] of [['studyflow-echo', 0o755], ['studyflow-plain', 0o644], ['studyflow-echo.py', 0o755], ['studyflow-run', 0o755], ['echo', 0o755]] as const) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n', { mode });
  }
  const saved = process.env;
  // Nothing else in reach: a PATH folder that is gone, no skill installed, no STUDYFLOW_<NAME>_PY.
  process.env = { PATH: [path.join(home, 'gone'), bin].join(path.delimiter), STUDYFLOW_HOME: home };
  try {
    const found = discoverRunners([], []);
    expect([...found.keys()]).toEqual(['echo']);
    expect(shellWords(found.get('echo')!.command)).toEqual([path.join(bin, 'studyflow-echo')]);
  } finally {
    process.env = saved;
  }
});
