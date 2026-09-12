import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '@core/notation';
import { declaredRuntime, studyflowToDefinitions, studyflowToXml } from '@core/document';
import { loadSchemaModels, schemaPackages } from '@tests/schemas';

/** `studyflow run` reads `runtime` where the modeler writes it: on the `studyflow:Study` extension of the process. */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, any> = schemaPackages(models);
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
});

/** The Python runner keeps `state` (docs/developers.qmd, "What a run leaves behind"): `_meta.prov` run records, `_meta.reached` visit counts. */

const RUN = path.resolve(__dirname, '../run.py');
const PROV = path.resolve(__dirname, '../../prov/prov.py');

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
    // A copy of the runtime outside the skills tree finds no other skill, so no partial runner (reachy, python) is
    // asked for its claims or needs its dependencies; the prov module is named explicitly.
    fs.copyFileSync(RUN, path.join(dir, 'studyflow-run-local.py'));
    const plan = path.join(dir, 'reach.bpmn');
    fs.writeFileSync(plan, xml);
    const run = (file: string) =>
      execFileSync('uv', ['run', '--script', path.join(dir, 'studyflow-run-local.py'), file, '--repo', path.join(dir, 'run'), '--quiet'], {
        cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV },
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

test.describe('the local walk', () => {
  test.skip(!hasUv(), 'uv is not on PATH');

  test('refuses a parallel split instead of walking only its first branch', async () => {
    const xml = await studyflowToXml(`id: split
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Split:
      type: ParallelGateway
    A:
      type: EndEvent
    B:
      type: EndEvent
    F1: Start -> Split
    F2: Split -> A
    F3: Split -> B
`, moddle);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-run-'));
    fs.copyFileSync(RUN, path.join(dir, 'run.py'));
    fs.writeFileSync(path.join(dir, 'split.bpmn'), xml);
    let log = '';
    try {
      execFileSync('uv', ['run', '--script', path.join(dir, 'run.py'), path.join(dir, 'split.bpmn'), '--repo', path.join(dir, 'run')], {
        cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV },
      });
    } catch (error: any) {
      log = String(error.stdout);
    }
    expect(log).toContain('Split: a parallel split');
  });
  test('a seeded random gateway takes the arms the browser runner takes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-run-'));
    fs.copyFileSync(RUN, path.join(dir, 'run.py'));
    // The cognitive skill beside the copy, so the walk reads its schema's `meta.branching`; it runs nothing itself.
    fs.mkdirSync(path.join(dir, 'skills', 'cognitive'), { recursive: true });
    for (const file of ['SKILL.md', 'cognitive.moddle.yaml']) {
      fs.copyFileSync(path.resolve(__dirname, '../../cognitive', file), path.join(dir, 'skills', 'cognitive', file));
    }
    const fixture = fs.readFileSync(path.resolve(__dirname, '../../../tests/fixtures/random-loop.studyflow.yaml'), 'utf8');
    fs.writeFileSync(path.join(dir, 'loop.bpmn'), await studyflowToXml(fixture, moddle));
    execFileSync('uv', ['run', '--script', path.join(dir, 'run.py'), path.join(dir, 'loop.bpmn'), '--repo', path.join(dir, 'run'), '--quiet'], {
      cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV },
    });

    // The same arms as skills/browser/tests/scoped-state.unit.spec.ts draws from the same seed.
    const log = fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8');
    expect([...log.matchAll(/drawn → F_([AB])/g)].map((match) => match[1])).toEqual(['A', 'A', 'B', 'A']);
  });

  test('when no condition holds and there is no default, the one flow without a condition is taken', async () => {
    const xml = await studyflowToXml(`id: otherwise
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Gate:
      type: ExclusiveGateway
    No:
      type: EndEvent
    Otherwise:
      type: EndEvent
    F1: Start -> Gate
    F_No:
      type: SequenceFlow
      sourceRef: Gate
      targetRef: No
      conditionExpression: 1 > 2
    F_Otherwise: Gate -> Otherwise
`, moddle);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-run-'));
    fs.copyFileSync(RUN, path.join(dir, 'run.py'));
    fs.writeFileSync(path.join(dir, 'otherwise.bpmn'), xml);
    execFileSync('uv', ['run', '--script', path.join(dir, 'run.py'), path.join(dir, 'otherwise.bpmn'), '--repo', path.join(dir, 'run'), '--quiet'], {
      cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV },
    });
    expect(archivedState(path.join(dir, 'run', 'otherwise.bpmn'))._meta.reached).toEqual({ Start: 1, Gate: 1, Otherwise: 1 });
  });

  test('refuses to start without the prov skill', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-run-'));
    fs.copyFileSync(RUN, path.join(dir, 'run.py'));
    const { STUDYFLOW_PROV_PY: _, ...env } = process.env;
    let stderr = '';
    try {
      execFileSync('uv', ['run', '--script', path.join(dir, 'run.py'), '--help'], { cwd: dir, stdio: 'pipe', env });
    } catch (error: any) {
      stderr = String(error.stderr);
    }
    expect(stderr).toContain('no prov skill in reach');
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
  <bpmn:collaboration id="C">
    <bpmn:participant id="Pool" name="Lab" processRef="P"><bpmn:extensionElements><cognitive:actor kind="robot"/></bpmn:extensionElements></bpmn:participant>
    <bpmn:participant id="Screen" name="Screen"/>
    <bpmn:messageFlow id="M1" sourceRef="T" targetRef="Screen" messageRef="Trial"/>
  </bpmn:collaboration>
  <bpmn:message id="Trial" itemRef="Trial_Item"/>
  <bpmn:itemDefinition id="Trial_Item" structureRef="behaverse:Trial"/>
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
    <bpmn:dataObjectReference id="Twin" name="model"/>
    <bpmn:dataObjectReference id="Shadow" name="Done"/>
    <bpmn:endEvent id="Done"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="T"/>
    <bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="Done"/>
  </bpmn:process>
</bpmn:definitions>`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-handoff-'));
    fs.copyFileSync(RUN, path.join(dir, 'studyflow-run-local.py'));
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
    execFileSync('uv', ['run', '--script', path.join(dir, 'studyflow-run-local.py'), 'plan.bpmn', '--repo', 'run', '--quiet', '--debug',
      '--runner', `fake=python3 ${path.join(dir, 'fake.py')}`], { cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV } });

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
    // A message flow names its message, and the message and its item definition ride along, so a runner can follow the chain.
    expect(digest.elements.M1.attributes).toEqual({ sourceRef: 'T', targetRef: 'Screen', messageRef: 'Trial' });
    expect(digest.elements.Trial).toMatchObject({ type: 'message', attributes: { itemRef: 'Trial_Item' } });
    expect(digest.elements.Trial_Item).toMatchObject({ type: 'itemDefinition', attributes: { structureRef: 'behaverse:Trial' } });
    // `names` binds a name to one element: `model` names two, and `Done` is another element's id, so neither is offered.
    expect(digest.names).toEqual({ T: 'fit', Dat: 'digits' });
  });

  test('walks every pool at once, and steps joined by message flows start together', async () => {
    // Two pools: the screen's task and the robot's answering step exchange messages both ways, so neither
    // starts before the other is reached; the robot's greeting runs first, the task waits for it.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="C">
    <bpmn:participant id="Screen" name="Screen" processRef="S"/>
    <bpmn:participant id="Robot" name="Robot" processRef="R"/>
    <bpmn:messageFlow id="M1" sourceRef="Play" targetRef="Answer"/>
    <bpmn:messageFlow id="M2" sourceRef="Answer" targetRef="Play"/>
  </bpmn:collaboration>
  <bpmn:process id="S">
    <bpmn:startEvent id="S0"><bpmn:outgoing>SF1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Play" name="Play"><bpmn:incoming>SF1</bpmn:incoming><bpmn:outgoing>SF2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="S9"><bpmn:incoming>SF2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="SF1" sourceRef="S0" targetRef="Play"/>
    <bpmn:sequenceFlow id="SF2" sourceRef="Play" targetRef="S9"/>
  </bpmn:process>
  <bpmn:process id="R">
    <bpmn:extensionElements><studyflow:study runtime="local"/></bpmn:extensionElements>
    <bpmn:startEvent id="R0"><bpmn:outgoing>RF1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Greet" name="Greet"><bpmn:incoming>RF1</bpmn:incoming><bpmn:outgoing>RF2</bpmn:outgoing></bpmn:task>
    <bpmn:receiveTask id="Answer" name="Answer"><bpmn:incoming>RF2</bpmn:incoming><bpmn:outgoing>RF3</bpmn:outgoing></bpmn:receiveTask>
    <bpmn:endEvent id="R9"><bpmn:incoming>RF3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="RF1" sourceRef="R0" targetRef="Greet"/>
    <bpmn:sequenceFlow id="RF2" sourceRef="Greet" targetRef="Answer"/>
    <bpmn:sequenceFlow id="RF3" sourceRef="Answer" targetRef="R9"/>
  </bpmn:process>
</bpmn:definitions>`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-pools-'));
    fs.copyFileSync(RUN, path.join(dir, 'studyflow-run-local.py'));
    fs.writeFileSync(path.join(dir, 'plan.bpmn'), xml);
    const order = path.join(dir, 'order.log');
    // A runner that claims every task, takes a moment on each, and notes when each began and ended.
    fs.writeFileSync(path.join(dir, 'fake.py'), [
      'import json, sys, time',
      'plan, mode = sys.argv[1], sys.argv[2]',
      "if mode == '--claims': print(json.dumps(['Greet', 'Play', 'Answer']))",
      'else:',
      '    eid = sys.argv[3]',
      `    open(${JSON.stringify(order)}, 'a').write(f'start {eid} {time.monotonic()}\\n')`,
      '    time.sleep(0.8)',
      `    open(${JSON.stringify(order)}, 'a').write(f'end {eid} {time.monotonic()}\\n')`,
      "    handoff = sys.argv[5] + '/' + eid + '.state.json'",
      '    state = json.load(open(handoff))',
      "    json.dump({**state, 'result': eid, 'durationMs': 0}, open(handoff, 'w'))",
    ].join('\n'));
    execFileSync('uv', ['run', '--script', path.join(dir, 'studyflow-run-local.py'), 'plan.bpmn', '--repo', 'run', '--quiet',
      '--runner', `fake=python3 ${path.join(dir, 'fake.py')}`], { cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV } });

    const moments = new Map(fs.readFileSync(order, 'utf8').trim().split('\n').map((line) => {
      const [what, id, at] = line.split(' ');
      return [`${what} ${id}`, Number(at)] as const;
    }));
    // The task waited for the greeting; then it and the answering step ran together.
    expect(moments.get('start Play')!).toBeGreaterThanOrEqual(moments.get('end Greet')!);
    expect(moments.get('start Answer')!).toBeLessThan(moments.get('end Play')!);
    expect(moments.get('start Play')!).toBeLessThan(moments.get('end Answer')!);
  });
});
