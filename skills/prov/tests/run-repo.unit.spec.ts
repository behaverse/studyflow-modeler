import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { RunRepo } from '@skills/prov/prov';

/** The run repository (skills/prov/prov.ts), on its own. What a whole run leaves in it is pinned by
 * skills/local/tests/cli-run.unit.spec.ts. */

test.skip(spawnSync('git', ['--version']).error !== undefined, 'git is not on PATH');

/** Two file contents whose blobs git keeps under `objects/17/`, the one folder `gc --auto` counts to decide. */
function countedBlobs(): string[] {
  const found: string[] = [];
  for (let n = 0; found.length < 2; n += 1) {
    const text = `step ${n}`;
    if (createHash('sha1').update(`blob ${text.length}\0${text}`).digest('hex').startsWith('17')) found.push(text);
  }
  return found;
}

test('a checkpoint starts no housekeeping, which is done once the run has ended', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-repo-'));
  const repo = new RunRepo(dir, () => undefined);
  repo.open();
  // A repository that repacks after any commit that leaves two objects in the folder it counts, and waits for it.
  // Git's own does so in the background, at 6,700 objects, and loses commits made while it runs.
  for (const [key, value] of [['gc.auto', '1'], ['gc.autoDetach', 'false']]) execFileSync('git', ['-C', dir, 'config', key, value]);
  const packs = (): string[] => fs.readdirSync(path.join(dir, '.git', 'objects', 'pack')).filter((name) => name.endsWith('.pack'));
  const [first, second] = countedBlobs();
  for (const [step, text] of [['a', first], ['b', second], ['c', 'c']]) {
    fs.writeFileSync(path.join(dir, `${step}.txt`), text);
    repo.commit(`executed ${step}`, { 'Prov-Action': 'executed', 'Prov-Node': step });
  }
  expect(packs()).toEqual([]);
  repo.tidy();
  expect(packs()).toHaveLength(1);
  expect(execFileSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('3');
});
