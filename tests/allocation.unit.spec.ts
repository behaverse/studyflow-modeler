import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '@core/notation';
import { toModdlePackages } from '@core/notation/schemaFile';
import { StudyflowElement } from '@core/element';
import { validateAllocation } from '@runner/allocation';
import type { FlowNode } from '@runner/flow';
import { loadSchemaModels } from './schemas';

/** A RandomGateway's allocation attributes, against what the browser runner actually draws. */


const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const moddle = new BpmnModdle(packages) as any;

/** A RandomGateway carrying `attributes` on its extension wrapper, with two outgoing flows. */
function randomGateway(attributes: Record<string, string>, name?: string): FlowNode {
  const bo = moddle.create('bpmn:ExclusiveGateway', { id: 'Gateway_1', name });
  StudyflowElement.fromBusinessObject(bo).ensureExtension('cognitive:RandomGateway', moddle, {});
  const element = StudyflowElement.fromBusinessObject(bo);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return {
    id: 'Gateway_1',
    type: 'bpmn:ExclusiveGateway',
    extensionType: 'cognitive:RandomGateway',
    businessObject: bo,
    outgoing: ['Flow_1', 'Flow_2'],
    incoming: [],
    scopeId: 'Process_1',
  };
}

test.describe('RandomGateway allocation', () => {
  test('the schema defaults are what the runner draws, so they raise nothing', () => {
    // `probabilistic` + `uniform` IS an equal-chance draw over the outgoing flows.
    const issues = validateAllocation(
      randomGateway({ algorithm: 'probabilistic', probabilityFunction: 'uniform' }),
    );
    expect(issues).toEqual([]);
  });

  test('a gateway with no allocation attributes raises nothing', () => {
    expect(validateAllocation(randomGateway({}))).toEqual([]);
  });

  test('round-robin assignment is reported, because it needs the rest of the cohort', () => {
    const issues = validateAllocation(randomGateway({ algorithm: 'round-robin' }));

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].nodeId).toBe('Gateway_1');
    expect(issues[0].message).toContain('round-robin assignment');
    expect(issues[0].message).toContain('equal probability');
  });

  test('a non-uniform distribution is reported', () => {
    const issues = validateAllocation(randomGateway({ probabilityFunction: 'poisson' }));

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('a poisson distribution');
  });

  test('stratification is reported, and names the variable it would balance on', () => {
    const issues = validateAllocation(randomGateway({ stratifyBy: 'age_band' }));

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("stratification by 'age_band'");
  });

  test('everything unhonored is reported once, in one message', () => {
    const issues = validateAllocation(randomGateway({
      algorithm: 'round-robin',
      probabilityFunction: 'normal',
      stratifyBy: 'site',
    }));

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('round-robin assignment');
    expect(issues[0].message).toContain('a normal distribution');
    expect(issues[0].message).toContain("stratification by 'site'");
  });

  test('the message names the gateway a reader sees on the canvas', () => {
    const issues = validateAllocation(randomGateway({ stratifyBy: 'age_band' }, 'Randomized'));
    expect(issues[0].message).toContain("'Randomized'");
  });

  test('the stratified-allocation palette template is exactly what gets reported', () => {
    // The template ships with `stratifyBy: age_band`, so stamping it and running warns by design.
    const template = models
      .find((model) => model.prefix === 'cognitive')
      ?.templates?.find((t: any) => t.object?.['bpmn:name'] === 'Stratified allocation');
    expect(template, 'the cognitive schema ships a Stratified allocation template').toBeTruthy();

    const stratifyBy = (template as any).object.stratifyBy;
    expect(stratifyBy).toBeTruthy();
    expect(validateAllocation(randomGateway({ stratifyBy }))).toHaveLength(1);
  });
});
