
import { expect, test } from '@playwright/test';

import { studyflowToXml, xmlToStudyflow } from '@core/document';
import { freshModdle } from '@tests/schemas';

/** The checklist is the `studyflow:checklist="true"`-marked entry of `bpmn:documentation`. */

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

test.describe('checklist as marked documentation', () => {
  test('serializes as a studyflow:checklist-marked bpmn:documentation entry, and reads back as the flat YAML pair', async () => {
    const xml = await studyflowToXml(DOC, freshModdle());
    expect(xml).toContain('<bpmn:documentation>Prose about the step.</bpmn:documentation>');
    expect(xml).toMatch(/<bpmn:documentation studyflow:checklist="true">- \[x\] consent approved/);
    expect(xml).not.toContain('studyflow:checklist="- [x]');
    expect(await xmlToStudyflow(xml, freshModdle())).toBe(DOC);
  });
});
