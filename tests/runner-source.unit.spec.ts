import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { buildCatalog, setCatalog } from '../src/core/notation';
import { toModdlePackages } from '../src/core/notation/schemaFile';
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

test('the behaverse demo declares task and timeline, and runs the pair it is given', async () => {
  const study = await parseStudyflow(demoSource, packages, { task: 'BCS', timeline: 'XCIT_BCS_02' });

  expect(study.parameters.unbound).toEqual([]);
  expect(study.parameters.undeclared).toEqual([]);
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
  expect(study.flowNodes.get('Task')?.businessObject?.name).toBe('BCS / XCIT_BCS_02');
});

test('a parameter the run was launched without is reported, not silently emptied', async () => {
  const study = await parseStudyflow(demoSource, packages, { task: 'BCS' });

  expect(study.parameters.unbound).toEqual(['timeline']);
  expect(getBehaverseTaskPayload(study.flowNodes.get('Task') as FlowNode)?.scene).toBe('BCS');
});

test('a parameter the study declares nowhere still binds, and is named as undeclared', async () => {
  const study = await parseStudyflow(demoSource, packages, {
    task: 'BCS',
    timeline: 'XCIT_BCS_02',
    arm: 'control',
  });

  expect(study.parameters.undeclared).toEqual(['arm']);
  expect(study.parameters.values.arm).toBe('control');
});
