import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/** `studyflow run` starts only a study that passes the plan checks, and hands the runtime its protocol digest;
 * `validate` says whether the protocol is still the one a run recorded; `info` shows it. */

const dir = mkdtempSync(path.join(tmpdir(), 'studyflow-checks-'));
const bin = path.join(dir, 'bin', 'studyflow.mjs');
const VERSION = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version;

// The CLI reads its schemas through Vite (`import.meta.glob`), so it is built here rather than imported.
test.beforeAll(() => {
  execFileSync(process.execPath, [path.join(process.cwd(), 'node_modules/vite/bin/vite.js'), 'build', 'packages/cli', '--outDir', path.dirname(bin), '--logLevel', 'error']);
});

const studyflow = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

const write = (name: string, text: string): string => {
  const file = path.join(dir, name);
  writeFileSync(file, text);
  return file;
};

const study = (split: string) => `id: checked
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Split:
      type: ${split}
      name: Split here
    A:
      type: Task
      name: Play 30 trials
    B:
      type: Task
    End:
      type: EndEvent
    F0: Start -> Split
    F1: Split -> A
    F2: Split -> B
    F3: A -> End
    F4: B -> End
`;

function hasUv(): boolean {
  try {
    execFileSync('uv', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('run refuses a study that fails a plan check, and hands a passing one its protocol digest and the tool', () => {
  test.skip(!hasUv(), 'uv is not on PATH');
  // A runtime that prints what it was started with.
  const runtime = { STUDYFLOW_RUN_PY: write('runtime.py', 'import json, sys\nprint(json.dumps(sys.argv[1:]))\n') };

  const refused = studyflow(['run', write('split.studyflow.yaml', study('ParallelGateway'))], runtime);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain('error: "Split here" splits into 2 parallel paths; a pool walks one path, so the reference runners stop here');
  expect(refused.stdout).toBe('');

  const file = write('decided.studyflow.yaml', study('ExclusiveGateway'));
  const started = studyflow(['run', file, '--tool', 'mine/1'], runtime);
  expect(started.status).toBe(0);
  const args: string[] = JSON.parse(started.stdout);
  const protocol = JSON.parse(studyflow(['info', '--json', file]).stdout).protocol;
  expect(protocol).toMatch(/^sha256:[0-9a-f]{64}$/);
  // Ours ahead of the caller's, so the caller's `--tool` wins.
  expect(args.slice(-6)).toEqual(['--plan-digest', protocol, '--tool', `studyflow-cli/${VERSION}`, '--tool', 'mine/1']);
});

test('validate says the protocol matches the run that recorded it, and warns once it changed; info shows it', () => {
  const plan = study('ExclusiveGateway');
  const protocol = JSON.parse(studyflow(['info', '--json', write('plan.studyflow.yaml', plan)]).stdout).protocol;
  expect(studyflow(['info', path.join(dir, 'plan.studyflow.yaml')]).stdout).toContain(`  protocol: ${protocol}\n`);

  const state = `state:\n  _meta:\n    prov:\n      - { action: executed, run: r1, plan: "${protocol}" }\n`;
  const sealed = write('sealed.studyflow.yaml', plan + state);
  const matched = studyflow(['validate', sealed]);
  expect(matched.status).toBe(0);
  expect(matched.stdout).toBe(`${sealed}: OK, protocol matches run r1 (${protocol.slice(0, 19)}…)\n`);

  const edited = write('edited.studyflow.yaml', plan.replace('Play 30 trials', 'Play 20 trials') + state);
  const changed = studyflow(['validate', edited]);
  expect(changed.status).toBe(0);
  expect(changed.stderr).toMatch(/^warning: protocol changed since run r1: recorded sha256:[0-9a-f]{12}…, now sha256:[0-9a-f]{12}…\n$/);
  expect(changed.stdout).toBe(`${edited}: OK (1 warning)\n`);
});
