
import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@behaverse/studyflow-core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@behaverse/studyflow-core/notation';
import { studyflowToDefinitions, studyflowToXml, xmlToStudyflow } from '@behaverse/studyflow-core/document';
import { StudyflowElement } from '@behaverse/studyflow-core/element';
import { loadSchemaModels } from './schemas';

/** The checklist is the `studyflow:checklist="true"`-marked entry of `bpmn:documentation`. */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const DOC = `id: checklist_probe
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: bpmn:Process
  flowElements:
    T1:
      type: bpmn:Task
      documentation: Prose about the step.
      checklist: |-
        - [x] consent approved
        - [ ] pilot reviewed
    End:
      type: bpmn:EndEvent
    F1:
      type: bpmn:SequenceFlow
      sourceRef: T1
      targetRef: End
`;

test.describe('checklist as marked documentation', () => {
  test('serializes as a studyflow:checklist-marked bpmn:documentation entry', async () => {
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const xml = await studyflowToXml(DOC, moddle);
    expect(xml).toContain('<bpmn:documentation>Prose about the step.</bpmn:documentation>');
    expect(xml).toMatch(/<bpmn:documentation studyflow:checklist="true">- \[x\] consent approved/);
    expect(xml).not.toContain('studyflow:checklist="- [x]');
  });

  test('round-trips through XML back to the flat YAML pair', async () => {
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const xml = await studyflowToXml(DOC, moddle);
    const back = await xmlToStudyflow(xml, new BpmnModdle(structuredClone(packages)) as any);
    expect(back).toContain('documentation: Prose about the step.');
    expect(back).toContain('checklist: |-');
    expect(back).toContain('- [x] consent approved');
  });

  test('the element view reads and writes the two entries independently', async () => {
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
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
