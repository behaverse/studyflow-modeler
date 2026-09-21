import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { studyflowToXml } from '@core/document';
import { freshModdle } from '@tests/schemas';

const moddle = freshModdle();

/** The Python runner keeps `state` (docs/developers.qmd, "What a run leaves behind"): `_meta.prov` run records, `_meta.reached` visit counts. */

const RUN = path.resolve(__dirname, '../run.py');
const PROV = path.resolve(__dirname, '../../prov/prov.py');
const SHELL = path.resolve(__dirname, '../../shell/local.py');
const PYTHON = path.resolve(__dirname, '../../python/local.py');

function hasUv(): boolean {
  try {
    execFileSync('uv', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Every test here runs run.py through uv.
test.skip(!hasUv(), 'uv is not on PATH');

function archivedState(file: string): any {
  const xml = fs.readFileSync(file, 'utf8');
  const body = xml.match(/<studyflow:state>(.*?)<\/studyflow:state>/s)?.[1] ?? '{}';
  return JSON.parse(body.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}

test.describe('studyflow-run-local state', () => {
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
    expect(log).toMatch(/Split.*parallel/);
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
    expect([...log.matchAll(/drawn.*F_([AB])/g)].map((match) => match[1])).toEqual(['A', 'A', 'B', 'A']);
  });

  test('a failing step takes its error boundary event, and an error end event ends its sub-process at that one', async () => {
    // Discontinuation, drawn: the trial task fails, its boundary event leads to an error end event, and the
    // sub-process around it ends at its own error boundary instead of ending normally. The run itself is not failed.
    const xml = await studyflowToXml(`id: dropout
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Subject:
      type: SubProcess
      flowElements:
        S0:
          type: StartEvent
        Play:
          type: ServiceTask
          implementation: shell://false
        Missed:
          type: BoundaryEvent
          attachedToRef: Play
          eventDefinitions:
            Err_Missed:
              type: ErrorEventDefinition
        Discontinued:
          type: EndEvent
          name: Discontinued (n={reached})
          eventDefinitions:
            Err_Discontinued:
              type: ErrorEventDefinition
        Played:
          type: EndEvent
        EF0: S0 -> Play
        EF1: Play -> Played
        EF2: Missed -> Discontinued
    Dropped:
      type: BoundaryEvent
      attachedToRef: Subject
      eventDefinitions:
        Err_Dropped:
          type: ErrorEventDefinition
    Analysis:
      type: Task
    Completed:
      type: EndEvent
    F1: Start -> Subject
    F2: Subject -> Completed
    F3: Dropped -> Analysis
    F4: Analysis -> Completed
`, moddle);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-dropout-'));
    fs.copyFileSync(RUN, path.join(dir, 'run.py'));
    fs.writeFileSync(path.join(dir, 'dropout.bpmn'), xml);
    // `shell://false` is the shell skill's, and exits 1: a step that fails for a reason of its own.
    execFileSync('uv', ['run', '--script', path.join(dir, 'run.py'), path.join(dir, 'dropout.bpmn'), '--repo', path.join(dir, 'run'), '--quiet'], {
      cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV, STUDYFLOW_SHELL_PY: SHELL },
    });

    const reached = archivedState(path.join(dir, 'run', 'dropout.bpmn'))._meta.reached;
    // The walk went Play → Missed → Discontinued → Dropped → Analysis, and neither end event on the normal way was reached.
    expect(reached).toEqual({ Start: 1, Subject: 1, S0: 1, Play: 1, Missed: 1, Discontinued: 1, Dropped: 1, Analysis: 1, Completed: 1 });
    // The failure is kept where it happened, and the run is not failed by it.
    const log = fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8');
    expect(log).toMatch(/Play: RuntimeError/);
    expect(log).toMatch(/run.finished.*\(ok\)/);
  });

  // The other way off a finished step: a conditional boundary event, whose `condition` the walk reads once the
  // step's result is in. Quality control the study states itself, instead of a threshold attribute the notation invents.
  const RATES: [label: string, rate: string, reached: Record<string, number>][] = [
    ['above it, the boundary takes the walk on', '0.4', { Start: 1, Measure: 1, Noisy: 1, Excluded: 1 }],
    ['below it, the step\'s own flow carries on', '0.1', { Start: 1, Measure: 1, Completed: 1 }],
  ];
  for (const [label, rate, reached] of RATES) {
    test(`a conditional boundary event reads the finished step's result: ${label}`, async () => {
      const xml = await studyflowToXml(`id: quality
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Measure:
      type: ServiceTask
      implementation: python://builtins.dict
      additionalArguments:
        failedTrialRate: ${rate}
      dataOutputAssociations:
        Out_Quality:
          targetRef: Quality
    Quality:
      type: DataObjectReference
    Noisy:
      type: BoundaryEvent
      attachedToRef: Measure
      eventDefinitions:
        Cond_Noisy:
          type: ConditionalEventDefinition
          condition: "{Quality.failedTrialRate} > 0.2"
    Excluded:
      type: EndEvent
    Completed:
      type: EndEvent
    F1: Start -> Measure
    F2: Measure -> Completed
    F3: Noisy -> Excluded
`, moddle);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-quality-'));
      fs.copyFileSync(RUN, path.join(dir, 'run.py'));
      fs.writeFileSync(path.join(dir, 'quality.bpmn'), xml);
      // Exit 0 either way: a boundary event is a path, not a failure.
      execFileSync('uv', ['run', '--script', path.join(dir, 'run.py'), path.join(dir, 'quality.bpmn'), '--repo', path.join(dir, 'run'), '--quiet'], {
        cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV, STUDYFLOW_PYTHON_PY: PYTHON },
      });

      expect(archivedState(path.join(dir, 'run', 'quality.bpmn'))._meta.reached).toEqual(reached);
    });
  }

  // Three passes over the cohort, drawn two ways: BPMN's standard loop marker, and the multi-instance marker a
  // cohort of independent subjects carries (`loopCardinality` instances, which this runtime runs in order).
  const COHORT_MARKERS: [label: string, marker: string][] = [
    ['a standard loop marker, to its loopMaximum', 'type: StandardLoopCharacteristics\n        loopMaximum: 3'],
    ['a multi-instance marker, loopCardinality times', 'type: MultiInstanceLoopCharacteristics\n        loopCardinality: "3"'],
  ];
  for (const [label, marker] of COHORT_MARKERS) {
  test(`a sub-process repeats under ${label}, resets its scope each pass, and its random gateway draws again each pass and each run`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-subjects-'));
    fs.copyFileSync(RUN, path.join(dir, 'run.py'));
    // The cognitive skill beside the copy, so the walk reads its schema's `meta.branching`; it runs nothing itself.
    fs.mkdirSync(path.join(dir, 'skills', 'cognitive'), { recursive: true });
    for (const file of ['SKILL.md', 'cognitive.moddle.yaml']) {
      fs.copyFileSync(path.resolve(__dirname, '../../cognitive', file), path.join(dir, 'skills', 'cognitive', file));
    }
    const xml = await studyflowToXml(`id: subjects
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  extensionElements:
    - type: studyflow:Study
      seed: 15
  flowElements:
    Start:
      type: StartEvent
    Subject:
      type: SubProcess
      loopCharacteristics:
        ${marker}
      properties:
        P_Arm:
          name: arm
          value: none
      flowElements:
        S0:
          type: StartEvent
        Draw:
          type: ExclusiveGateway
          extensionElements:
            - type: cognitive:RandomGateway
        A:
          type: Task
        B:
          type: Task
        Check:
          type: Task
        E9:
          type: EndEvent
        EF_A: Draw -> A
        EF_B: Draw -> B
        EF0: S0 -> Draw
        EF1: A -> Check
        EF2: B -> Check
        EF3: Check -> E9
    Done:
      type: EndEvent
    F1: Start -> Subject
    F2: Subject -> Done
`, moddle);
    fs.writeFileSync(path.join(dir, 'subjects.bpmn'), xml);
    const seen = path.join(dir, 'seen.json');
    // One runner for Check: it records the property its scope holds on entry, then binds the property by its id,
    // the way a runner hands a data edge's value back (the python runner's shape).
    fs.writeFileSync(path.join(dir, 'fake.py'), [
      'import json, os, sys',
      'plan, mode = sys.argv[1], sys.argv[2]',
      "if mode == '--claims': print(json.dumps(['Check'])); sys.exit()",
      "handoff = os.path.join(sys.argv[5], sys.argv[3] + '.state.json')",
      'state = json.load(open(handoff))',
      `seen = json.load(open(${JSON.stringify(seen)})) if os.path.exists(${JSON.stringify(seen)}) else []`,
      "seen.append([state['state']['Subject']['arm'], state['state']['_meta']['instance']['Subject']])",
      `json.dump(seen, open(${JSON.stringify(seen)}, 'w'))`,
      "json.dump({**state, 'P_Arm': 'cautious', 'result': 1, 'durationMs': 0}, open(handoff, 'w'))",
    ].join('\n'));
    const run = (plan: string, ...args: string[]) => execFileSync('uv', ['run', '--script', path.join(dir, 'run.py'), plan, '--repo', path.join(dir, 'run'), '--quiet',
      ...args, '--runner', `fake=python3 ${path.join(dir, 'fake.py')}`], { cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV } });
    const drawn = () => [...fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8').matchAll(/drawn → EF_([AB])/g)].map((m) => m[1]);

    run(path.join(dir, 'subjects.bpmn'));
    // Three passes over the sub-process, three visits to every step inside it; the sub-process itself was reached once.
    expect(archivedState(path.join(dir, 'run', 'subjects.bpmn'))._meta.reached).toMatchObject({ Subject: 1, S0: 3, Draw: 3, Check: 3, E9: 3 });
    // A data edge into a declared property writes its scope's state, whoever bound it.
    expect(archivedState(path.join(dir, 'run', 'subjects.bpmn')).Subject).toEqual({ arm: 'cautious' });
    // A pass re-enters the scope, so a property with a `value` starts each pass at it, whatever the pass before wrote;
    // and `_meta.instance` says which pass it is, so a step inside knows which of three subjects it is serving.
    expect(JSON.parse(fs.readFileSync(seen, 'utf8'))).toEqual([['none', 1], ['none', 2], ['none', 3]]);
    // Seeded on the visit count, so the arms differ from pass to pass instead of repeating the first draw.
    expect(drawn()).toEqual(['A', 'B', 'A']);

    // The visit count is study-lifetime: the same study run again draws on from where it left off, rather than
    // drawing the first three arms a second time. (`--fresh`: a re-run otherwise replays each gateway's record.)
    run(path.join(dir, 'run', 'subjects.bpmn'), '--fresh');
    expect(drawn()).toEqual(['B', 'A', 'B']);
    expect(archivedState(path.join(dir, 'run', 'subjects.bpmn'))._meta.reached).toMatchObject({ Draw: 6, Check: 6 });
  });
  }

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

  test('--from a step redoes it and every step after it, and reuses the steps before it', async () => {
    const xml = await studyflowToXml(`id: again
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    W:
      type: Task
    A:
      type: Task
    B:
      type: Task
    Done:
      type: EndEvent
    F1: Start -> W
    F2: W -> A
    F3: A -> B
    F4: B -> Done
`, moddle);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-run-'));
    fs.copyFileSync(RUN, path.join(dir, 'run.py'));
    fs.writeFileSync(path.join(dir, 'again.bpmn'), xml);
    const repo = path.join(dir, 'run');
    const run = (plan: string, ...args: string[]) => execFileSync('uv', ['run', '--script', path.join(dir, 'run.py'), plan, '--quiet', ...args], {
      cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV },
    });
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    run(path.join(dir, 'again.bpmn'), '--repo', repo);
    // None of these steps leaves a file behind, so only their records can tell the re-run what the branch took away.
    const from = git('log', '--format=%h', '--grep=^executed A$');
    run(path.join(repo, 'again.bpmn'), '--from', from);
    expect(git('log', '--format=%s', `${from}^..HEAD`).split('\n')).toEqual(
      expect.arrayContaining(['skipped W (run run)', 'executed A', 'executed B']),
    );
  });

  test('re-runs the step whose drawing, or whose input file, has changed since its record', () => {
    // Raw XML: this needs `studyflow:uri` on a data object and `additionalArguments` on a task.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P">
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Read"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
      <bpmn:dataInputAssociation id="In_X"><bpmn:sourceRef>X</bpmn:sourceRef></bpmn:dataInputAssociation>
    </bpmn:task>
    <bpmn:dataObjectReference id="X" name="inputs" studyflow:uri="x.json"/>
    <bpmn:task id="Tune"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing>
      <studyflow:additionalArguments>speed: 20</studyflow:additionalArguments>
    </bpmn:task>
    <bpmn:endEvent id="E"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Read"/>
    <bpmn:sequenceFlow id="F2" sourceRef="Read" targetRef="Tune"/>
    <bpmn:sequenceFlow id="F3" sourceRef="Tune" targetRef="E"/>
  </bpmn:process>
</bpmn:definitions>`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-digest-'));
    const repo = path.join(dir, 'run');
    const stamped = path.join(repo, 'p.bpmn');
    fs.copyFileSync(RUN, path.join(dir, 'run.py'));
    fs.writeFileSync(path.join(dir, 'p.bpmn'), xml);
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    const run = (plan: string, ...args: string[]) => execFileSync('uv', ['run', '--script', path.join(dir, 'run.py'), plan, '--quiet', ...args], {
      cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV },
    });
    const since = (mark: string) => git('log', '--format=%s', `${mark}..HEAD`).split('\n');

    run(path.join(dir, 'p.bpmn'), '--repo', repo);
    fs.writeFileSync(path.join(repo, 'x.json'), '[1]');  // what a run reads lives in its repository
    run(stamped);  // the file arrived, so Read runs once more and records what it read

    let mark = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(repo, 'x.json'), '[1, 2]');
    run(stamped);
    expect(since(mark)).toEqual(expect.arrayContaining(['executed Read', 'skipped Tune (run run)']));

    mark = git('rev-parse', 'HEAD');
    fs.writeFileSync(stamped, fs.readFileSync(stamped, 'utf8').replace('speed: 20', 'speed: 40'));
    run(stamped);
    expect(since(mark)).toEqual(expect.arrayContaining(['executed Tune', 'skipped Read (run run)']));
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
    <bpmn:extensionElements><studyflow:study runtime="local" seed="7"><studyflow:dependencies>pandas>=2.0</studyflow:dependencies><studyflow:dependencies>joblib</studyflow:dependencies></studyflow:study></bpmn:extensionElements>
    <bpmn:participant id="Pool" name="Lab" processRef="P"><bpmn:extensionElements><cognitive:actor kind="robot"/></bpmn:extensionElements></bpmn:participant>
    <bpmn:participant id="Screen" name="Screen"/>
    <bpmn:messageFlow id="M1" sourceRef="T" targetRef="Screen" messageRef="Trial"/>
  </bpmn:collaboration>
  <bpmn:message id="Trial" itemRef="Trial_Item"/>
  <bpmn:itemDefinition id="Trial_Item" structureRef="behaverse:Trial"/>
  <bpmn:process id="P">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T" name="fit" implementation="python://m.f">
      <bpmn:extensionElements><cognitive:cognitiveTask platform="x"><cognitive:note>a</cognitive:note><cognitive:note>b</cognitive:note></cognitive:cognitiveTask></bpmn:extensionElements>
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
    expect(digest.study).toEqual({ id: 'C', name: 'Lab', seed: '7', dependencies: ['pandas>=2.0', 'joblib'] });
    expect(digest.sources.length).toBeGreaterThan(0);
    const task = digest.elements.T;
    expect(task.type).toBe('task');
    expect(task.attributes.implementation).toBe('python://m.f');
    expect(task.extensions).toEqual([{ namespace: 'http://behaverse.org/schemas/cognitive/v1', type: 'cognitiveTask', attributes: { platform: 'x', note: ['a', 'b'] } }]);
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

  // The robot's side of one exchange, drawn two ways: a loop that "over" ends at its boundary event, and a cycle an
  // event-based gateway leaves when "over" comes before the next trial. Either way `Stop` takes "over".
  const ROBOTS: [label: string, robot: string, reached: Record<string, number>][] = [
    ['a loop a message ends', `R:
  type: Process
  flowElements:
    R0: { type: StartEvent }
    Look: { type: ServiceTask }
    Ready: { type: IntermediateThrowEvent }
    Each:
      type: SubProcess
      loopCharacteristics: { type: StandardLoopCharacteristics }
      flowElements:
        E0: { type: StartEvent }
        Receive:
          type: ReceiveTask
          dataOutputAssociations: { Out_Seen: { targetRef: Seen } }
        Seen: { type: DataObjectReference }
        Ask:
          type: ServiceTask
          dataInputAssociations: { In_Seen: { sourceRef: [Seen] } }
          dataOutputAssociations: { Out_Choice: { targetRef: Choice, transformation: result.upper() } }
        Choice: { type: DataObjectReference }
        Answer:
          type: SendTask
          dataInputAssociations: { In_Choice: { sourceRef: [Choice] } }
        E9: { type: EndEvent }
        EF1: E0 -> Receive
        EF2: Receive -> Ask
        EF3: Ask -> Answer
        EF4: Answer -> E9
    Stop: { type: BoundaryEvent, attachedToRef: Each }
    R9: { type: EndEvent }
    RF0: R0 -> Look
    RF1: Look -> Ready
    RF2: Ready -> Each
    RF3: Stop -> R9
`, { Receive: 4 }], // a fourth wait, which "over" ended
    ['a cycle an event-based gateway leaves', `R:
  type: Process
  flowElements:
    R0: { type: StartEvent }
    Look: { type: ServiceTask }
    Ready: { type: IntermediateThrowEvent }
    Next: { type: EventBasedGateway }
    Receive:
      type: ReceiveTask
      dataOutputAssociations: { Out_Seen: { targetRef: Seen } }
    Seen: { type: DataObjectReference }
    Ask:
      type: ServiceTask
      dataInputAssociations: { In_Seen: { sourceRef: [Seen] } }
      dataOutputAssociations: { Out_Choice: { targetRef: Choice, transformation: result.upper() } }
    Choice: { type: DataObjectReference }
    Answer:
      type: SendTask
      dataInputAssociations: { In_Choice: { sourceRef: [Choice] } }
    Stop: { type: IntermediateCatchEvent }
    R9: { type: EndEvent }
    RF0: R0 -> Look
    RF1: Look -> Ready
    RF2: Ready -> Next
    RF3: Next -> Receive
    RF4: Receive -> Ask
    RF5: Ask -> Answer
    RF6: Answer -> Next
    RF7: Next -> Stop
    RF8: Stop -> R9
`, { Receive: 3, Next: 4 }], // "over" came first at the fourth visit
  ];

  for (const [label, robot, reachedToo] of ROBOTS) test(`carries the messages between pools: a runner mid-run, a pool a runner plays, ${label}`, async () => {
    // The screen waits for the robot's "ready", then its task (a runner) sends three trials mid-run. The robot takes
    // each, asks the model (a pool with no process, which a runner plays), and sends the answer back; the task's end
    // sends "over", which ends the robot's trials. Look asks the same model first: each answer goes back along the
    // flow to the step that asked.
    const xml = await studyflowToXml(`id: talk
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Screen: { name: Screen, processRef: S }
    Robot: { name: Robot, processRef: R }
    Model: { name: Model }
  messageFlows:
    M_Look: { sourceRef: Look, targetRef: Model }
    M_Seen: { sourceRef: Model, targetRef: Look }
    M_Ready: { sourceRef: Ready, targetRef: Seated }
    M_Trial: { sourceRef: Play, targetRef: Receive }
    M_Answer: { sourceRef: Answer, targetRef: Play }
    M_Ask: { sourceRef: Ask, targetRef: Model }
    M_Reply: { sourceRef: Model, targetRef: Ask }
    M_Over: { sourceRef: Over, targetRef: Stop }
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Seated: { type: IntermediateCatchEvent }
    Play: { type: Task }
    Over: { type: EndEvent }
    SF1: S0 -> Seated
    SF2: Seated -> Play
    SF3: Play -> Over
${robot}`, moddle);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-talk-'));
    fs.copyFileSync(RUN, path.join(dir, 'studyflow-run-local.py'));
    fs.writeFileSync(path.join(dir, 'plan.bpmn'), xml);
    const heard = path.join(dir, 'heard.json');
    // The task: each trial goes out through its outbox, and it waits in its inbox for the answer to that trial.
    fs.writeFileSync(path.join(dir, 'task.py'), [
      'import json, os, sys, time',
      'plan, mode = sys.argv[1], sys.argv[2]',
      "if mode == '--claims': print(json.dumps(['Play'])); sys.exit()",
      'eid, cache = sys.argv[3], sys.argv[5]',
      'answers = []',
      'for n in (1, 2, 3):',
      "    open(os.path.join(cache, eid + '.outbox.jsonl'), 'a').write(json.dumps({'flow': 'M_Trial', 'id': f't{n}', 'content': {'n': n}}) + '\\n')",
      '    deadline = time.monotonic() + 30',
      '    while not any(m.get("inReplyTo") == f"t{n}" for m in answers):',
      '        assert time.monotonic() < deadline, answers',
      "        inbox = os.path.join(cache, eid + '.inbox.jsonl')",
      '        answers = [json.loads(line) for line in open(inbox)] if os.path.exists(inbox) else []',
      '        time.sleep(0.05)',
      `open(${JSON.stringify(heard)}, 'w').write(json.dumps([m['content'] for m in answers]))`,
      "handoff = os.path.join(cache, eid + '.state.json')",
      "json.dump({**json.load(open(handoff)), 'result': 3, 'durationMs': 0}, open(handoff, 'w'))",
    ].join('\n'));
    // The model: one hand-off per message sent to its pool; its result is the answer.
    fs.writeFileSync(path.join(dir, 'model.py'), [
      'import json, os, sys',
      'plan, mode = sys.argv[1], sys.argv[2]',
      "if mode == '--claims': print(json.dumps(['Model'])); sys.exit()",
      "handoff = os.path.join(sys.argv[5], sys.argv[3] + '.state.json')",
      'state = json.load(open(handoff))',
      "content = state['message']['content'] or {'Seen': {'n': 0}}",
      "json.dump({**state, 'result': f\"answer {content['Seen']['n']}\", 'durationMs': 0}, open(handoff, 'w'))",
    ].join('\n'));
    execFileSync('uv', ['run', '--script', path.join(dir, 'studyflow-run-local.py'), 'plan.bpmn', '--repo', 'run', '--quiet',
      '--runner', `task=python3 ${path.join(dir, 'task.py')}`, '--runner', `model=python3 ${path.join(dir, 'model.py')}`],
    { cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV } });

    // Each answer is the send task's data input, narrowed by the edge from the model's reply, and answers its trial.
    expect(JSON.parse(fs.readFileSync(heard, 'utf8'))).toEqual([{ Choice: 'ANSWER 1' }, { Choice: 'ANSWER 2' }, { Choice: 'ANSWER 3' }]);
    // Three trials answered, and the walk went on from where "over" arrived.
    const reached = archivedState(path.join(dir, 'run', 'plan.bpmn'))._meta.reached;
    expect(reached).toMatchObject({ Look: 1, Ask: 3, Stop: 1, R9: 1, Over: 1, ...reachedToo });
  });

  test('a pool of two participant instances runs its process twice, one instance after another', async () => {
    // BPMN's `participantMultiplicity`: N instances of the pool's process. They run serially here, as a
    // multi-instance activity's passes do, and the model pool answers each instance in turn.
    const xml = await studyflowToXml(`id: cohort
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 2
      processRef: S
    Model: { name: Model }
  messageFlows:
    M_Ask: { sourceRef: Ask, targetRef: Model }
    M_Reply: { sourceRef: Model, targetRef: Ask }
S:
  type: Process
  properties:
    P_Seen:
      name: seen
      value: none
  flowElements:
    S0: { type: StartEvent }
    Ask:
      type: Task
      dataOutputAssociations: { Out_Seen: { targetRef: P_Seen } }
    S9: { type: EndEvent }
    SF1: S0 -> Ask
    SF2: Ask -> S9
`, moddle);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-cohort-'));
    fs.copyFileSync(RUN, path.join(dir, 'studyflow-run-local.py'));
    fs.writeFileSync(path.join(dir, 'plan.bpmn'), xml);
    const asked = path.join(dir, 'asked.json');
    // The model: one hand-off per message, answering with the instance it is serving; it also records the
    // pool's own scope as it finds it, which a fresh instance must have put back to its declared value.
    fs.writeFileSync(path.join(dir, 'model.py'), [
      'import json, os, sys',
      'plan, mode = sys.argv[1], sys.argv[2]',
      "if mode == '--claims': print(json.dumps(['Model'])); sys.exit()",
      "handoff = os.path.join(sys.argv[5], sys.argv[3] + '.state.json')",
      'state = json.load(open(handoff))',
      "instance = state['state']['_meta']['instance']['Subjects']",
      `seen = json.load(open(${JSON.stringify(asked)})) if os.path.exists(${JSON.stringify(asked)}) else []`,
      "seen.append([instance, state['state']['S']['seen']])",
      `json.dump(seen, open(${JSON.stringify(asked)}, 'w'))`,
      "json.dump({**state, 'result': f'answer {instance}', 'durationMs': 0}, open(handoff, 'w'))",
    ].join('\n'));
    execFileSync('uv', ['run', '--script', path.join(dir, 'studyflow-run-local.py'), 'plan.bpmn', '--repo', 'run', '--quiet',
      '--runner', `model=python3 ${path.join(dir, 'model.py')}`],
    { cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV } });

    // Asked twice, once per instance: `_meta.instance.<pool id>` says which, and each instance re-enters the
    // pool's scope, so `seen` starts at its declared value again instead of carrying the first answer over.
    expect(JSON.parse(fs.readFileSync(asked, 'utf8'))).toEqual([[1, 'none'], [2, 'none']]);
    // Every step inside was visited once per instance, and the walk kept counting across them.
    expect(archivedState(path.join(dir, 'run', 'plan.bpmn'))._meta.reached).toMatchObject({ S0: 2, Ask: 2, S9: 2 });
  });

  test('a step inside a sub-process talks along the sub-process\'s message flows', async () => {
    // A collapsed sub-process is the only place BPMN can draw a message flow to a step inside it, so the study draws
    // the exchange on the cohort and the task inside it is what talks: out along the sub-process's flow, back in.
    // The sub-process is divided into a lane too (BPMN allows a lane set on any FlowElementsContainer): the walk
    // and the plan digest see through it, as they do through a pool's lanes.
    const xml = await studyflowToXml(`id: nested
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Screen: { name: Screen, processRef: S }
    Model: { name: Model }
  messageFlows:
    M_Trial: { sourceRef: Subject, targetRef: Model }
    M_Answer: { sourceRef: Model, targetRef: Subject }
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Subject:
      type: SubProcess
      dataOutputAssociations:
        Out_Trials: { targetRef: Trials }
      laneSets:
        LaneSet_Subject:
          lanes:
            Lane_Screen: { name: Screen, flowNodeRef: [Play] }
      flowElements:
        E0: { type: StartEvent }
        Play: { type: Task }
        E9: { type: EndEvent }
        EF0: E0 -> Play
        EF1: Play -> E9
    Trials:
      type: DataObjectReference
      uri: trials.jsonl
    Done: { type: EndEvent }
    SF1: S0 -> Subject
    SF2: Subject -> Done
`, moddle);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-nested-talk-'));
    fs.copyFileSync(RUN, path.join(dir, 'studyflow-run-local.py'));
    fs.writeFileSync(path.join(dir, 'plan.bpmn'), xml);
    const heard = path.join(dir, 'heard.json');
    fs.writeFileSync(path.join(dir, 'task.py'), [
      'import json, os, sys, time',
      'plan, mode = sys.argv[1], sys.argv[2]',
      "if mode == '--claims': print(json.dumps(['Play'])); sys.exit()",
      'eid, cache = sys.argv[3], sys.argv[5]',
      "open(os.path.join(cache, eid + '.outbox.jsonl'), 'a').write(json.dumps({'flow': 'M_Trial', 'id': 't1', 'content': {'n': 1}}) + '\\n')",
      'answers, deadline = [], time.monotonic() + 30',
      "while not answers:",
      '    assert time.monotonic() < deadline',
      "    inbox = os.path.join(cache, eid + '.inbox.jsonl')",
      '    answers = [json.loads(line) for line in open(inbox)] if os.path.exists(inbox) else []',
      '    time.sleep(0.05)',
      `open(${JSON.stringify(heard)}, 'w').write(json.dumps(answers))`,
      "open(os.path.join(cache, '..', 'trials.jsonl'), 'w').write('{}')",
      "handoff = os.path.join(cache, eid + '.state.json')",
      "json.dump({**json.load(open(handoff)), 'result': 1, 'durationMs': 0}, open(handoff, 'w'))",
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'model.py'), [
      'import json, os, sys',
      'plan, mode = sys.argv[1], sys.argv[2]',
      "if mode == '--claims': print(json.dumps(['Model'])); sys.exit()",
      "handoff = os.path.join(sys.argv[5], sys.argv[3] + '.state.json')",
      'state = json.load(open(handoff))',
      `json.dump({**state, 'result': f"saw {state['message']['content']['n']}", 'durationMs': 0}, open(handoff, 'w'))`,
    ].join('\n'));
    execFileSync('uv', ['run', '--script', path.join(dir, 'studyflow-run-local.py'), 'plan.bpmn', '--repo', 'run', '--quiet',
      '--runner', `task=python3 ${path.join(dir, 'task.py')}`, '--runner', `model=python3 ${path.join(dir, 'model.py')}`],
    { cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV } });

    // The trial left along the sub-process's flow, and the model's answer came back into the task that sent it.
    expect(JSON.parse(fs.readFileSync(heard, 'utf8'))).toMatchObject([{ flow: 'M_Answer', content: 'saw 1', inReplyTo: 't1' }]);
    expect(archivedState(path.join(dir, 'run', 'plan.bpmn'))._meta.reached).toMatchObject({ Play: 1, Done: 1 });
    // The dataset the steps inside filled is the sub-process's own data edge, so the sub-process generated it.
    expect(fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8')).toMatch(/save trials\.jsonl/);
  });

  test('a step inside a pool talks along the pool\'s message flows', async () => {
    // A pool\'s message flows belong to everything drawn in it, so a study that draws one exchange on the pool has
    // the step inside doing the talking: out along the pool\'s flow, back in. The pool is divided into a lane, which
    // the walk reads through, and the step draws no flow of its own.
    const xml = await studyflowToXml(`id: pooled
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Cohort: { name: Cohort, processRef: S }
    Model: { name: Model }
  messageFlows:
    M_Trial: { sourceRef: Cohort, targetRef: Model }
    M_Answer: { sourceRef: Model, targetRef: Cohort }
S:
  type: Process
  laneSets:
    LaneSet_S:
      lanes:
        Lane_Screen:
          name: Screen
          flowNodeRef: [Play]
  flowElements:
    S0: { type: StartEvent }
    Play: { type: Task }
    S9: { type: EndEvent }
    SF1: S0 -> Play
    SF2: Play -> S9
`, moddle);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-pool-talk-'));
    fs.copyFileSync(RUN, path.join(dir, 'studyflow-run-local.py'));
    fs.writeFileSync(path.join(dir, 'plan.bpmn'), xml);
    const heard = path.join(dir, 'heard.json');
    fs.writeFileSync(path.join(dir, 'task.py'), [
      'import json, os, sys, time',
      'plan, mode = sys.argv[1], sys.argv[2]',
      "if mode == '--claims': print(json.dumps(['Play'])); sys.exit()",
      'eid, cache = sys.argv[3], sys.argv[5]',
      "open(os.path.join(cache, eid + '.outbox.jsonl'), 'a').write(json.dumps({'flow': 'M_Trial', 'id': 't1', 'content': {'n': 1}}) + '\\n')",
      'answers, deadline = [], time.monotonic() + 30',
      'while not answers:',
      '    assert time.monotonic() < deadline',
      "    inbox = os.path.join(cache, eid + '.inbox.jsonl')",
      '    answers = [json.loads(line) for line in open(inbox)] if os.path.exists(inbox) else []',
      '    time.sleep(0.05)',
      `open(${JSON.stringify(heard)}, 'w').write(json.dumps(answers))`,
      "handoff = os.path.join(cache, eid + '.state.json')",
      "json.dump({**json.load(open(handoff)), 'result': 1, 'durationMs': 0}, open(handoff, 'w'))",
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'model.py'), [
      'import json, os, sys',
      'plan, mode = sys.argv[1], sys.argv[2]',
      "if mode == '--claims': print(json.dumps(['Model'])); sys.exit()",
      "handoff = os.path.join(sys.argv[5], sys.argv[3] + '.state.json')",
      'state = json.load(open(handoff))',
      `json.dump({**state, 'result': f"saw {state['message']['content']['n']}", 'durationMs': 0}, open(handoff, 'w'))`,
    ].join('\n'));
    execFileSync('uv', ['run', '--script', path.join(dir, 'studyflow-run-local.py'), 'plan.bpmn', '--repo', 'run', '--quiet',
      '--runner', `task=python3 ${path.join(dir, 'task.py')}`, '--runner', `model=python3 ${path.join(dir, 'model.py')}`],
    { cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV } });

    // The trial left along the pool's flow, and the model's answer came back into the step that sent it.
    expect(JSON.parse(fs.readFileSync(heard, 'utf8'))).toMatchObject([{ flow: 'M_Answer', content: 'saw 1', inReplyTo: 't1' }]);
    expect(archivedState(path.join(dir, 'run', 'plan.bpmn'))._meta.reached).toMatchObject({ Play: 1, S9: 1 });
  });

  test('a pool of many instances sends its outgoing message once, after the last instance', async () => {
    // The whole pool is one sender: the flow out of the participant is the cohort's own, not each instance's, so the
    // analysis pool's message start event ("All subjects complete") starts once, when the third subject is done.
    const xml = await studyflowToXml(`id: allsubjects
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 3
      processRef: S
    Analysis: { name: Analysis, processRef: A }
  messageFlows:
    M_Done: { sourceRef: Subjects, targetRef: A0 }
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Play: { type: Task }
    S9: { type: EndEvent }
    SF1: S0 -> Play
    SF2: Play -> S9
A:
  type: Process
  flowElements:
    A0: { type: StartEvent, name: All subjects complete }
    Analyze: { type: Task }
    A9: { type: EndEvent }
    AF1: A0 -> Analyze
    AF2: Analyze -> A9
`, moddle);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-all-done-'));
    fs.copyFileSync(RUN, path.join(dir, 'studyflow-run-local.py'));
    fs.writeFileSync(path.join(dir, 'plan.bpmn'), xml);
    const analysed = path.join(dir, 'analysed.json');
    // The analysis step records what it found when it ran: which instance the cohort reached, and the visit counts.
    fs.writeFileSync(path.join(dir, 'analysis.py'), [
      'import json, os, sys',
      'plan, mode = sys.argv[1], sys.argv[2]',
      "if mode == '--claims': print(json.dumps(['Analyze'])); sys.exit()",
      "handoff = os.path.join(sys.argv[5], sys.argv[3] + '.state.json')",
      'state = json.load(open(handoff))',
      `seen = json.load(open(${JSON.stringify(analysed)})) if os.path.exists(${JSON.stringify(analysed)}) else []`,
      "seen.append([state['state']['_meta']['instance']['Subjects'], state['state']['_meta']['reached']])",
      `json.dump(seen, open(${JSON.stringify(analysed)}, 'w'))`,
      "json.dump({**state, 'result': 'ok', 'durationMs': 0}, open(handoff, 'w'))",
    ].join('\n'));
    execFileSync('uv', ['run', '--script', path.join(dir, 'studyflow-run-local.py'), 'plan.bpmn', '--repo', 'run', '--quiet',
      '--runner', `analysis=python3 ${path.join(dir, 'analysis.py')}`],
    { cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV } });

    // Once, and only after the cohort's third instance ran every step: the analysis pool waited on the message
    // instead of failing as a wait with nothing left to send it while the sender's instances were still running.
    expect(JSON.parse(fs.readFileSync(analysed, 'utf8'))).toEqual([[3, { S0: 3, Play: 3, S9: 3, A0: 1, Analyze: 1 }]]);
    expect(archivedState(path.join(dir, 'run', 'plan.bpmn'))._meta.reached).toEqual({ S0: 3, Play: 3, S9: 3, A0: 1, Analyze: 1, A9: 1 });
  });

  test('records a staged input under the hand-off that reads it, not one running beside it', async () => {
    // Two pools at once: Load cites the input by name and its runner stages it; Wait reads nothing and outlasts Load.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="A">
    <bpmn:startEvent id="A0"><bpmn:outgoing>AF1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Wait"><bpmn:incoming>AF1</bpmn:incoming><bpmn:outgoing>AF2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="A9"><bpmn:incoming>AF2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="AF1" sourceRef="A0" targetRef="Wait"/>
    <bpmn:sequenceFlow id="AF2" sourceRef="Wait" targetRef="A9"/>
  </bpmn:process>
  <bpmn:process id="B">
    <bpmn:startEvent id="B0"><bpmn:outgoing>BF1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Load"><bpmn:incoming>BF1</bpmn:incoming><bpmn:outgoing>BF2</bpmn:outgoing>
      <studyflow:additionalArguments>data: "{inputs}"</studyflow:additionalArguments>
    </bpmn:task>
    <bpmn:dataObjectReference id="X" name="inputs" studyflow:uri="x.json"/>
    <bpmn:endEvent id="B9"><bpmn:incoming>BF2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="BF1" sourceRef="B0" targetRef="Load"/>
    <bpmn:sequenceFlow id="BF2" sourceRef="Load" targetRef="B9"/>
  </bpmn:process>
</bpmn:definitions>`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-staged-'));
    fs.copyFileSync(RUN, path.join(dir, 'studyflow-run-local.py'));
    fs.writeFileSync(path.join(dir, 'plan.bpmn'), xml);
    fs.writeFileSync(path.join(dir, 'x.json'), '[]');
    // A runner that stages x.json from the plan's first source while running Load, and only waits while running Wait.
    fs.writeFileSync(path.join(dir, 'fake.py'), [
      'import json, os, shutil, sys, time',
      'plan, mode = sys.argv[1], sys.argv[2]',
      "if mode == '--claims': print(json.dumps(['Wait', 'Load']))",
      'else:',
      '    eid, cache = sys.argv[3], sys.argv[5]',
      "    time.sleep(0.2 if eid == 'Load' else 0.8)",
      "    if eid == 'Load':",
      "        shutil.copyfile(os.path.join(json.load(open(plan))['sources'][0], 'x.json'), os.path.join(os.path.dirname(cache), 'x.json'))",
      "    handoff = os.path.join(cache, eid + '.state.json')",
      '    state = json.load(open(handoff))',
      "    json.dump({**state, 'result': eid, 'durationMs': 0}, open(handoff, 'w'))",
    ].join('\n'));
    execFileSync('uv', ['run', '--script', path.join(dir, 'studyflow-run-local.py'), 'plan.bpmn', '--repo', 'run', '--quiet',
      '--runner', `fake=python3 ${path.join(dir, 'fake.py')}`], { cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV } });

    const log = fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8');
    expect(log.match(/stage x\.json/g)).toHaveLength(1);
  });

  test('restores an output the worktree lost from the commit that made it, rather than redoing the step', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P">
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Make"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
      <bpmn:dataOutputAssociation id="Out_Y"><bpmn:targetRef>Y</bpmn:targetRef></bpmn:dataOutputAssociation>
    </bpmn:task>
    <bpmn:dataObjectReference id="Y" name="result" studyflow:uri="out.json"/>
    <bpmn:endEvent id="E"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Make"/>
    <bpmn:sequenceFlow id="F2" sourceRef="Make" targetRef="E"/>
  </bpmn:process>
</bpmn:definitions>`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-restore-'));
    fs.copyFileSync(RUN, path.join(dir, 'run.py'));
    fs.writeFileSync(path.join(dir, 'p.bpmn'), xml);
    // A replayable runner (`live: false`), so the second run may skip what the first one made.
    fs.writeFileSync(path.join(dir, 'fake.py'), [
      'import json, os, sys',
      'mode = sys.argv[2]',
      "if mode == '--claims': print(json.dumps({'elements': ['Make'], 'live': False}))",
      'else:',
      '    eid, cache = sys.argv[3], sys.argv[5]',
      "    open(os.path.join(os.path.dirname(cache), 'out.json'), 'w').write('{\"made\": 1}')",
      "    handoff = os.path.join(cache, eid + '.state.json')",
      '    state = json.load(open(handoff))',
      "    json.dump({**state, 'result': eid, 'durationMs': 0}, open(handoff, 'w'))",
    ].join('\n'));
    const run = (plan: string, ...args: string[]) => execFileSync('uv', ['run', '--script', path.join(dir, 'run.py'), plan, '--quiet',
      '--runner', `fake=python3 ${path.join(dir, 'fake.py')}`, ...args], {
      cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV },
    });
    run(path.join(dir, 'p.bpmn'), '--repo', 'run');
    const made = path.join(dir, 'run', 'out.json');
    fs.rmSync(made);
    run(path.join(dir, 'run', 'p.bpmn'));

    const log = fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8');
    expect(fs.readFileSync(made, 'utf8')).toBe('{"made": 1}');
    expect(log).toContain('restore out.json');
    expect(log).toContain('↻ Make');  // restored, not redone
  });

  test('hands a step the read-only properties its sub-process takes from wired Parameters, and refuses a write to one', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P">
    <bpmn:startEvent id="S"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:subProcess id="Block"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
      <bpmn:dataInputAssociation id="In_Knobs"><bpmn:sourceRef>Knobs</bpmn:sourceRef></bpmn:dataInputAssociation>
      <bpmn:startEvent id="S1"><bpmn:outgoing>G1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:task id="T"><bpmn:incoming>G1</bpmn:incoming><bpmn:outgoing>G2</bpmn:outgoing></bpmn:task>
      <bpmn:endEvent id="E1"><bpmn:incoming>G2</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="G1" sourceRef="S1" targetRef="T"/>
      <bpmn:sequenceFlow id="G2" sourceRef="T" targetRef="E1"/>
    </bpmn:subProcess>
    <bpmn:dataObjectReference id="Knobs"><bpmn:extensionElements><studyflow:parameters><studyflow:values>speed: 20</studyflow:values></studyflow:parameters></bpmn:extensionElements></bpmn:dataObjectReference>
    <bpmn:endEvent id="E"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="Block"/>
    <bpmn:sequenceFlow id="F2" sourceRef="Block" targetRef="E"/>
  </bpmn:process>
</bpmn:definitions>`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-readonly-'));
    fs.copyFileSync(RUN, path.join(dir, 'studyflow-run-local.py'));
    fs.writeFileSync(path.join(dir, 'plan.bpmn'), xml);
    // A runner for T that finds `speed` in its sub-process's scope, then writes it.
    fs.writeFileSync(path.join(dir, 'fake.py'), [
      'import json, sys',
      'plan, mode = sys.argv[1], sys.argv[2]',
      "if mode == '--claims': print(json.dumps(['T']))",
      'else:',
      "    handoff = sys.argv[5] + '/T.state.json'",
      '    state = json.load(open(handoff))',
      "    assert state['state']['Block'] == {'speed': 20}, state['state']",
      "    state['state']['Block']['speed'] = 5",
      "    json.dump({**state, 'result': 1, 'durationMs': 0}, open(handoff, 'w'))",
    ].join('\n'));
    expect(() => execFileSync('uv', ['run', '--script', path.join(dir, 'studyflow-run-local.py'), 'plan.bpmn', '--repo', 'run', '--quiet',
      '--runner', `fake=python3 ${path.join(dir, 'fake.py')}`], { cwd: dir, stdio: 'pipe', env: { ...process.env, STUDYFLOW_PROV_PY: PROV } })).toThrow();
    expect(fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8'))
      .toMatch(/T writes speed.*Block/);
  });
});

