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

/** The Python runner keeps `state` (docs/developers.qmd, "What a run leaves behind"): `_meta.prov` run records, `_meta.reached` visit counts. */

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

/** What a partial runner is handed: `plan.json`, the plan as one JSON digest, never the diagram. */

function hasPython(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test.describe('partial runner hand-off', () => {
  test.skip(!hasPython(), 'python3 is not on PATH');

  test('hands partial runners a JSON digest of the plan', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:cognitive="http://behaverse.org/schemas/cognitive/v1" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="C"><bpmn:participant id="Pool" name="Lab" processRef="P"><bpmn:extensionElements><cognitive:actor kind="robot"/></bpmn:extensionElements></bpmn:participant></bpmn:collaboration>
  <bpmn:process id="P" studyflow:seed="7">
    <bpmn:extensionElements><studyflow:study runtime="local"><studyflow:dependencies>pandas>=2.0</studyflow:dependencies><studyflow:dependencies>joblib</studyflow:dependencies></studyflow:study></bpmn:extensionElements>
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T" name="fit" implementation="python://m.f">
      <bpmn:extensionElements><cognitive:cognitiveTask instrument="x"><cognitive:note>a</cognitive:note><cognitive:note>b</cognitive:note></cognitive:cognitiveTask></bpmn:extensionElements>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
      <bpmn:ioSpecification><bpmn:dataInput id="In1" name="table"/></bpmn:ioSpecification>
      <bpmn:dataInputAssociation id="DIA"><bpmn:sourceRef>Dat</bpmn:sourceRef><bpmn:targetRef>In1</bpmn:targetRef><bpmn:transformation language="python">x = y</bpmn:transformation></bpmn:dataInputAssociation>
      <bpmn:dataOutputAssociation id="DOA"><bpmn:targetRef>Out</bpmn:targetRef></bpmn:dataOutputAssociation>
      <studyflow:additionalArguments>k: 1</studyflow:additionalArguments>
    </bpmn:task>
    <bpmn:dataObjectReference id="Dat" name="digits" studyflow:uri="digits.csv"/>
    <bpmn:dataObjectReference id="Out" name="model"/>
    <bpmn:endEvent id="Done"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="T"/>
    <bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="Done"/>
  </bpmn:process>
</bpmn:definitions>`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-handoff-'));
    fs.copyFileSync(path.join(CLI_SRC, 'studyflow-run-local.py'), path.join(dir, 'studyflow-run-local.py'));
    fs.writeFileSync(path.join(dir, 'plan.bpmn'), xml);
    // A runner that claims T and completes it, keeping a copy of what it was handed.
    fs.writeFileSync(path.join(dir, 'fake.py'), [
      'import json, shutil, sys',
      'plan, mode = sys.argv[1], sys.argv[2]',
      "assert plan.endswith('plan.json'), plan",
      "shutil.copyfile(plan, plan + '.seen')",
      "if mode == '--claims': print(json.dumps({'elements': ['T'], 'live': False}))",
      'else:',
      "    handoff = sys.argv[5] + '/' + sys.argv[3] + '.state.json'",
      '    state = json.load(open(handoff))',
      "    json.dump({**state, 'result': 1, 'durationMs': 0}, open(handoff, 'w'))",
    ].join('\n'));
    execFileSync('python3', [path.join(dir, 'studyflow-run-local.py'), 'plan.bpmn', '--repo', 'run', '--quiet', '--debug',
      '--runner', `fake=python3 ${path.join(dir, 'fake.py')}`], { cwd: dir, stdio: 'pipe' });

    const digest = JSON.parse(fs.readFileSync(path.join(dir, 'run', '.cache', 'plan.json.seen'), 'utf8'));
    expect(digest.study).toEqual({ id: 'P', name: 'Lab', seed: '7', dependencies: ['pandas>=2.0', 'joblib'] });
    expect(digest.sources.length).toBeGreaterThan(0);
    const task = digest.elements.T;
    expect(task.type).toBe('task');
    expect(task.attributes.implementation).toBe('python://m.f');
    expect(task.extensions).toEqual([{ namespace: 'http://behaverse.org/schemas/cognitive/v1', type: 'cognitiveTask', attributes: { instrument: 'x', note: ['a', 'b'] } }]);
    expect(task.additionalArguments).toBe('k: 1');
    expect(task.ioSlots).toEqual({ In1: 'table' });
    expect(task.inputs).toEqual([{ source: 'Dat', target: 'In1', transformation: 'x = y', language: 'python' }]);
    expect(task.outputs).toEqual([{ target: 'Out', transformation: null, language: null }]);
    expect(digest.elements.Dat.attributes.uri).toBe('digits.csv');
    expect(digest.elements.Pool.extensions[0]).toEqual({ namespace: 'http://behaverse.org/schemas/cognitive/v1', type: 'actor', attributes: { kind: 'robot' } });
  });
});
