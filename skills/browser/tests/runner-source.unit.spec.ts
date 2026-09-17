import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { readParameters, resolveRunSource } from '@runner/source';
import { ScopeChain } from '@runner/scope';
import { parseStudyflow, Studyflow } from '@runner/studyflow';
import { getAttribute } from '@core/element';
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

  expect([...study.parameters.overridden].sort()).toEqual(['blocks', 'task', 'timeline']);
  expect(study.flowNodes.get('Task')?.businessObject?.name).toBe('NB / XCIT_NB_01');
  expect(study.flowNodes.get('Task')?.parameters.blocks, 'an overriding value takes the type of the one it replaces').toBe(5);
  // The Task's name reads the properties the link binds, never the Task's own settings, which stay the Task's alone;
  // a parameter the study declares nowhere still binds, and is named as undeclared.
  expect(study.parameters.undeclared).toEqual(['arm']);
  expect(study.parameters.values).toEqual({ task: 'NB', timeline: 'XCIT_NB_01', arm: 'control' });
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
  expect([...study.parameters.overridden].sort()).toEqual(['Bot.Speed', 'Streams.1']);

  await expect(parseStudyflow(NESTED, freshPackages(), { Bot: '5' })).rejects.toThrow(/Bot.*Config/);
  await expect(parseStudyflow(NESTED, freshPackages(), { Streams: '5' })).rejects.toThrow(/Streams.*Config/);
});

test('the runner\'s Behaverse demo: a link picks the instrument through the study\'s `task`, the timeline through the task\'s Parameters', async () => {
  const demo = readFileSync(path.join(process.cwd(), 'assets/demos/behaverse.studyflow'), 'utf8');
  const CASES: [given: Record<string, string>, instrument: string, timeline: string][] = [
    [{}, 'BCS', 'XCIT_BCS_02'],
    [{ task: 'NB', timeline: 'XCIT_NB_01' }, 'NB', 'XCIT_NB_01'],
  ];
  for (const [given, instrument, timeline] of CASES) {
    const task = (await parseStudyflow(demo, freshPackages(), given)).flowNodes.get('Task')!;
    expect([getAttribute(task.businessObject, 'instrument'), getAttribute(task.businessObject, 'timeline'), task.parameters], instrument)
      .toEqual([instrument, timeline, {}]);
  }
});

/** A rest in a sub-process reading one Parameters object its container declares and one from the process around it;
 * `Knobs` is wired into nothing. */
const WIRED_TWICE = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P">
    <bpmn:extensionElements><studyflow:study seed="3" /></bpmn:extensionElements>
    <bpmn:startEvent id="Start" />
    <bpmn:subProcess id="Sub">
      <bpmn:task id="T">
        <bpmn:extensionElements><cognitive:rest restDuration="60" /></bpmn:extensionElements>
        <bpmn:dataInputAssociation id="In_A"><bpmn:sourceRef>A</bpmn:sourceRef></bpmn:dataInputAssociation>
        <bpmn:dataInputAssociation id="In_B"><bpmn:sourceRef>B</bpmn:sourceRef></bpmn:dataInputAssociation>
      </bpmn:task>
      <bpmn:dataObjectReference id="B"><bpmn:extensionElements><studyflow:parameters><studyflow:values>${inner}</studyflow:values></studyflow:parameters></bpmn:extensionElements></bpmn:dataObjectReference>
    </bpmn:subProcess>
    <bpmn:dataObjectReference id="A"><bpmn:extensionElements><studyflow:parameters><studyflow:values>Timelines:
  XCIT_NB_01:
Bot:
  Speed: 20
restDuration: 30
</studyflow:values></studyflow:parameters></bpmn:extensionElements></bpmn:dataObjectReference>
    <bpmn:dataObjectReference id="Knobs"><bpmn:extensionElements><studyflow:parameters><studyflow:values>seed: 7
eyes: closed
</studyflow:values></studyflow:parameters></bpmn:extensionElements></bpmn:dataObjectReference>
    <bpmn:sequenceFlow id="F" sourceRef="Start" targetRef="Sub" />
  </bpmn:process>
