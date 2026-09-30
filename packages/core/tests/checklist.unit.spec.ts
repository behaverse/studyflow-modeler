
import { expect, test } from '@playwright/test';

import { studyflowToXml, xmlToStudyflow } from '@core/document';
import { freshModdle } from '@tests/schemas';

/** The checklist is an attribute of its element, `studyflow:checklist`, beside the prose of its documentation. */

const DOC = `id: checklist_probe
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    T1:
      type: Task
      documentation: Prose about the step.
      checklist: |-
        - [x] consent approved
        - [ ] pilot reviewed
`;

test('a checklist is written as an attribute of its element, which BPMN\'s schema allows, and reads back as the YAML pair', async () => {
  const xml = await studyflowToXml(DOC, freshModdle());
  expect(xml).toContain('<bpmn:documentation>Prose about the step.</bpmn:documentation>');
  expect(xml).toContain('studyflow:checklist="- [x] consent approved&#10;- [ ] pilot reviewed"');
  expect(await xmlToStudyflow(xml, freshModdle())).toBe(DOC);
});