/** `studyflow run` hands run.py a YAML or PNG study as a temporary `.bpmn`, and tells it where the original lives
 * and how to keep it. */

test.describe('studyflow run on a converted study', () => {
  test.skip(!hasUv(), 'uv is not on PATH');

  test('stages a boundary input from beside the YAML file, run from another folder, and keeps the study as YAML', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-inputs-'));
    // The CLI reads its schemas through Vite (`import.meta.glob`), so it is built here rather than imported.
    execFileSync(process.execPath, [path.join(process.cwd(), 'node_modules/vite/bin/vite.js'), 'build', 'packages/cli', '--outDir', path.join(dir, 'bin'), '--logLevel', 'error']);
    fs.copyFileSync(RUN, path.join(dir, 'run.py'));
    fs.mkdirSync(path.join(dir, 'study'));
    fs.mkdirSync(path.join(dir, 'elsewhere'));
    fs.writeFileSync(path.join(dir, 'study', 'counts.json'), '[1, 2, 3]');
    fs.writeFileSync(path.join(dir, 'study', 'dump.studyflow.yaml'), `id: inputs
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Dump:
      type: ServiceTask
      implementation: python://json.dumps
      dataInputAssociations:
        In:
          sourceRef:
            - counts
          transformation: obj
    counts:
      type: DataObjectReference
      uri: counts.json
    Done:
      type: EndEvent
    F1: Start -> Dump
    F2: Dump -> Done
`);
    // The copy of run.py finds no skill beside it, so the python skill's runner, which stages `counts.json`, is named.
    const studyflow = (...args: string[]) => execFileSync(process.execPath, [path.join(dir, 'bin', 'studyflow.mjs'), 'run', ...args, '--quiet'], {
      cwd: path.join(dir, 'elsewhere'),
      stdio: 'pipe',
      env: { ...process.env, STUDYFLOW_RUN_PY: path.join(dir, 'run.py'), STUDYFLOW_PROV_PY: PROV, STUDYFLOW_PYTHON_PY: path.resolve(__dirname, '../../python/local.py') },
    });
    studyflow(path.join(dir, 'study', 'dump.studyflow.yaml'), '--repo', path.join(dir, 'run'));
    expect(fs.readFileSync(path.join(dir, 'run', 'counts.json'), 'utf8')).toBe('[1, 2, 3]');
    // The run repository keeps the study as it came, YAML under the original's name, with the input the python
    // runner staged recorded on it.
    const kept = path.join(dir, 'run', 'dump.studyflow.yaml');
    const counts = (yaml.load(fs.readFileSync(kept, 'utf8')) as any).S.flowElements.counts;
    expect(counts.type).toBe('DataObjectReference');
    expect(counts.extensionElements).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'prov:Activity', action: 'imported' })]));
    // Run again from there, the study runs on in that repository.
    studyflow(kept);
    const log = execFileSync('git', ['-C', path.join(dir, 'run'), 'log', '--format=%s'], { encoding: 'utf8' });
    expect(log).toMatch(/^finished[\s\S]*^finished/m);
    // Nothing changed, so the step is reused: the BPMN kept beside the YAML is what the commit in its record
    // is read back as, and the round trip through YAML leaves the element it compares the same.
    expect(log).toContain('skipped Dump (run run)');
  });
});
