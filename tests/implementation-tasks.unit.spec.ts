import { expect, test } from '@playwright/test';

import { StudyflowElement, getAttribute } from '@core/element';
import { getAttributesByCategory } from '@modeler/inspector/categories';
import { freshModdle } from './schemas';

/** The executable surface across the task family. */

const moddle = freshModdle();

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
