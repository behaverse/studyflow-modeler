import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '@core/notation';
import { toModdlePackages } from '@core/notation/schemaFile';
import { declaredRuntime, studyflowToDefinitions } from '@core/document';
import { loadSchemaModels } from './schemas';

/** `studyflow run` reads `runtime` where the modeler writes it: on the `studyflow:Study` extension of the process. */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const moddle = new BpmnModdle(packages) as any;

function study(processBody: string): any {
  return studyflowToDefinitions(`id: rt
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
${processBody}
  flowElements:
    Start:
      type: StartEvent
`, moddle, () => {});
}

test.describe('declaredRuntime', () => {
  test('reads the Study extension, where the inspector stores it', () => {
    const definitions = study(`  extensionElements:
    - type: studyflow:Study
      runtime: local`);
    expect(declaredRuntime(definitions)).toBe('local');
  });

  test('falls back to the schema default when nothing declares it', () => {
    const definitions = study(`  extensionElements:
    - type: studyflow:Study`);
    expect(declaredRuntime(definitions)).toBe('cloud');
  });

  test('still honors a bare attribute on the process from older files', () => {
    const definitions = study(`  runtime: browser`);
    expect(declaredRuntime(definitions)).toBe('browser');
  });
});
