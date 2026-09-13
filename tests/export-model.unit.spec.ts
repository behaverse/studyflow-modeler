import { expect, test } from '@playwright/test';

import { getCatalog } from '@core/notation';
import { fakeExportModel, wrapperElement } from './exporterFixture';

/** The semantic model every interchange export reads (`buildExportModel`). */

test('building the export model leaves the catalog as it was', () => {
  // It lists an element's own attributes and its wrapper's. Adding the wrapper's to the catalog's list for the BPMN
  // type made every later write of, say, `instrument` land on the task instead of on its wrapper.
  const before = [...getCatalog().instanceAttributesOf('bpmn:Task')];
  const model = fakeExportModel([wrapperElement('bpmn:Task', 'cognitive:CognitiveTask', { id: 'T', instrument: 'jspsych' })]);

  expect(model.elements[0].attributes.instrument).toBe('jspsych');
  expect(getCatalog().instanceAttributesOf('bpmn:Task')).toEqual(before);
});
