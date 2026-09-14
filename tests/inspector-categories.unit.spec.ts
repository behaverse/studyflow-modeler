import { expect, test } from '@playwright/test';

import { getAttributesByCategory } from '@modeler/inspector/categories';
import { freshModdle } from './schemas';

test('a tab lists id and name as order 0: before an attribute of order 1', () => {
  const moddle = freshModdle();
  const parameters = moddle.create('bpmn:DataObjectReference', {
    id: 'P_1',
    extensionElements: moddle.create('bpmn:ExtensionElements', {
      values: [moddle.create('studyflow:Parameters', { values: 'trials: 10' })],
    }),
  });
  const general = getAttributesByCategory(parameters)['General'].map((attrDef) => attrDef.ns?.name ?? attrDef.name);
  expect(general).toEqual(['bpmn:id', 'bpmn:name', 'studyflow:values']);
});