</bpmn:definitions>`;

/** What `skills/local/run.py` reads of `xml`: `reading`, a Python expression over its `studyflow`, as JSON, or the
 * error that stops the run. */
function localReading(xml: string, reading: string): any {
  const script = [
    'import importlib.util, json, sys',
    'from xml.etree import ElementTree as ET',
    'spec = importlib.util.spec_from_file_location("run", sys.argv[1])',
    'run = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(run)',
    'try:',
    '    studyflow = run.Studyflow(ET.fromstring(sys.stdin.read()))',
    `    print(json.dumps(${reading}))`,
    'except SystemExit as error:',
    '    print(json.dumps({"error": str(error)}))',
  ].join('\n');
  const run = path.resolve(__dirname, '../../local/run.py');
  return JSON.parse(execFileSync('uv', ['run', '--no-project', '--with', 'pyyaml', 'python', '-c', script, run], { input: xml, stdio: 'pipe' }).toString());
}

/** What `run.py` hands its partial runners: `T`'s `parameters` and rest attributes and the study's seed, from the plan digest. */
function localDigest(xml: string): { parameters?: unknown; rest?: Record<string, string>; seed?: string; error?: string } {
  return localReading(xml, '(lambda digest: {"parameters": digest["elements"]["T"].get("parameters"), '
    + '"rest": digest["elements"]["T"]["extensions"][0]["attributes"], "seed": digest["study"]["seed"]})(run.plan_digest(studyflow, []))');
}

test('both runtimes read the Parameters wired into a step the same way: merged, a key naming its attribute setting it, a clash refused', async () => {
  test.skip(spawnSync('uv', ['--version']).error !== undefined, 'uv is not on PATH');
  const merged = WIRED_TWICE('Bot:\n  SkipInstructions: true\n');
  // `restDuration` names an attribute of the rest, so it sets it rather than joining what the rest's runner reads;
  // the unwired Knobs' `seed` and `eyes` set nothing.
  const expected = { Timelines: { XCIT_NB_01: null }, Bot: { Speed: 20, SkipInstructions: true } };
  const browser = new Studyflow(await parseStudyflow(merged, freshPackages()));
  const task = browser.flowNodes.get('T')!;
  expect([task.parameters, getAttribute(task.businessObject, 'restDuration'), getAttribute(task.businessObject, 'eyes'), browser.seed])
    .toEqual([expected, 30, 'open', 3]);
  const local = localDigest(merged);
  expect([local.parameters, local.rest, local.seed]).toEqual([expected, { restDuration: '30' }, '3']);

  // Each refusal names the step and what clashes: the key and both objects, or the attribute that takes one value.
  const CLASHES: [inner: string, names: RegExp][] = [
    ['Bot:\n  Speed: 5\n', /T.*Bot\.Speed.*A.*B/],
    ['eyes: [open, closed]\n', /T.*eyes.*list/],
  ];
  for (const [inner, names] of CLASHES) {
    await expect(parseStudyflow(WIRED_TWICE(inner), freshPackages()), String(names)).rejects.toThrow(names);
    expect(localDigest(WIRED_TWICE(inner)).error, String(names)).toMatch(names);
  }
});

/** A sub-process with a Parameters object wired into it, a step inside it, one after it, and the study's own `label`;
 * `inner` is what else the sub-process declares. */
const WIRED_BLOCK = (inner = '') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P">
    <bpmn:extensionElements><studyflow:study /></bpmn:extensionElements>
    <bpmn:property id="P_Label" name="label" studyflow:value="outer" />
    <bpmn:subProcess id="Block" name="{label}">
      ${inner}
      <bpmn:dataInputAssociation id="In_Knobs"><bpmn:sourceRef>Knobs</bpmn:sourceRef></bpmn:dataInputAssociation>
      <bpmn:startEvent id="Inner_Start" />
      <bpmn:task id="Inside" name="{label} at {speed}" />
      <bpmn:sequenceFlow id="F_In" sourceRef="Inner_Start" targetRef="Inside" />
    </bpmn:subProcess>
    <bpmn:task id="After" name="{label}" />
    <bpmn:dataObjectReference id="Knobs"><bpmn:extensionElements><studyflow:parameters><studyflow:values>label: inner
speed: 20
</studyflow:values></studyflow:parameters></bpmn:extensionElements></bpmn:dataObjectReference>
    <bpmn:sequenceFlow id="F" sourceRef="Block" targetRef="After" />
  </bpmn:process>
</bpmn:definitions>`;

test('the Parameters wired into a sub-process are its read-only properties, in both runtimes, as if it declared them', async () => {
  const study = await parseStudyflow(WIRED_BLOCK(), freshPackages());
  // `{label}` inside the sub-process reads its own, hiding the study's; outside, the study's.
  expect(['Block', 'Inside', 'After'].map((id) => study.flowNodes.get(id)?.businessObject?.name)).toEqual(['inner', 'inner at 20', 'outer']);
  const block = study.scopes.get('Block')!;
  expect(block.properties.filter((p) => p.readOnly).map((p) => [p.name, p.value])).toEqual([['label', 'inner'], ['speed', 20]]);
  const chain = new ScopeChain(study.scopes.get('P')!);
  chain.push(block);
  chain.write('speed', 20, true);
  expect(() => chain.write('speed', 5)).toThrow(/speed.*Block/);

  // The refusal names the sub-process and the property declared twice.
  const clash = /Block.*label/;
  await expect(parseStudyflow(WIRED_BLOCK('<bpmn:property id="B_Label" name="label" />'), freshPackages())).rejects.toThrow(clash);

  test.skip(spawnSync('uv', ['--version']).error !== undefined, 'uv is not on PATH');
  expect(localReading(WIRED_BLOCK(), '[studyflow.properties["Block"], sorted(studyflow.readonly["Block"])]'))
    .toEqual([{ label: '"inner"', speed: '20' }, ['label', 'speed']]);
  expect(localReading(WIRED_BLOCK('<bpmn:property id="B_Label" name="label" />'), 'None').error).toMatch(clash);
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

test('config wired into a task is that task\'s settings alone, and fills no placeholder; wired nowhere, it does nothing', async () => {
  const CASES: [label: string, association: string, first: Record<string, unknown>][] = [
    ['wired into First', '      dataInputAssociations:\n        In_Config:\n          sourceRef:\n            - Config\n', { label: 'from-config' }],
    ['wired nowhere', '', {}],
  ];
  for (const [label, association, first] of CASES) {
    const study = await parseStudyflow(TWO_STEPS(association), freshPackages(), {});
    expect(['First', 'Second'].map((id) => study.flowNodes.get(id)?.parameters), label).toEqual([first, {}]);
    // `{name}` reads properties: `label` is declared nowhere, so its placeholders stay as written, demanded of no one.
    expect(['First', 'Second'].map((id) => study.flowNodes.get(id)?.businessObject?.name), label).toEqual(['{label}', '{label}']);
    expect(study.parameters.unbound, label).toEqual([]);
  }
  // A link key only an unwired object carries overrides nothing: it binds as undeclared.
  const linked = await parseStudyflow(TWO_STEPS(''), freshPackages(), { label: 'from-link' });
  expect([linked.parameters.overridden, linked.parameters.undeclared]).toEqual([[], ['label']]);
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
