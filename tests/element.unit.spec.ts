import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '../src/lib/core/catalog';
import { SCHEMAS } from '../src/lib/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/lib/core/schema';
import { StudyflowElement, createExtensionElement } from '../src/lib/core/extensions';

/**
 * Direct coverage of the StudyflowElement resolution table — reads and writes
 * across the business object, an extension wrapper, and a body-wrapped child —
 * exercised with the DirectWriter (no bpmn-js), against plain moddle objects.
 * This is the logic that previously had no unit test.
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');

const models = SCHEMAS.map(({ prefix }) =>
  fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
);

// Install the catalog the handle reads through, and a moddle to build objects with.
setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const moddle = new BpmnModdle(packages) as any;

test.describe('StudyflowElement', () => {
  test('reads and writes a BPMN-native attribute', () => {
    const bo = moddle.create('bpmn:Task', { id: 'Task_1', name: 'original' });
    const el = StudyflowElement.fromBusinessObject(bo);

    expect(el.read('bpmn:name')).toBe('original');
    el.write('bpmn:name', 'renamed');
    expect(el.read('bpmn:name')).toBe('renamed');
    expect(bo.name).toBe('renamed');
  });

  test('resolves an attribute stored on an extension wrapper', () => {
    const bo = moddle.create('bpmn:Task', { id: 'Task_2' });
    createExtensionElement(bo, 'cognitive:CognitiveTask', moddle, {});
    const el = StudyflowElement.fromBusinessObject(bo);

    // `instrument` lives on the cognitive:CognitiveTask wrapper, not the BO.
    el.write('instrument', 'jsPsych');
    expect(el.read('instrument')).toBe('jsPsych');

    const wrapper = bo.extensionElements.values.find((v: any) => v.$type === 'cognitive:CognitiveTask');
    expect(wrapper).toBeTruthy();
    expect(wrapper.get('instrument')).toBe('jsPsych');
  });

  test('unwraps a body-wrapped attribute transparently on read', () => {
    const bo = moddle.create('bpmn:Task', { id: 'Task_3' });
    createExtensionElement(bo, 'cognitive:CognitiveTask', moddle, {});
    const el = StudyflowElement.fromBusinessObject(bo);

    // `configurations` is a body wrapper (cognitive:Configurations#value).
    el.write('configurations', 'trials: 10');
    expect(el.read('configurations')).toBe('trials: 10');
  });

  test('attributes() lists the catalog-declared attributes of the wrapper', () => {
    const bo = moddle.create('bpmn:Task', { id: 'Task_4' });
    const wrapper = createExtensionElement(bo, 'cognitive:CognitiveTask', moddle, {});
    const names = StudyflowElement.fromBusinessObject(wrapper).attributes().map((a) => a.ns.localName);
    expect(names).toContain('instrument');
    expect(names).toContain('configurations');
  });

  test('fromBusinessObject accepts a bpmn-js element and unwraps it', () => {
    const bo = moddle.create('bpmn:Task', { id: 'Task_5', name: 'wrapped' });
    const fakeElement = { businessObject: bo };
    expect(StudyflowElement.fromBusinessObject(fakeElement).read('bpmn:name')).toBe('wrapped');
  });
});
