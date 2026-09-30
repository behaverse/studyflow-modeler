import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { studyflowToXml } from '@core/document';
import { stateOf } from '@core/engine';
import { freshModdle } from '@tests/schemas';

const moddle = freshModdle();

/** The local runtime (skills/local/src): what a run leaves in its repository, what a re-run reuses of it, and the
 * hand-off to partial runners. How the study is walked is pinned by packages/core/tests/engine.unit.spec.ts. */

/** The CLI, built once per worker: `studyflow run` hosts the local runtime. No shipped skill is beside this copy, so
 * a test names the runners it needs (`--runner`, `STUDYFLOW_<NAME>_PY`). */
const BIN = (() => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-cli-'));
  execFileSync(process.execPath, [path.join(process.cwd(), 'node_modules/vite/bin/vite.js'), 'build', 'packages/cli', '--outDir', out, '--logLevel', 'error']);
  return path.join(out, 'studyflow.mjs');
})();
// No skill is beside the built copy either, so a runner is told where the SDK is.
const ENV = { ...process.env, STUDYFLOW_HOME: path.dirname(BIN), STUDYFLOW_LOCAL: path.resolve(__dirname, '..') };
const PYTHON = path.resolve(__dirname, '../../python/local.py');

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

/**
 * Flow conservation over a finished run's counts: each flow node is reached as often as its incoming sequence flows
 * were taken (a start or boundary event is entered otherwise), and left as often as its outgoing flows and boundary
 * events were (an end event is left by none). The nodes it fails for.
 */
async function unconserved(xml: string, reached: Record<string, number>): Promise<string[]> {
  const { rootElement } = await moddle.fromXML(xml);
  const all: any[] = [];
  const collect = (container: any): void => {
    for (const element of container.flowElements ?? []) {
      all.push(element);
      collect(element);
    }
  };
  rootElement.rootElements.forEach(collect);
  const taken = (elements: any[]) => elements.reduce((sum, element) => sum + (reached[element.id] ?? 0), 0);
  const flows = all.filter((element) => element.$type === 'bpmn:SequenceFlow');
  return all.filter((element) => element.$instanceOf('bpmn:FlowNode')).flatMap((node) => {
    const into = taken(flows.filter((flow) => flow.targetRef === node));
    const out = taken(flows.filter((flow) => flow.sourceRef === node)) + taken(all.filter((event) => event.attachedToRef === node));
    return [
      ...(['bpmn:StartEvent', 'bpmn:BoundaryEvent'].includes(node.$type) || taken([node]) === into ? [] : [`${node.id} in`]),
      ...(node.$type === 'bpmn:EndEvent' || taken([node]) === out ? [] : [`${node.id} out`]),
    ];
  });
}

