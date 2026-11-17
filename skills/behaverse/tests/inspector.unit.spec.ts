import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { getAttributesByCategory } from '@modeler/inspector/categories';
import { studyModel } from '@tests/schemas';

test('the inspector files a task\'s build under Execution, as Build, after its instrument and timeline', () => {
  const model = studyModel(readFileSync('skills/behaverse/examples/bot_random.studyflow.yaml', 'utf8'));
  const execution = getAttributesByCategory(model, model.get('Warmup_1Back')!)['Execution'];
  expect(execution.map((attrDef) => [attrDef.ns.name, attrDef.meta?.label])).toEqual([
    ['behaverse:instrument', undefined],
    ['behaverse:timeline', undefined],
    ['behaverse:implementation', 'Build'],
  ]);
});
