import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '../src/core/catalog';
import { toModdlePackages } from '../src/core/schema';
import { StudyflowElement, getAttribute } from '../src/core/extensions';
import { getAttributesByCategory } from '../src/modeler/models/inspector/categories';
import { loadSchemaModels } from './schemas';

/**
 * The executable surface across the task family. The Implementation trait
 * redefines BPMN's own `implementation` attribute on every task type that
 * natively carries one, so the value serializes as the plain native
 * attribute. A ScriptTask carries its computation inline instead, as the
 * standard defines it: the native `script` child, surfaced by the Script
 * trait — no `implementation` there. Both read back through the same
 * `getAttribute` path the runner uses.
 */

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

/** Write `attribute` on a fresh task of `taskType` and serialize the diagram. */
async function serialized(taskType: string, attribute: string, value: string): Promise<string> {
  const task = moddle.create(taskType, { id: 'T_1' });
  StudyflowElement.fromBusinessObject(task).write(attribute, value);
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
