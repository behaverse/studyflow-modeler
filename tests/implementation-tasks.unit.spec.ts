import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '../src/core/notation';
import { toModdlePackages } from '../src/core/notation/schemaFile';
import { StudyflowElement, getAttribute } from '../src/core/element';
import { getAttributesByCategory } from '../src/modeler/inspector/categories';
import { loadSchemaModels } from './schemas';

/** The executable surface across the task family. */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const moddle = new BpmnModdle(packages) as any;

const REF = 'python://analysis.summarize@1.2';

const NATIVE_TYPES = [
  'bpmn:ServiceTask',
  'bpmn:UserTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:BusinessRuleTask',
];

async function serialized(taskType: string, attribute: string, value: string): Promise<string> {
  const task = moddle.create(taskType, { id: 'T_1' });
  StudyflowElement.fromBusinessObject(task).setAttribute(attribute, value);
  expect(getAttribute(task, attribute)).toBe(value);

  const process = moddle.create('bpmn:Process', { id: 'P_1', flowElements: [task] });
  const definitions = moddle.create('bpmn:Definitions', { id: 'D_1', rootElements: [process] });
  const { xml } = await moddle.toXML(definitions);
  return xml;
}

for (const taskType of NATIVE_TYPES) {
  test(`${taskType} serializes implementation as the native attribute`, async () => {
    const xml = await serialized(taskType, 'implementation', REF);
    expect(xml).toContain(`implementation="${REF}"`);
    expect(xml).not.toContain('studyflow:implementation');
  });
}

test('implementation round-trips through XML', async () => {
  const xml = await serialized('bpmn:ServiceTask', 'implementation', REF);
  const { rootElement } = await moddle.fromXML(xml);
  const task = rootElement.rootElements[0].flowElements[0];
  expect(getAttribute(task, 'implementation')).toBe(REF);
});

test('bpmn:ScriptTask serializes its inline script as the native child', async () => {
  const xml = await serialized('bpmn:ScriptTask', 'bpmn:script', 'print(42)');
  expect(xml).toContain('<bpmn:script>print(42)</bpmn:script>');

  const { rootElement } = await moddle.fromXML(xml);
  const task = rootElement.rootElements[0].flowElements[0];
  expect(getAttribute(task, 'script')).toBe('print(42)');
});

test('the inspector offers implementation on the native types, script on script tasks', () => {
  const executionNames = (taskType: string) =>
    (getAttributesByCategory(moddle.create(taskType, { id: 'T_2' }))['Execution'] ?? [])
      .map((attr: any) => attr.ns?.localName ?? attr.name);

  for (const taskType of NATIVE_TYPES) {
    expect(executionNames(taskType), taskType).toContain('implementation');
  }
  const script = executionNames('bpmn:ScriptTask');
  expect(script).toContain('script');
  expect(script).not.toContain('implementation');
});

test('a Behaverse task names its software through behaverseScene, not implementation', () => {
  // The extension carries the fields; the host is a plain `bpmn:Task`.
  const fieldsOf = (extensionType: string, properties: Record<string, unknown> = {}) => {
    const task = moddle.create('bpmn:Task', { id: 'T_3' });
    task.extensionElements = moddle.create('bpmn:ExtensionElements', {
      values: [moddle.create(extensionType, properties)],
    });
    return Object.values(getAttributesByCategory(task))
      .flat()
      .map((attr: any) => attr.ns?.localName ?? attr.name);
  };

  // The contrast is the point: the parent offers it, the Behaverse subtype pins it away.
  expect(fieldsOf('cognitive:CognitiveTask')).toContain('implementation');

  const behaverse = fieldsOf('cognitive:BehaverseTask', { behaverseScene: 'NB' });
  expect(behaverse).toContain('behaverseScene');
  expect(behaverse, 'pinned out: behaverseScene says it instead').not.toContain('implementation');
});
