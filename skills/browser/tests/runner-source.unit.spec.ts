import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { readParameters, resolveRunSource } from '@runner/source';
import { parseStudyflow, Studyflow } from '@runner/studyflow';
import { freshPackages } from '@tests/schemas';

/** What the runner's `diagram=` parameter accepts, and how the rest of the query string reaches the study. */

/** One step, named from the config data object wired into it; the study declares `task` and `timeline`. */
const DEMO = `id: demo
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Demo:
  type: bpmn:Process
  extensionElements:
    - type: studyflow:Study
  properties:
    P_Task:
      name: task
    P_Timeline:
      name: timeline
  flowElements:
    Config:
      type: bpmn:DataObjectReference
      name: config
      extensionElements:
        - type: studyflow:Parameters
          values: |
            task: BCS
            timeline: XCIT_BCS_02
            blocks: 3
    Task:
      type: bpmn:Task
      name: "{task} / {timeline}"
      dataInputAssociations:
        In_Config:
          sourceRef:
            - Config
`;

test('`diagram` tells a demo name, a URL, and a hand-off id apart', () => {
  const demos = { demo: '/assets/demos/demo.studyflow' };
  expect(resolveRunSource('demo', demos)).toEqual({ kind: 'url', url: demos.demo });
  expect(resolveRunSource('https://data.behaverse.org/v1/studies/pilot3/studyflow'))
    .toEqual({ kind: 'url', url: 'https://data.behaverse.org/v1/studies/pilot3/studyflow' });
  expect(resolveRunSource('/assets/my-study.studyflow'))
    .toEqual({ kind: 'url', url: '/assets/my-study.studyflow' });
  expect(resolveRunSource('my-study.bpmn')).toEqual({ kind: 'url', url: 'my-study.bpmn' });
  expect(resolveRunSource('a1b2c3d4', demos)).toEqual({ kind: 'handoff', id: 'a1b2c3d4' });
  expect(resolveRunSource('')).toBeUndefined();
  // The runner keeps `diagram` for itself; the rest of the query string is the study's.
  expect(readParameters(new URLSearchParams('diagram=demo&seed=42&task=NB'))).toEqual({ seed: '42', task: 'NB' });
});

test('a `seed` parameter binds to the root Study\'s `seed`, as the Integer it declares; without one, the seed the Study pins runs', async () => {
  const pooled = `id: pooled
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Pools:
  type: bpmn:Collaboration
  extensionElements:
    - type: studyflow:Study
      seed: 7
  participants:
    Pool:
      processRef: Lab
Lab:
  type: bpmn:Process
  flowElements:
    Start:
      type: bpmn:StartEvent
`;
  // `studyId` is what the run reports: in a pool diagram the collaboration, which carries the Study, not its pool's process.
  const CASES: { label: string; text: string; given: Record<string, string>; seed: number; studyId: string }[] = [
    { label: 'the link\'s seed', text: DEMO, given: { seed: '42', task: 'NB' }, seed: 42, studyId: 'Demo' },
    { label: 'a seed pinned in the diagram', text: DEMO.replace('- type: studyflow:Study', '- type: studyflow:Study\n      seed: 7'), given: {}, seed: 7, studyId: 'Demo' },
    { label: 'a pool diagram\'s seed, on the collaboration', text: pooled, given: {}, seed: 7, studyId: 'Pools' },
  ];

  for (const { label, text, given, seed, studyId } of CASES) {
    const study = new Studyflow(await parseStudyflow(text, freshPackages(), given));
    expect([study.seed, study.study.seed, study.parameters.values.seed], label).toEqual([seed, seed, seed]);
    expect(study.parameters.undeclared, `${label}: the Study declares it`).toEqual([]);
    expect(study.studyId, label).toBe(studyId);
  }
});

test('a link overrides the data object rather than sitting beside it', async () => {
  const study = await parseStudyflow(DEMO, freshPackages(), { task: 'NB', timeline: 'XCIT_NB_01', blocks: '5', arm: 'control' });

  expect(study.parameters.overridden).toEqual(['task', 'timeline', 'blocks']);
  expect(study.parameters.values).toMatchObject({ task: 'NB', timeline: 'XCIT_NB_01' });
  expect(study.flowNodes.get('Task')?.businessObject?.name).toBe('NB / XCIT_NB_01');
  expect(study.parameters.values.blocks, 'an overriding value takes the type of the one it replaces').toBe(5);
  // A parameter the study declares nowhere still binds, and is named as undeclared.
  expect(study.parameters.undeclared).toEqual(['arm']);
  expect(study.parameters.values.arm).toBe('control');
});

