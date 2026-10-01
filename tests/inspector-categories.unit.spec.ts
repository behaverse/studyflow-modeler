import { expect, test } from '@playwright/test';

import { getAttributesByCategory } from '@modeler/inspector/categories';
import { studyModel } from './schemas';

test('a tab lists id and name as order 0: before an attribute of order 1', () => {
  const model = studyModel(`id: D
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    P_1:
      type: DataObjectReference
      extensionElements:
        - type: studyflow:Parameters
          values: 'trials: 10'
`);
  const general = getAttributesByCategory(model, model.get('P_1')!)['General'].map((attrDef) => attrDef.ns?.name ?? attrDef.name);
  expect(general).toEqual(['bpmn:id', 'bpmn:name', 'studyflow:values']);
});
