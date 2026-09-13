
import { expect, test } from '@playwright/test';

import { studyflowToDefinitions, studyflowToXml, xmlToStudyflow } from '@core/document';
import { StudyflowElement } from '@core/element';
import { freshModdle } from './schemas';

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

  test('the element view reads and writes the two entries independently', async () => {
    const moddle = freshModdle();
    const definitions = studyflowToDefinitions(DOC, moddle);
    const proc = definitions.rootElements.find((r: any) => r.$type === 'bpmn:Process');
    const task = proc.flowElements.find((e: any) => e.id === 'T1');
    const handle = StudyflowElement.fromBusinessObject(task);

    expect(handle.getAttribute('documentation')).toBe('Prose about the step.');
    expect(handle.getAttribute('checklist')).toContain('- [x] consent approved');

    handle.setAttribute('documentation', 'New prose.');
    expect(handle.getAttribute('checklist')).toContain('- [x] consent approved');
    handle.setAttribute('checklist', '- [ ] only item');
    expect(handle.getAttribute('documentation')).toBe('New prose.');

    handle.setAttribute('checklist', '');
    expect(handle.getAttribute('checklist')).toBeUndefined();
    expect(handle.getAttribute('documentation')).toBe('New prose.');
  });
});
