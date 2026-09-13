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

test('a task keeps its software in BPMN\'s own form: `implementation` an attribute, a script a child', async () => {
  const CASES: Array<[string, string, string, string]> = [
    ...NATIVE_TYPES.map((taskType): [string, string, string, string] => [taskType, 'implementation', REF, `implementation="${REF}"`]),
    ['bpmn:ScriptTask', 'bpmn:script', 'print(42)', '<bpmn:script>print(42)</bpmn:script>'],
  ];
  for (const [taskType, attribute, value, native] of CASES) {
    const xml = await serialized(taskType, attribute, value);
    expect(xml, taskType).toContain(native);
    expect(xml, taskType).not.toMatch(/studyflow:(implementation|script)/);
  }
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

test('the Execution tab is for what runs or holds state: activities and the study, not gateways or events', () => {
  const CASES: Array<[string, boolean]> = [
    ['bpmn:Task', true],
    ['bpmn:SubProcess', true],
    ['bpmn:Process', true],
    ['bpmn:ExclusiveGateway', false],
    ['bpmn:StartEvent', false],
  ];
  for (const [type, hasTab] of CASES) {
    expect('Execution' in getAttributesByCategory(moddle.create(type, { id: 'T_3' })), type).toBe(hasTab);
  }
});
