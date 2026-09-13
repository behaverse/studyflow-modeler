import { freshPackages } from '@tests/schemas';

import { expect, test } from '@playwright/test';

import { readParameters, resolveRunSource } from '@runner/source';
import { parseStudyflow, Studyflow } from '@runner/studyflow';

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
