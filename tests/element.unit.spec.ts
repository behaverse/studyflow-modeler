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

  test('a stored trait value is not masked by defaults (Per_Item iterate=items)', async () => {
    const definitions = await loadExample('agent_eval.studyflow');
    const each = findInDefinitions(definitions, 'Per_Item');
    expect(each).toBeTruthy();
    // The value is stored on the business object (no wrapper involved)...
    expect(each.get('functional:iterate')).toBe('items');
    // ...and the resolved read must return it, not the trait default `none`.
    expect(getAttribute(each, 'functional:iterate')).toBe('items');

    // With a wrapper attached, its materialized trait defaults must not mask
    // the stored business-object value either.
    const bo = moddle.create('bpmn:ServiceTask', { id: 'Op_0' });
    bo.set('functional:iterate', 'items');
    createExtensionElement(bo, 'functional:Map', moddle, {});
    expect(getAttribute(bo, 'functional:iterate')).toBe('items');
  });

  test('pinned wrapper defaults win over stale business-object values', () => {
    // functional subtypes pin operationType per verb, and pin
    // isDataOperation=true over the trait default (false).
    const map = moddle.create('bpmn:ServiceTask', { id: 'Map_1' });
    map.set('isDataOperation', false);
    createExtensionElement(map, 'functional:Map', moddle, {});
    expect(getAttribute(map, 'operationType')).toBe('map');
    expect(getAttribute(map, 'isDataOperation')).toBe(true);
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

  test('trait defaults apply on bare elements; stored values win (iterate)', () => {
    // No wrapper types redefine `iterate` anymore (a fan-out is a native
    // sub-process a template presets), so a bare element shows the
    // functional:Iteration trait default until a value is stored.
    const bo = moddle.create('bpmn:SubProcess', { id: 'Each_1' });
    expect(getAttribute(bo, 'iterate')).toBe('none');

    const el = StudyflowElement.fromBusinessObject(bo);
    el.write('iterate', 'items');
    expect(el.read('iterate')).toBe('items');
  });
});
