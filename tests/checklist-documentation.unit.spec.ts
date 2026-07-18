import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { SCHEMAS } from '../src/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/core/schema';
import { buildCatalog, setCatalog } from '../src/core/catalog';
import { studyflowToXml, xmlToStudyflow } from '../src/core/codec';
import { fromBusinessObject } from '../src/core/extensions/element';
import { studyflowToDefinitions } from '../src/core/codec/deserialize';

/**
 * The checklist is the `studyflow:checklist="true"`-marked entry of the
 * element's `bpmn:documentation` list: the text lives in BPMN's own
 * container (visible in any tool), the Boolean marker is the only extension,
 * and YAML/inspector keep the flat `documentation:` / `checklist:` pair.
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');
const models = SCHEMAS.map(({ prefix }) =>
  fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
);
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
    // No element-level checklist attribute remains.
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
    const handle = fromBusinessObject(task);

    expect(handle.read('documentation')).toBe('Prose about the step.');
    expect(handle.read('checklist')).toContain('- [x] consent approved');

    // Writes stay independent: editing one preserves the other.
    handle.write('documentation', 'New prose.');
    expect(handle.read('checklist')).toContain('- [x] consent approved');
    handle.write('checklist', '- [ ] only item');
    expect(handle.read('documentation')).toBe('New prose.');

    // Clearing the checklist removes only the marked entry.
    handle.write('checklist', '');
    expect(handle.read('checklist')).toBeUndefined();
    expect(handle.read('documentation')).toBe('New prose.');
  });
});
