
import { expect, test } from '@playwright/test';

import { xmlOf, yamlOf } from '@tests/schemas';

/** The checklist is an attribute of its element, `studyflow:checklist`, beside the prose of its documentation. */

const DOC = `id: checklist_probe
schemas:
  studyflow: http://behaverse.org/schemas/studyflow/v1

P:
  type: Process
  elements:
    T1:
      type: Task
      checklist: |-
        - [x] consent approved
        - [ ] pilot reviewed
      documentation: Prose about the step.
`;

test('a checklist is written as an attribute of its element, which BPMN\'s schema allows, and reads back as the YAML pair', async () => {
  const xml = await xmlOf(DOC);
  expect(xml).toContain('<bpmn:documentation>Prose about the step.</bpmn:documentation>');
  expect(xml).toContain('studyflow:checklist="- [x] consent approved&#10;- [ ] pilot reviewed"');
  expect(await yamlOf(xml)).toBe(DOC);
});
