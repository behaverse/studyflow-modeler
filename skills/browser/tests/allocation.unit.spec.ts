import { expect, test } from '@playwright/test';

import { StudyflowElement } from '@core/element';
import { validateAllocation } from '@runner/allocation';
import type { FlowNode } from '@runner/flow';
import { freshModdle, loadSchemaModels } from '@tests/schemas';

/** A RandomGateway's allocation attributes, against what the browser runner actually draws. */

const models = loadSchemaModels();
const moddle = freshModdle();

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
    parameters: {},
    outgoing: ['Flow_1', 'Flow_2'],
    incoming: [],
    scopeId: 'Process_1',
  };
}

test('an allocation the runner does not draw is one warning naming all of it; an equal-chance draw raises nothing', () => {
  // The palette's Stratified allocation template writes `stratifyBy`, the attribute the runner reads.
  const template = models
    .find((model) => model.prefix === 'cognitive')
    ?.templates?.find((t) => t.elements?.Stratified_allocation)?.elements?.Stratified_allocation;
  const stratifyBy = template?.extensionElements?.[0]?.stratifyBy;
  expect(stratifyBy, 'the cognitive schema\'s Stratified allocation template sets stratifyBy').toBeTruthy();

  // `reported`: fragments of the one warning's message; none, no warning.
  const CASES: { label: string; attributes: Record<string, string>; name?: string; reported?: string[] }[] = [
    { label: 'the schema defaults, `simple` and `1:1`: an equal-chance draw', attributes: { algorithm: 'simple', allocationRatio: '1:1' } },
    { label: 'no allocation attributes', attributes: {} },
    {
      label: 'block assignment, which needs the rest of the cohort',
      attributes: { algorithm: 'block' },
      reported: ['block assignment', 'equal probability'],
    },
    { label: 'an unequal allocation ratio', attributes: { allocationRatio: '2:1' }, reported: ['a 2:1 allocation ratio'] },
    { label: 'stratification, by the variable named', attributes: { stratifyBy: 'age_band' }, reported: ["stratification by 'age_band'"] },
    {
      label: 'everything unhonored, in one message',
      attributes: { algorithm: 'minimization', allocationRatio: '2:1', stratifyBy: 'site' },
      reported: ['minimization assignment', 'a 2:1 allocation ratio', "stratification by 'site'"],
    },
    { label: 'the gateway named as the canvas shows it', attributes: { stratifyBy: 'age_band' }, name: 'Randomized', reported: ["'Randomized'"] },
    { label: 'the Stratified allocation template', attributes: { stratifyBy }, reported: [`stratification by '${stratifyBy}'`] },
  ];

  for (const { label, attributes, name, reported } of CASES) {
    const issues = validateAllocation(randomGateway(attributes, name));
    if (!reported) {
      expect(issues, label).toEqual([]);
      continue;
    }
    expect(issues, label).toHaveLength(1);
    expect(issues[0], label).toMatchObject({ severity: 'warning', nodeId: 'Gateway_1' });
    for (const fragment of reported) expect(issues[0].message, label).toContain(fragment);
  }
});
