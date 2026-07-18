import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '../src/core/catalog';
import { studyflowToXml } from '../src/core/codec';
import { SCHEMAS } from '../src/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/core/schema';
import { StudyflowElement, createExtensionElement, getAttribute, getDefaults } from '../src/core/extensions';

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

/**
 * Wrapper precedence on read. moddle materializes every descriptor default on
 * a wrapper instance (as prototype values), so a bare wrapper "has" a value
 * for each defaulted trait attribute. Those materialized defaults must not
 * mask a value stored on the business object; pinned redefinitions must keep
 * winning over anything on the business object.
 */
test.describe('StudyflowElement.read — stored values vs wrapper defaults', () => {
  const EXAMPLES_DIR = path.join(process.cwd(), 'src/assets/examples');

  /** Load a bundled example through the codec into a moddle definitions tree. */
  const loadExample = async (file: string): Promise<any> => {
    const text = readFileSync(path.join(EXAMPLES_DIR, file), 'utf8');
    const xml = await studyflowToXml(text, moddle);
    const { rootElement } = await moddle.fromXML(xml);
    return rootElement;
  };

  const findById = (container: any, id: string): any => {
    for (const el of container?.flowElements ?? []) {
      if (el.id === id) return el;
      const nested = findById(el, id);
      if (nested) return nested;
    }
    return undefined;
  };

  const findInDefinitions = (definitions: any, id: string): any => {
    for (const root of definitions?.rootElements ?? []) {
      const found = findById(root, id);
      if (found) return found;
    }
    return undefined;
  };

  test('a stored trait value is not masked by defaults (Research_Agent completionCondition)', async () => {
    const definitions = await loadExample('agent_eval.studyflow');
    const agent = findInDefinitions(definitions, 'Research_Agent');
    expect(agent).toBeTruthy();
    // The value is stored as BPMN's own expression element on the business
    // object (no wrapper involved in the trait read)...
    expect(agent.get('completionCondition')?.body).toBe('answer != null');
    // ...and the resolved read unwraps it, not an empty trait default.
    expect(getAttribute(agent, 'exec:completionCondition')).toBe('answer != null');

    // With a wrapper attached, its materialized trait defaults must not mask
    // the stored business-object value either.
    const bo = moddle.create('bpmn:AdHocSubProcess', { id: 'Agent_0' });
    StudyflowElement.fromBusinessObject(bo).write('completionCondition', 'answer != null');
    createExtensionElement(bo, 'agentic:Agent', moddle, {});
    expect(getAttribute(bo, 'exec:completionCondition')).toBe('answer != null');
  });

  test('pinned wrapper defaults win over stale business-object values', () => {
    // functional subtypes pin operationType per verb; a stale value stored
    // on the business object must not shadow the pinned wrapper default.
    const map = moddle.create('bpmn:ServiceTask', { id: 'Map_1' });
    map.set('operationType', 'stale');
    createExtensionElement(map, 'functional:Map', moddle, {});
    expect(getAttribute(map, 'operationType')).toBe('map');
  });

  test('template-stamped values still appear (Reader stamps a path)', () => {
    // Mirrors createTemplateShape: catalog defaults + templateAttributes are
    // stamped through ensureExtension at creation time.
    const bo = moddle.create('bpmn:ServiceTask', { id: 'Reader_1' });
    const el = StudyflowElement.fromBusinessObject(bo);
    el.ensureExtension('datatrove:Reader', moddle, {
      ...getDefaults('datatrove:Reader'),
      className: 'CsvReader',
      path: 'data/raw/',
    });
    expect(el.read('className')).toBe('CsvReader');
    expect(el.read('path')).toBe('data/raw/');
  });

  test('trait defaults apply on bare elements; stored values win (completionCodeType)', () => {
    // A bare end event shows the studyflow trait default until a value is
    // stored.
    const bo = moddle.create('bpmn:EndEvent', { id: 'End_1' });
    expect(getAttribute(bo, 'completionCodeType')).toBe('none');

    const el = StudyflowElement.fromBusinessObject(bo);
    el.write('completionCodeType', 'static');
    expect(el.read('completionCodeType')).toBe('static');
  });
});