/** A Parameters object nesting its values, wired into the one step. */
const NESTED = `id: nested
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Nested:
  type: bpmn:Process
  flowElements:
    Config:
      type: bpmn:DataObjectReference
      extensionElements:
        - type: studyflow:Parameters
          values: |
            Bot:
              Speed: 20
            Streams: [3, 1]
    Task:
      type: bpmn:Task
      dataInputAssociations:
        In_Config:
          sourceRef:
            - Config
`;

test('a dotted link parameter replaces one value inside the Parameters a step reads, never a whole mapping or list', async () => {
  const study = await parseStudyflow(NESTED, freshPackages(), { 'Bot.Speed': '5', 'Streams.1': '2' });
  expect(study.flowNodes.get('Task')?.parameters, 'each takes the type of the value it replaces').toEqual({ Bot: { Speed: 5 }, Streams: [3, 2] });
  expect(study.parameters.overridden).toEqual(['Bot.Speed', 'Streams.1']);

  await expect(parseStudyflow(NESTED, freshPackages(), { Bot: '5' })).rejects.toThrow(/'Bot', a whole mapping in Config.*Bot\.<key>/);
  await expect(parseStudyflow(NESTED, freshPackages(), { Streams: '5' })).rejects.toThrow(/'Streams', a whole list in Config/);
});

test('the Parameters a step reads take `{name}` in their keys and strings, a lone placeholder keeping its type', async () => {
  // The runner's Behaverse demo: one diagram, any task and timeline the link names.
  const demo = readFileSync(path.join(process.cwd(), 'assets/demos/behaverse.studyflow'), 'utf8');
  const study = await parseStudyflow(demo, freshPackages(), { task: 'NB', timeline: 'XCIT_NB_01' });
  expect(study.flowNodes.get('Task')?.parameters).toEqual({ Timelines: { XCIT_NB_01: null } });
  expect(study.flowNodes.get('Task')?.businessObject?.name).toBe('NB / XCIT_NB_01');

  const typed = NESTED.replace('values: |\n            Bot:\n              Speed: 20', 'values: |\n            Bot:\n              Speed: "{speed}"\n              Label: at {speed}');
  const knobs = `    Knobs:
      type: bpmn:DataObjectReference
      extensionElements:
        - type: studyflow:Parameters
          values: |
            speed: 20
`;
  const read = await parseStudyflow(typed.replace('  flowElements:\n', `  flowElements:\n${knobs}`), freshPackages());
  expect(read.flowNodes.get('Task')?.parameters).toEqual({ Bot: { Speed: 20, Label: 'at 20' }, Streams: [3, 1] });
});

/** A step in a sub-process reading one Parameters object its container declares and one from the process around it. */
const WIRED_TWICE = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P">
    <bpmn:extensionElements><studyflow:study /></bpmn:extensionElements>
    <bpmn:startEvent id="Start" />
    <bpmn:subProcess id="Sub">
      <bpmn:task id="T">
        <bpmn:dataInputAssociation id="In_A"><bpmn:sourceRef>A</bpmn:sourceRef></bpmn:dataInputAssociation>
        <bpmn:dataInputAssociation id="In_B"><bpmn:sourceRef>B</bpmn:sourceRef></bpmn:dataInputAssociation>
      </bpmn:task>
      <bpmn:dataObjectReference id="B"><bpmn:extensionElements><studyflow:parameters><studyflow:values>${inner}</studyflow:values></studyflow:parameters></bpmn:extensionElements></bpmn:dataObjectReference>
    </bpmn:subProcess>
    <bpmn:dataObjectReference id="A"><bpmn:extensionElements><studyflow:parameters><studyflow:values>Timelines:
  XCIT_NB_01:
Bot:
  Speed: 20
</studyflow:values></studyflow:parameters></bpmn:extensionElements></bpmn:dataObjectReference>
    <bpmn:sequenceFlow id="F" sourceRef="Start" targetRef="Sub" />
  </bpmn:process>