test.describe('the state a run keeps', () => {
  test('appends _meta.prov and counts reaches; a re-run counts again from where the run it redoes started', async () => {
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
    const plan = path.join(dir, 'reach.bpmn');
    fs.writeFileSync(plan, xml);
    const run = (file: string) =>
      execFileSync(process.execPath, [BIN, 'run', file, '--repo', path.join(dir, 'run'), '--quiet'], {
        cwd: dir, stdio: 'pipe', env: ENV,
      });

    run(plan);
    const archived = path.join(dir, 'run', 'reach.bpmn');
    const first = archivedState(archived);
    expect(first._meta.prov).toHaveLength(1);
    expect(first._meta.prov[0]).toMatchObject({ action: 'executed', run: 'run', with: expect.stringMatching(/^studyflow-cli\//) });
    // A sequence flow counts as it is taken, the way a node counts its visits.
    expect(first._meta.reached).toEqual({ Start: 1, F1: 1, Done: 1 });
    expect(first.S.runs).toBe(0);
    expect(first.Done).toEqual({ count: 0 });

    run(archived);
    const second = archivedState(archived);
    expect(second._meta.prov).toHaveLength(2);
    expect(second._meta.reached).toEqual({ Start: 1, F1: 1, Done: 1 });
    // `events.jsonl`, the record, holds both runs' events, and the state the study keeps is read off them.
    const events = fs.readFileSync(path.join(dir, 'run', 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(events.filter((event) => event.event === 'started')).toHaveLength(2);
    expect(stateOf(events)).toEqual(second);
  });

  test('a re-run of several subjects draws the arms the run it redoes drew', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-arms-'));
    fs.writeFileSync(path.join(dir, 'arms.studyflow.yaml'), `id: arms
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  extensionElements:
    - type: studyflow:Study
      seed: "7"
  participants:
    Subject: { name: Each subject, participantMultiplicity: { maximum: 4 }, processRef: P }
P:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Arm:
      type: ExclusiveGateway
      extensionElements:
        - type: cognitive:RandomGateway
          algorithm: block
          allocationRatio: "1:1"
      default: To_B
    A: { type: EndEvent }
    B: { type: EndEvent }
    F0: Start -> Arm
    To_A: Arm -> A
    To_B: Arm -> B
`);
    const arms = (file: string): string[] => {
      execFileSync(process.execPath, [BIN, 'run', file, '--repo', path.join(dir, 'run'), '--quiet'], { cwd: dir, stdio: 'pipe', env: ENV });
      return [...fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8').matchAll(/→ (To_[AB])/g)].map((match) => match[1]);
    };
    const first = arms('arms.studyflow.yaml');
    expect(first).toHaveLength(4);
    // Each participant draws for itself, so a re-run draws the same four arms.
    expect(arms(path.join(dir, 'run', 'arms.studyflow.yaml'))).toEqual(first);
  });
});

test.describe('a re-run', () => {
  test('counts each sequence flow it takes, so a node is reached as often as its flows bring it in and take it out', async () => {
    // A gateway that loops back twice, a step that leaves at its boundary event the second time, and a default flow
    // never taken. Run again from its record, the gateway replays its decision, and that flow counts too.
    const xml = await studyflowToXml(`id: conserve
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Gate:
      type: ExclusiveGateway
      default: F_Skip
    Try:
      type: Task
    Enough:
      type: BoundaryEvent
      attachedToRef: Try
      eventDefinitions:
        Cond_Enough:
          type: ConditionalEventDefinition
          condition: state._meta.reached.Try >= 2
    Out:
      type: EndEvent
    Skipped:
      type: EndEvent
    F1: Start -> Gate
    F_Try:
      type: SequenceFlow
      sourceRef: Gate
      targetRef: Try
      conditionExpression: state._meta.reached.Gate < 3
    F_Skip: Gate -> Skipped
    F_Back: Try -> Gate
    F_Out: Enough -> Out
`, moddle);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-conserve-'));
    fs.writeFileSync(path.join(dir, 'conserve.bpmn'), xml);
    const archived = path.join(dir, 'run', 'conserve.bpmn');
    const run = (plan: string, ...args: string[]) => execFileSync(process.execPath, [BIN, 'run', plan, '--repo', path.join(dir, 'run'), '--quiet', ...args], {
      cwd: dir, stdio: 'pipe', env: ENV,
    });

    run(path.join(dir, 'conserve.bpmn'));
    expect(archivedState(archived)._meta.reached).toEqual({ Start: 1, F1: 1, Gate: 2, F_Try: 2, Try: 2, F_Back: 1, Enough: 1, F_Out: 1, Out: 1 });
    expect(await unconserved(xml, archivedState(archived)._meta.reached)).toEqual([]);

    run(archived);
    expect(fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8')).toContain('↻ Gate → F_Try');
    expect(await unconserved(xml, archivedState(archived)._meta.reached)).toEqual([]);

    // `--fresh` ignores the records: the gateway decides again.
    run(archived, '--fresh');
    expect(fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8')).not.toContain('↻');
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
    fs.writeFileSync(path.join(dir, 'again.bpmn'), xml);
    const repo = path.join(dir, 'run');
    const run = (plan: string, ...args: string[]) => execFileSync(process.execPath, [BIN, 'run', plan, '--quiet', ...args], {
      cwd: dir, stdio: 'pipe', env: ENV,
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
    fs.writeFileSync(path.join(dir, 'p.bpmn'), xml);
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    const run = (plan: string, ...args: string[]) => execFileSync(process.execPath, [BIN, 'run', plan, '--quiet', ...args], {
      cwd: dir, stdio: 'pipe', env: ENV,
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

/** The contract with partial runners (skills/local/SKILL.md), spoken here by runners written with its SDK. */

/** A runner at `file`: what it claims (Python, of `plan`), and the body of its `execute(step)`. */
function writeRunner(file: string, claims: string, body: string[]): void {
  fs.writeFileSync(file, [
    'import json, os, shutil, sys, time',
    "sys.path.insert(0, os.environ['STUDYFLOW_LOCAL'])",
    'from runner import serve',
    'def execute(step):',
    ...body.map((line) => `    ${line}`),
    `serve(lambda plan: ${claims}, execute)`,
  ].join('\n'));
}

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

  test('stops a hand-off that outlasts --step-timeout, and fails its step', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-timeout-'));
    fs.writeFileSync(path.join(dir, 'plan.bpmn'), `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P">
    <bpmn:startEvent id="Start"/>
    <bpmn:task id="Slow"/>
    <bpmn:endEvent id="Done"/>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Slow"/>
    <bpmn:sequenceFlow id="F2" sourceRef="Slow" targetRef="Done"/>
  </bpmn:process>
</bpmn:definitions>`);
    // A runner that does not heed `cancel`: its process is ended.
    writeRunner(path.join(dir, 'slow.py'), "['Slow']", ['time.sleep(30)']);
    const started = Date.now();
    expect(() => execFileSync(process.execPath, [BIN, 'run', 'plan.bpmn', '--repo', 'run', '--quiet',
      '--runner', `slow=python3 ${path.join(dir, 'slow.py')}`, '--step-timeout', '1'],
    { cwd: dir, stdio: 'pipe', env: ENV })).toThrow();
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8')).toMatch(/took longer than 1s/);
  });

  test('a timer at a boundary event stops the runner of the step it sits on, and the run goes on from the event', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-timer-'));
    fs.writeFileSync(path.join(dir, 'plan.studyflow.yaml'), `id: timed
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Slow: { type: Task }
    TooSlow:
      type: BoundaryEvent
      attachedToRef: Slow
      eventDefinitions:
        Timer: { type: TimerEventDefinition, timeDuration: PT1S }
    Done: { type: EndEvent }
    TimedOut: { type: EndEvent }
    F1: Start -> Slow
    F2: Slow -> Done
    F3: TooSlow -> TimedOut
`);
    // A runner that waits for a message hears `cancel` instead, and ends the step itself.
    writeRunner(path.join(dir, 'slow.py'), "['Slow']", ['step.receive(timeout=30)']);
    const started = Date.now();
    execFileSync(process.execPath, [BIN, 'run', 'plan.studyflow.yaml', '--repo', 'run', '--quiet', '--runner', `slow=python3 ${path.join(dir, 'slow.py')}`],
      { cwd: dir, stdio: 'pipe', env: ENV });
    expect(Date.now() - started).toBeLessThan(20_000);
    const kept = yaml.load(fs.readFileSync(path.join(dir, 'run', 'plan.studyflow.yaml'), 'utf8')) as any;
    expect(kept.state._meta.reached).toMatchObject({ Slow: 1, TooSlow: 1, TimedOut: 1 });
    expect(kept.state._meta.reached.Done).toBeUndefined();
  });

  test('a runner whose command is not on this machine claims nothing, and the run goes on without it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-absent-'));
    fs.writeFileSync(path.join(dir, 'plan.studyflow.yaml'), 'id: plain\ndefinitions:\n  targetNamespace: http://bpmn.io/schema/bpmn\nS:\n  type: Process\n  flowElements:\n    Start: { type: StartEvent }\n    Done: { type: EndEvent }\n    F1: Start -> Done\n');
    execFileSync(process.execPath, [BIN, 'run', 'plan.studyflow.yaml', '--repo', 'run', '--quiet', '--runner', 'ghost=no-such-runner-here --serve'],
      { cwd: dir, stdio: 'pipe', env: ENV });
    expect(fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8')).toMatch(/WARNING runner\.unavailable\s+the ghost runner needs no-such-runner-here/);
  });

  test('hands partial runners a JSON digest of the plan', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:lab="http://example.org/lab" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="C">
    <bpmn:extensionElements><studyflow:study runtime="local" seed="7"><studyflow:dependencies>pandas>=2.0</studyflow:dependencies><studyflow:dependencies>joblib</studyflow:dependencies></studyflow:study></bpmn:extensionElements>
    <bpmn:participant id="Pool" name="Lab" processRef="P"><bpmn:extensionElements><lab:actor kind="robot"/></bpmn:extensionElements></bpmn:participant>
    <bpmn:participant id="Screen" name="Screen"/>
    <bpmn:messageFlow id="M1" sourceRef="T" targetRef="Screen" messageRef="Trial"/>
  </bpmn:collaboration>
  <bpmn:message id="Trial" itemRef="Trial_Item"/>
  <bpmn:itemDefinition id="Trial_Item" structureRef="behaverse:Trial"/>
  <bpmn:process id="P">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T" name="fit" implementation="python://m.f">
      <bpmn:extensionElements><lab:rig platform="x"><lab:note>a</lab:note><lab:note>b</lab:note></lab:rig></bpmn:extensionElements>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
      <bpmn:ioSpecification><bpmn:dataInput id="In1" name="table"/></bpmn:ioSpecification>
      <bpmn:dataInputAssociation id="DIA"><bpmn:sourceRef>Dat</bpmn:sourceRef><bpmn:targetRef>In1</bpmn:targetRef><bpmn:transformation language="feel">y</bpmn:transformation></bpmn:dataInputAssociation>
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
    fs.writeFileSync(path.join(dir, 'plan.bpmn'), xml);
    // A runner that claims T and completes it, keeping a copy of what it was handed and saying what it ran with.
    writeRunner(path.join(dir, 'fake.py'), "{'elements': ['T'], 'live': False}", [
      "json.dump(step.plan, open(step.cache / 'plan.json.seen', 'w'))",
      "step.note(version='m 1.0')",
      'return 1',
    ]);
    execFileSync(process.execPath, [BIN, 'run', 'plan.bpmn', '--repo', 'run', '--quiet', '--debug',
      '--runner', `fake=python3 ${path.join(dir, 'fake.py')}`, '--option', 'sim', '--option', 'speed=2'],
    { cwd: dir, stdio: 'pipe', env: ENV });

    const digest = JSON.parse(fs.readFileSync(path.join(dir, 'run', '.cache', 'plan.json.seen'), 'utf8'));
    // The contract's version, and the run's options for the runners that know them: no flag every runner must take.
    expect(digest.protocol).toBe(2);
    expect(digest.options).toEqual({ sim: true, speed: '2' });
    expect(digest.study).toEqual({ id: 'C', name: 'Lab', seed: '7', dependencies: ['pandas>=2.0', 'joblib'] });
    expect(digest.sources.length).toBeGreaterThan(0);
    const task = digest.elements.T;
    expect(task.type).toBe('task');
    expect(task.attributes.implementation).toBe('python://m.f');
    // An extension no loaded schema declares is handed on as the XML says it.
    expect(task.extensions).toEqual([{ namespace: 'http://example.org/lab', type: 'rig', attributes: { platform: 'x', note: ['a', 'b'] } }]);
    expect(task.additionalArguments).toBe('k: 1');
    expect(task.ioSlots).toEqual({ In1: 'table' });
    expect(task.inputs).toEqual([{ source: 'Dat', target: 'In1', transformation: 'y', language: 'feel' }]);
    expect(task.outputs).toEqual([{ target: 'Out', transformation: null, language: null }]);
    expect(digest.elements.Dat.attributes.uri).toBe('digits.csv');
    expect(digest.elements.Pool.extensions[0]).toEqual({ namespace: 'http://example.org/lab', type: 'actor', attributes: { kind: 'robot' } });
    // A message flow names its message, and the message and its item definition ride along, so a runner can follow the chain.
    expect(digest.elements.M1.attributes).toEqual({ sourceRef: 'T', targetRef: 'Screen', messageRef: 'Trial' });
    expect(digest.elements.Trial).toMatchObject({ type: 'message', attributes: { itemRef: 'Trial_Item' } });
    expect(digest.elements.Trial_Item).toMatchObject({ type: 'itemDefinition', attributes: { structureRef: 'behaverse:Trial' } });
    // `names` binds a name to one element: `model` names two, and `Done` is another element's id, so neither is offered.
    expect(digest.names).toEqual({ T: 'fit', Dat: 'digits' });
    // What the runner ran with joins its step's record, and is no value a later step reads.
    const record = fs.readFileSync(path.join(dir, 'run', 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(record.find((event) => event.event === 'executed' && event.id === 'T').entry).toMatchObject({ version: 'm 1.0' });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'run', '.cache', 'Done.state.json'), 'utf8'))).not.toHaveProperty('record');
  });

  test('carries a runner\'s messages while it runs, and records them', async () => {
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
    fs.writeFileSync(path.join(dir, 'plan.bpmn'), xml);
    const heard = path.join(dir, 'heard.json');
    writeRunner(path.join(dir, 'task.py'), "['Play']", [
      "answer = step.ask('M_Trial', {'n': 1}, id='t1', timeout=30)",
      `open(${JSON.stringify(heard)}, 'w').write(json.dumps([answer]))`,
      "open(step.run_dir / 'trials.jsonl', 'w').write('{}')",
      'return 1',
    ]);
    writeRunner(path.join(dir, 'model.py'), "['Model']", [`return f"saw {step.message['content']['n']}"`]);
    execFileSync(process.execPath, [BIN, 'run', 'plan.bpmn', '--repo', 'run', '--quiet',
      '--runner', `task=python3 ${path.join(dir, 'task.py')}`, '--runner', `model=python3 ${path.join(dir, 'model.py')}`],
    { cwd: dir, stdio: 'pipe', env: ENV });

    // The trial left along the sub-process's flow, and the model's answer came back into the task that sent it.
    expect(JSON.parse(fs.readFileSync(heard, 'utf8'))).toMatchObject([{ flow: 'M_Answer', content: 'saw 1', inReplyTo: 't1' }]);
    expect(archivedState(path.join(dir, 'run', 'plan.bpmn'))._meta.reached).toMatchObject({ Play: 1, Done: 1 });
    // The dataset the steps inside filled is the sub-process's own data edge, so the sub-process generated it.
    expect(fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8')).toMatch(/save trials\.jsonl/);
    // The record holds the run as its events: each message sent with its content, each step as it ran.
    const record = fs.readFileSync(path.join(dir, 'run', 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(record.find((event) => event.event === 'sent').message).toMatchObject({ id: 't1', flow: 'M_Trial', content: { n: 1 } });
    expect(record.some((event) => event.event === 'executed' && event.id === 'Play')).toBe(true);
  });

  test('hands a pool that remembers the conversation each message belongs to', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-memory-'));
    fs.writeFileSync(path.join(dir, 'plan.studyflow.yaml'), `id: memory
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Subjects: { name: Subjects, participantMultiplicity: { maximum: 2 }, processRef: S }
    Model: { type: studyflow:Actor, name: Model, actorType: llm, memory: conversation }
  messageFlows:
    M_Ask: { sourceRef: Ask, targetRef: Model }
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Ask: { type: SendTask }
    S9: { type: EndEvent }
    SF1: S0 -> Ask
    SF2: Ask -> S9
`);
    const heard = path.join(dir, 'heard.jsonl');
    writeRunner(path.join(dir, 'model.py'), "['Model']", [`open(${JSON.stringify(heard)}, 'a').write(json.dumps(step.conversation) + '\\n')`, "return 'ok'"]);
    execFileSync(process.execPath, [BIN, 'run', 'plan.studyflow.yaml', '--repo', 'run', '--quiet', '--runner', `model=python3 ${path.join(dir, 'model.py')}`],
      { cwd: dir, stdio: 'pipe', env: ENV });
    expect(fs.readFileSync(heard, 'utf8').trim().split('\n').map((line) => JSON.parse(line)))
      .toEqual([{ id: 'Model with Subjects #1', turn: 0 }, { id: 'Model with Subjects #2', turn: 0 }]);
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
    fs.writeFileSync(path.join(dir, 'plan.bpmn'), xml);
    fs.writeFileSync(path.join(dir, 'x.json'), '[]');
    // A runner that stages x.json from the plan's first source while running Load, and only waits while running Wait.
    writeRunner(path.join(dir, 'fake.py'), "['Wait', 'Load']", [
      "print('pid', os.getpid())",
      "time.sleep(0.2 if step.id == 'Load' else 0.8)",
      "if step.id == 'Load': shutil.copyfile(os.path.join(step.plan['sources'][0], 'x.json'), step.run_dir / 'x.json')",
      'return step.id',
    ]);
    execFileSync(process.execPath, [BIN, 'run', 'plan.bpmn', '--repo', 'run', '--quiet',
      '--runner', `fake=python3 ${path.join(dir, 'fake.py')}`], { cwd: dir, stdio: 'pipe', env: ENV });

    const log = fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8');
    expect(log.match(/stage x\.json/g)).toHaveLength(1);
    // One process ran both, each hand-off on its own; what it printed is in the run log.
    const pids = [...log.matchAll(/runner\.stdout\s+pid (\d+)/g)].map((line) => line[1]);
    expect(pids).toHaveLength(2);
    expect(pids[0]).toBe(pids[1]);
  });

  test('a re-run appends to a data store what the run it redoes appended, once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-store-'));
    fs.writeFileSync(path.join(dir, 'plan.studyflow.yaml'), `id: store
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Subject: { name: Each subject, participantMultiplicity: { maximum: 2 }, processRef: P }
P:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Record:
      type: Task
      dataOutputAssociations: { Out_Log: { targetRef: Log } }
    Log: { type: DataStoreReference, uri: log.jsonl }
    Done: { type: EndEvent }
    F1: Start -> Record
    F2: Record -> Done
`);
    writeRunner(path.join(dir, 'fake.py'), "['Record']", ["open(step.run_dir / 'log.jsonl', 'a').write(json.dumps(step.values['state']['_meta']['instance']) + '\\n')"]);
    const run = (file: string) => execFileSync(process.execPath, [BIN, 'run', file, '--repo', path.join(dir, 'run'), '--quiet', '--runner', `fake=python3 ${path.join(dir, 'fake.py')}`],
      { cwd: dir, stdio: 'pipe', env: ENV });
    run('plan.studyflow.yaml');
    const first = fs.readFileSync(path.join(dir, 'run', 'log.jsonl'), 'utf8');
    expect(first.trim().split('\n')).toHaveLength(2);
    run(path.join(dir, 'run', 'plan.studyflow.yaml'));
    expect(fs.readFileSync(path.join(dir, 'run', 'log.jsonl'), 'utf8')).toBe(first);
  });

  test('keeps what a runner had written before its step failed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-partial-'));
    fs.writeFileSync(path.join(dir, 'plan.studyflow.yaml'), 'id: partial\ndefinitions:\n  targetNamespace: http://bpmn.io/schema/bpmn\nP:\n  type: Process\n  flowElements:\n    Start: { type: StartEvent }\n    Work: { type: Task }\n    Done: { type: EndEvent }\n    F1: Start -> Work\n    F2: Work -> Done\n');
    writeRunner(path.join(dir, 'fake.py'), "['Work']", ["step.write('P', 'kept', 3)", "raise RuntimeError('boom')"]);
    expect(() => execFileSync(process.execPath, [BIN, 'run', 'plan.studyflow.yaml', '--repo', 'run', '--quiet', '--runner', `fake=python3 ${path.join(dir, 'fake.py')}`],
      { cwd: dir, stdio: 'pipe', env: ENV })).toThrow();
    expect(fs.readFileSync(path.join(dir, 'run', 'studyflow.log'), 'utf8')).toMatch(/RuntimeError: boom/);
    expect((yaml.load(fs.readFileSync(path.join(dir, 'run', 'plan.studyflow.yaml'), 'utf8')) as any).state.P.kept).toBe(3);
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
    fs.writeFileSync(path.join(dir, 'p.bpmn'), xml);
    // A replayable runner (`live: false`), so the second run may skip what the first one made.
    writeRunner(path.join(dir, 'fake.py'), "{'elements': ['Make'], 'live': False}", [
      "open(step.run_dir / 'out.json', 'w').write('{\"made\": 1}')",
      'return step.id',
    ]);
    const run = (plan: string, ...args: string[]) => execFileSync(process.execPath, [BIN, 'run', plan, '--quiet',
      '--runner', `fake=python3 ${path.join(dir, 'fake.py')}`, ...args], {
      cwd: dir, stdio: 'pipe', env: ENV,
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

});

/** `studyflow run` on a YAML study keeps it as YAML in the run repository, and stages from beside the original. */

test.describe('studyflow run on a converted study', () => {
  test.skip(!hasUv(), 'uv is not on PATH');

  test('stages a boundary input from beside the YAML file, run from another folder, and keeps the study as YAML', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-inputs-'));
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
    // The python skill's runner, which stages `counts.json`, is named.
    const studyflow = (...args: string[]) => execFileSync(process.execPath, [BIN, 'run', ...args, '--quiet'], {
      cwd: path.join(dir, 'elsewhere'),
      stdio: 'pipe',
      env: { ...ENV, STUDYFLOW_PYTHON_PY: PYTHON },
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
    // Nothing changed, so the step is reused: the YAML the commit in its record holds is read back, and draws the
    // element it compares the same.
    expect(log).toContain('skipped Dump (run run)');
  });
});
