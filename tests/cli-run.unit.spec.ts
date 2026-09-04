import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '@core/notation';
import { toModdlePackages } from '@core/notation/schemaFile';
import { declaredRuntime, studyflowToDefinitions, studyflowToXml } from '@core/document';
import { loadSchemaModels } from './schemas';

/** `studyflow run` reads `runtime` where the modeler writes it: on the `studyflow:Study` extension of the process. */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const moddle = new BpmnModdle(packages) as any;

function study(processBody: string): any {
  return studyflowToDefinitions(`id: rt
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
${processBody}
  flowElements:
    Start:
      type: StartEvent
`, moddle, () => {});
}

test.describe('declaredRuntime', () => {
  test('reads the Study extension, where the inspector stores it', () => {
    const definitions = study(`  extensionElements:
    - type: studyflow:Study
      runtime: local`);
    expect(declaredRuntime(definitions)).toBe('local');
  });

  test('falls back to the schema default when nothing declares it', () => {
    const definitions = study(`  extensionElements:
    - type: studyflow:Study`);
    expect(declaredRuntime(definitions)).toBe('cloud');
  });

  test('still honors a bare attribute on the process from older files', () => {
    const definitions = study(`  runtime: browser`);
    expect(declaredRuntime(definitions)).toBe('browser');
  });
});

/** The Python runner keeps `state` (docs/design/state.md): `_meta.prov` run records, `_meta.reached` visit counts. */

const CLI_SRC = path.resolve(__dirname, '../packages/cli/src');

function hasUv(): boolean {
  try {
    execFileSync('uv', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function archivedState(file: string): any {
  const xml = fs.readFileSync(file, 'utf8');
  const body = xml.match(/<studyflow:state>(.*?)<\/studyflow:state>/s)?.[1] ?? '{}';
  return JSON.parse(body.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}

test.describe('studyflow-run-local state', () => {
  test.skip(!hasUv(), 'uv is not on PATH');

  test('appends _meta.prov and counts reaches, persisting across runs', async () => {
    const xml = await studyflowToXml(`id: reach
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  properties:
    P_Runs:
      name: runs
      value: "0"
  flowElements:
    Start:
      type: StartEvent
    Done:
      type: EndEvent
      name: Excluded (n={count})
      properties:
        P_Count:
          name: count
          value: "0"
    F1: Start -> Done
`, moddle);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-run-'));
    // The runner and its prov module alone: the partial runners beside them (reachy, python) would be asked
    // for their claims and need their own dependencies.
    for (const name of ['studyflow-run-local.py', 'studyflow-prov.py']) {
      fs.copyFileSync(path.join(CLI_SRC, name), path.join(dir, name));
    }
    const plan = path.join(dir, 'reach.bpmn');
    fs.writeFileSync(plan, xml);
    const run = (file: string) =>
      execFileSync('uv', ['run', '--script', path.join(dir, 'studyflow-run-local.py'), file, '--repo', path.join(dir, 'run'), '--quiet'], {
        cwd: dir, stdio: 'pipe',
      });

    run(plan);
    const archived = path.join(dir, 'run', 'reach.bpmn');
    const first = archivedState(archived);
    expect(first._meta.prov).toHaveLength(1);
    expect(first._meta.prov[0]).toMatchObject({ action: 'executed', run: 'run', with: 'studyflow-run-local.py' });
    expect(first._meta.reached).toEqual({ Start: 1, Done: 1 });
    expect(first.S.runs).toBe(0);
    expect(first.Done).toEqual({ count: 0 });

    run(archived);
    const second = archivedState(archived);
    expect(second._meta.prov).toHaveLength(2);
    expect(second._meta.reached.Done).toBe(2);
  });
});