</bpmn:definitions>`;

/** What `skills/local/run.py` hands its partial runners for `T`: the plan digest's `parameters`, or the error that stops the run. */
function localParameters(xml: string): { parameters?: unknown; error?: string } {
  const script = [
    'import importlib.util, json, sys',
    'from xml.etree import ElementTree as ET',
    'spec = importlib.util.spec_from_file_location("run", sys.argv[1])',
    'run = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(run)',
    'try:',
    '    digest = run.plan_digest(run.Studyflow(ET.fromstring(sys.stdin.read())), [])',
    '    print(json.dumps({"parameters": digest["elements"]["T"].get("parameters")}))',
    'except SystemExit as error:',
    '    print(json.dumps({"error": str(error)}))',
  ].join('\n');
  const run = path.resolve(__dirname, '../../local/run.py');
  return JSON.parse(execFileSync('uv', ['run', '--no-project', '--with', 'pyyaml', 'python', '-c', script, run], { input: xml, stdio: 'pipe' }).toString());
}

test('both runtimes merge the Parameters wired into a step the same way, and refuse the same clash', async () => {
  test.skip(spawnSync('uv', ['--version']).error !== undefined, 'uv is not on PATH');
  const merged = WIRED_TWICE('Bot:\n  SkipInstructions: true\n');
  const expected = { Timelines: { XCIT_NB_01: null }, Bot: { Speed: 20, SkipInstructions: true } };
  expect((await parseStudyflow(merged, freshPackages())).flowNodes.get('T')?.parameters).toEqual(expected);
  expect(localParameters(merged)).toEqual({ parameters: expected });

  const clash = WIRED_TWICE('Bot:\n  Speed: 5\n');
  const message = 'T reads Bot.Speed from both A and B: set it in one of them.';
  await expect(parseStudyflow(clash, freshPackages())).rejects.toThrow(message);
  expect(localParameters(clash)).toEqual({ error: message });
});

/** One config object, two steps: the association is the only thing that separates them. */
const TWO_STEPS = (association: string) => `id: two_steps
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Two_Steps:
  type: bpmn:Process
  flowElements:
    Config:
      type: bpmn:DataObjectReference
      name: config
      extensionElements:
        - type: studyflow:Parameters
          values: |
            label: from-config
    First:
      type: bpmn:Task
      name: "{label}"
${association}      outgoing: [Flow]
    Second:
      type: bpmn:Task
      name: "{label}"
      incoming: [Flow]
    Flow:
      type: bpmn:SequenceFlow
      sourceRef: First
      targetRef: Second
`;

test('config wired into one step is read by that step and no other; wired nowhere, every step reads it', async () => {
  const CASES = [
    {
      label: 'wired into First',
      association: '      dataInputAssociations:\n        In_Config:\n          sourceRef:\n            - Config\n',
      names: ['from-config', '{label}'],
      unbound: ['label'],
    },
    { label: 'wired nowhere: the study\'s own', association: '', names: ['from-config', 'from-config'], unbound: [] },
  ];

  for (const { label, association, names, unbound } of CASES) {
    const study = await parseStudyflow(TWO_STEPS(association), freshPackages(), {});
    expect(['First', 'Second'].map((id) => study.flowNodes.get(id)?.businessObject?.name), label).toEqual(names);
    expect(study.parameters.unbound, label).toEqual(unbound);
  }
});

/** `{COMPLETION_CODE}` belongs to the end event and `{count}` to the run state: neither is asked of the link. */
test('a placeholder that names no declared parameter is left as written, not demanded', async () => {
  const study = await parseStudyflow(`id: redirects
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Redirects:
  type: bpmn:Process
  properties:
    P_Task:
      name: task
  flowElements:
    Trial:
      type: bpmn:Task
      name: "Trial {count}"
    Task:
      type: bpmn:Task
      name: "{task}"
    Done:
      type: bpmn:EndEvent
      redirectTo: https://app.prolific.com/submissions/complete?cc={COMPLETION_CODE}
`, freshPackages(), {});

  // A declared one nothing has bound is reported, not silently emptied.
  expect(study.parameters.unbound).toEqual(['task']);
  expect(study.flowNodes.get('Trial')?.businessObject?.name).toBe('Trial {count}');
  expect(study.flowNodes.get('Done')?.businessObject?.redirectTo).toContain('cc={COMPLETION_CODE}');
});

test('every kind of task is a step the run reaches', async () => {
  const study = await parseStudyflow(`id: all_tasks
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
All_Tasks:
  type: bpmn:Process
  flowElements:
    Start:
      type: bpmn:StartEvent
    Receive:
      type: bpmn:ReceiveTask
    Rule:
      type: bpmn:BusinessRuleTask
    End:
      type: bpmn:EndEvent
    F1: Start -> Receive
    F2: Receive -> Rule
    F3: Rule -> End
`, freshPackages(), {});

  expect(study.flowNodes.get('Receive')?.outgoing).toEqual(['F2']);
  expect(study.flowNodes.get('Rule')?.incoming).toEqual(['F2']);
});
