
import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '@core/notation';
import { studyflowToXml } from '@core/document';
import { toModdlePackages } from '@core/notation/schemaFile';
import { StudyflowElement, getAttribute, getDefaults } from '@core/element';
import { extensionValueWins } from '@core/element/handle';
import { loadSchemaModels } from './schemas';
import { exampleStudyflow } from './utils';

/** The StudyflowElement resolution table across business object, extension wrapper, and body-wrapped child. */


const models = loadSchemaModels();

setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const moddle = new BpmnModdle(packages) as any;

test.describe('StudyflowElement', () => {
  test('reads and writes a BPMN-native attribute', () => {
    const bo = moddle.create('bpmn:Task', { id: 'Task_1', name: 'original' });
    const el = StudyflowElement.fromBusinessObject(bo);

    expect(el.getAttribute('bpmn:name')).toBe('original');
    el.setAttribute('bpmn:name', 'renamed');
    expect(el.getAttribute('bpmn:name')).toBe('renamed');
    expect(bo.name).toBe('renamed');
  });

  test('resolves an attribute stored on an extension wrapper', () => {
    const bo = moddle.create('bpmn:Task', { id: 'Task_2' });
    StudyflowElement.fromBusinessObject(bo).ensureExtension('cognitive:CognitiveTask', moddle, {});
    const el = StudyflowElement.fromBusinessObject(bo);

    el.setAttribute('instrument', 'jsPsych');
    expect(el.getAttribute('instrument')).toBe('jsPsych');

    const wrapper = bo.extensionElements.values.find((v: any) => v.$type === 'cognitive:CognitiveTask');
    expect(wrapper).toBeTruthy();
    expect(wrapper.get('instrument')).toBe('jsPsych');
  });

  test('unwraps a body-wrapped attribute transparently on read', () => {
    const bo = moddle.create('bpmn:Task', { id: 'Task_3' });
    StudyflowElement.fromBusinessObject(bo).ensureExtension('cognitive:CognitiveTask', moddle, {});
    const el = StudyflowElement.fromBusinessObject(bo);

    el.setAttribute('configurations', 'trials: 10');
    expect(el.getAttribute('configurations')).toBe('trials: 10');
  });

  test('attributes() lists the catalog-declared attributes of the wrapper', () => {
    const bo = moddle.create('bpmn:Task', { id: 'Task_4' });
    const wrapper = StudyflowElement.fromBusinessObject(bo).ensureExtension('cognitive:CognitiveTask', moddle, {});
    const names = StudyflowElement.fromBusinessObject(wrapper).attributes().map((a) => a.ns.localName);
    expect(names).toContain('instrument');
    expect(names).toContain('configurations');
  });

  test('fromBusinessObject accepts a bpmn-js element and unwraps it', () => {
    const bo = moddle.create('bpmn:Task', { id: 'Task_5', name: 'wrapped' });
    const fakeElement = { businessObject: bo };
    expect(StudyflowElement.fromBusinessObject(fakeElement).getAttribute('bpmn:name')).toBe('wrapped');
  });
});

/** moddle materializes descriptor defaults on a wrapper instance, so a bare wrapper "has" every trait default. */
test.describe('StudyflowElement.read — stored values vs wrapper defaults', () => {
  const loadExample = async (file: string): Promise<any> => {
    const text = await exampleStudyflow(file, moddle);
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
    const definitions = await loadExample('agent_eval.studyflow.png');
    const agent = findInDefinitions(definitions, 'Research_Agent');
    expect(agent).toBeTruthy();
    expect(agent.get('completionCondition')?.body).toBe('answer != null');
    expect(getAttribute(agent, 'studyflow:completionCondition')).toBe('answer != null');

    const bo = moddle.create('bpmn:AdHocSubProcess', { id: 'Agent_0' });
    StudyflowElement.fromBusinessObject(bo).setAttribute('completionCondition', 'answer != null');
    StudyflowElement.fromBusinessObject(bo).ensureExtension('agentic:Agent', moddle, {});
    expect(getAttribute(bo, 'studyflow:completionCondition')).toBe('answer != null');
  });

  test('pinned wrapper defaults win over stale business-object values', () => {
    const task = moddle.create('bpmn:Task', { id: 'NBack_1' });
    task.set('instrument', 'stale');
    StudyflowElement.fromBusinessObject(task).ensureExtension('cognitive:BehaverseTask', moddle, {});
    expect(getAttribute(task, 'instrument')).toBe('behaverse');
  });

  test('template-stamped values still appear (a Recording stamps its layout)', () => {
    // Mirrors createTemplateShape: catalog defaults + templateAttributes stamped through ensureExtension.
    const bo = moddle.create('bpmn:DataStoreReference', { id: 'Recording_1' });
    const el = StudyflowElement.fromBusinessObject(bo);
    el.ensureExtension('eeg:Recording', moddle, {
      ...getDefaults('eeg:Recording'),
      channels: 16,
      samplingRateHz: 125,
    });
    expect(el.getAttribute('channels')).toBe(16);
    expect(el.getAttribute('samplingRateHz')).toBe(125);
  });

  test('trait defaults apply on bare elements; stored values win (completionCodeType)', () => {
    const bo = moddle.create('bpmn:EndEvent', { id: 'End_1' });
    expect(getAttribute(bo, 'completionCodeType')).toBe('none');

    const el = StudyflowElement.fromBusinessObject(bo);
    el.setAttribute('completionCodeType', 'static');
    expect(el.getAttribute('completionCodeType')).toBe('static');
  });
});

test.describe('extensionValueWins: wrapper vs business object', () => {
  const spec = (over: Record<string, any> = {}) => ({
    name: 'thing',
    ns: { name: 'studyflow:thing', prefix: 'studyflow', localName: 'thing' },
    type: 'String',
    ...over,
  }) as any;

  const withStored = (values: Record<string, any>) => ({ ...values });
  const withNothing = () => ({});

  test('a pinned redefinition wins even when the BO has a stored value', () => {
    expect(extensionValueWins(
      spec({ meta: { pinned: true } }),
      withStored({ thing: 'from wrapper' }),
      'thing',
      withStored({ thing: 'from bo' }),
      'thing',
    )).toBe(true);
  });

  test('an explicitly stored wrapper value wins over a stored BO value', () => {
    expect(extensionValueWins(
      spec(),
      withStored({ thing: 'from wrapper' }),
      'thing',
      withStored({ thing: 'from bo' }),
      'thing',
    )).toBe(true);
  });

  test('a stored BO value beats a wrapper default', () => {
    const wrapperWithOnlyADefault = Object.create({ thing: 'materialized default' });
    expect(extensionValueWins(
      spec(),
      wrapperWithOnlyADefault,
      'thing',
      withStored({ thing: 'from bo' }),
      'thing',
    )).toBe(false);
  });

  test('a wrapper default wins when the BO stores nothing either', () => {
    const wrapperWithOnlyADefault = Object.create({ thing: 'redefined default' });
    expect(extensionValueWins(
      spec(),
      wrapperWithOnlyADefault,
      'thing',
      withNothing(),
      'thing',
    )).toBe(true);
  });

  test('an isMany property moddle initialized to [] is not a stored value', () => {
    expect(extensionValueWins(
      spec({ isMany: true }),
      withStored({ things: [] }),
      'things',
      withStored({ things: ['from bo'] }),
      'things',
    )).toBe(false);
  });

  test('no wrapper definition means the business object, always', () => {
    expect(extensionValueWins(undefined, withStored({ thing: 'x' }), 'thing', withNothing(), 'thing'))
      .toBe(false);
  });
});
