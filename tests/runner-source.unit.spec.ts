import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { buildCatalog, setCatalog } from '@behaverse/studyflow-core/notation';
import { toModdlePackages } from '@behaverse/studyflow-core/notation/schemaFile';
import { readParameters, resolveRunSource } from '../src/runner/source';
import { parseStudyflow, Studyflow } from '../src/runner/studyflow';
import { getBehaverseTaskPayload } from '../src/runner/nodes/behaverse/parser';
import type { FlowNode } from '../src/runner/flow';
import { loadSchemaModels } from './schemas';

/** What the runner's `diagram=` parameter accepts, and how the rest of the query string reaches the study. */

const models = loadSchemaModels();
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
setCatalog(buildCatalog(models));

const DEMOS = { behaverse: '/assets/demos/behaverse.studyflow' };

const demoSource = readFileSync(
  path.join(process.cwd(), 'src/assets/demos/behaverse.studyflow'),
  'utf8',
);

/** A template that carries no value of its own, so the link is the only place `task` can come from. */
const NEEDS_TASK = `id: needs_task
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Needs_Task:
  type: bpmn:Process
  properties:
    P_Task:
      name: task
  flowElements:
    Task:
      type: bpmn:Task
      name: \${task}
`;

test('`diagram` tells a demo name, a URL, and a hand-off id apart', () => {
  expect(resolveRunSource('behaverse', DEMOS)).toEqual({ kind: 'url', url: DEMOS.behaverse });
  expect(resolveRunSource('https://data.behaverse.org/v1/studies/pilot3/studyflow'))
    .toEqual({ kind: 'url', url: 'https://data.behaverse.org/v1/studies/pilot3/studyflow' });
  expect(resolveRunSource('/assets/my-study.studyflow'))
    .toEqual({ kind: 'url', url: '/assets/my-study.studyflow' });
  expect(resolveRunSource('my-study.bpmn')).toEqual({ kind: 'url', url: 'my-study.bpmn' });
  expect(resolveRunSource('a1b2c3d4', DEMOS)).toEqual({ kind: 'handoff', id: 'a1b2c3d4' });
  expect(resolveRunSource('')).toBeUndefined();
});

test('the runner keeps `diagram` for itself and passes the rest to the study', () => {
  const params = new URLSearchParams('diagram=behaverse&seed=42&task=BCS&timeline=XCIT_BCS_02');
  expect(readParameters(params)).toEqual({ seed: '42', task: 'BCS', timeline: 'XCIT_BCS_02' });
});

test('a `seed` parameter binds to the study\'s own `studyflow:seed`, as the Integer it declares', async () => {
  const study = new Studyflow(
    await parseStudyflow(demoSource, packages, { seed: '42', task: 'BCS', timeline: 'XCIT_BCS_02' }),
  );

  expect(study.seed).toBe(42);
  expect(study.businessObject.seed).toBe(42);
  expect(study.parameters.values.seed).toBe(42);
  expect(study.parameters.undeclared, 'the Seed trait declares it').toEqual([]);
});

test('a seed pinned in the diagram is what runs when the link gives none', async () => {
  const pinned = demoSource.replace('type: bpmn:Process', 'type: bpmn:Process\n  seed: 7');
  const study = new Studyflow(
    await parseStudyflow(pinned, packages, { task: 'BCS', timeline: 'XCIT_BCS_02' }),
  );

  expect(study.seed).toBe(7);
});

test('the behaverse demo runs on the values its own data object carries', async () => {
  const study = await parseStudyflow(demoSource, packages, {});

  expect(study.parameters.unbound).toEqual([]);
  expect(study.parameters.overridden).toEqual([]);
  expect(study.scopes.get(study.rootScopeId)?.properties.map((p) => p.name))
    .toEqual(['task', 'timeline']);
  // No start or end event: the demo shows the task and nothing else.
  expect([...study.flowNodes.keys()]).toEqual(['Task']);
  expect(study.startId).toBe('Task');

  const payload = getBehaverseTaskPayload(study.flowNodes.get('Task') as FlowNode);
  expect(payload).toMatchObject({
    scene: 'BCS',
    timeline: 'XCIT_BCS_02',
    // The timeline is named, not defined, so Unity runs the one its own build ships.
    configMode: 'builtin',
    agentType: 'human',
  });
  expect(payload?.parameters).toBeUndefined();
});

test('a link overrides the data object rather than sitting beside it', async () => {
  const study = await parseStudyflow(demoSource, packages, { task: 'NB', timeline: 'XCIT_NB_01' });

  expect(study.parameters.overridden).toEqual(['task', 'timeline']);
  expect(study.parameters.values).toMatchObject({ task: 'NB', timeline: 'XCIT_NB_01' });
  expect(getBehaverseTaskPayload(study.flowNodes.get('Task') as FlowNode)).toMatchObject({
    scene: 'NB',
    timeline: 'XCIT_NB_01',
  });
  expect(study.flowNodes.get('Task')?.businessObject?.name).toBe('NB / XCIT_NB_01');
});

test('an overriding value takes the type of the one it replaces', async () => {
  const withNumber = demoSource.replace('            task: BCS', '            task: BCS\n            blocks: 3');
  const study = await parseStudyflow(withNumber, packages, { blocks: '5' });

  expect(study.parameters.values.blocks, 'the data object said this is a number').toBe(5);
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
      name: \${label}
${association}      outgoing: [Flow]
    Second:
      type: bpmn:Task
      name: \${label}
      incoming: [Flow]
    Flow:
      type: bpmn:SequenceFlow
      sourceRef: First
      targetRef: Second
`;

const WIRED_TO_FIRST = '      dataInputAssociations:\n        In_Config:\n          sourceRef:\n            - Config\n';

test('config wired into one step is read by that step and no other', async () => {
  const study = await parseStudyflow(TWO_STEPS(WIRED_TO_FIRST), packages, {});

  expect(study.flowNodes.get('First')?.businessObject?.name).toBe('from-config');
  expect(study.flowNodes.get('Second')?.businessObject?.name, 'nothing wires it here').toBe('${label}');
  expect(study.parameters.unbound).toEqual(['label']);
});

test('config wired nowhere is the study\'s own, and every step reads it', async () => {
  const study = await parseStudyflow(TWO_STEPS(''), packages, {});

  expect(study.flowNodes.get('First')?.businessObject?.name).toBe('from-config');
  expect(study.flowNodes.get('Second')?.businessObject?.name).toBe('from-config');
  expect(study.parameters.unbound).toEqual([]);
});

test('a reference nothing has bound is reported, not silently emptied', async () => {
  const study = await parseStudyflow(NEEDS_TASK, packages, {});

  expect(study.parameters.unbound).toEqual(['task']);
});

test('a parameter the study declares nowhere still binds, and is named as undeclared', async () => {
  const study = await parseStudyflow(demoSource, packages, { arm: 'control' });

  expect(study.parameters.undeclared).toEqual(['arm']);
  expect(study.parameters.values.arm).toBe('control');
});
