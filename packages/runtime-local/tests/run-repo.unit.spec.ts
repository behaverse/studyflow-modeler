import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { RunRepo } from '@runtime-local/prov';

/** The run repository (packages/runtime-local/src/prov.ts), on its own. What a whole run leaves in it is pinned by
 * packages/runtime-local/tests/cli-run.unit.spec.ts. */

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
  // The commit that last executed each element since the run began: what its record points at.
  const began = execFileSync('git', ['-C', dir, 'rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8' }).trim();
  expect([...repo.executedSince(began).keys()].sort()).toEqual(['b', 'c']);
  repo.tidy();
  expect(packs()).toHaveLength(1);
  expect(execFileSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('3');
});

test('a repository that keeps its data out commits the study and the digests of the rest, and compares by them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-outside-'));
  const repo = new RunRepo(dir, () => undefined);
  repo.open();
  repo.keepDataOut('s.studyflow.yaml', true);
  const write = (name: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  };
  const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
  const git = (...args: string[]): string => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  // What HEAD holds, and `.gitattributes` too where git-lfs is installed.
  const committed = (): string[] => git('ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter((name) => name !== '.gitattributes');
  write('s.studyflow.yaml', 'id: s\n');
  write('events.jsonl', 'a\n');
  write('frames/1.jpg', 'face');
  repo.commit('started', { 'Prov-Action': 'executed' });
  const started = git('rev-parse', 'HEAD');
  expect(committed()).toEqual(['.gitignore', 'data.sha256', 's.studyflow.yaml']);
  expect(git('show', 'HEAD:data.sha256')).toBe(`${sha('a\n')}  events.jsonl\n${sha('face')}  frames/1.jpg`);

  // A checkpoint commits neither the record nor the log, so its manifest lists them as the last commit did.
  write('events.jsonl', 'a\nb\n');
  write('frames/1.jpg', 'another face');
  repo.checkpoint('executed Look', { 'Prov-Action': 'executed', 'Prov-Node': 'Look' });
  expect(git('show', 'HEAD:data.sha256')).toBe(`${sha('a\n')}  events.jsonl\n${sha('another face')}  frames/1.jpg`);
  expect(repo.changedSince(started, ['frames/'])).toBe(true);
  expect(repo.changedSince(git('rev-parse', 'HEAD'), ['frames/'])).toBe(false);

  // Nothing comes back from such a history: a file not as the commit left it stops the run.
  fs.rmSync(path.join(dir, 'frames'), { recursive: true });
  expect(() => repo.restore('frames/', started)).toThrow(/frames\/ is not as .* left it, and this run repository keeps its data out of its history/);
  expect(repo.restore('never.json', started)).toBe(false);

  // A later run keeps it unasked; one that asks of a history holding data is refused.
  const again = new RunRepo(dir, () => undefined);
  again.keepDataOut('s.studyflow.yaml', false);
  write('later.json', '{}');
  again.commit('finished');
  expect(committed()).toEqual(['.gitignore', 'data.sha256', 's.studyflow.yaml']);
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-plain-'));
  const held = new RunRepo(plain, () => undefined);
  held.open();
  fs.writeFileSync(path.join(plain, 'events.jsonl'), 'a\n');
  held.commit('started');
  expect(() => held.keepDataOut('s.studyflow.yaml', true)).toThrow(/holds its data in its history already/);
});
