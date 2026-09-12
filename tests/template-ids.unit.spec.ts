import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { studyflowToDefinitions } from '@core/document';
import type { Template } from '@core/notation';
import type { EditorModel } from '@modeler/editor/port';
import { createTemplateElement } from '@modeler/templates/factory';
import { loadSchemaModels, schemaPackages } from './schemas';

/** A template dropped into a document that already holds some of its ids: which ids move, and which text follows them. */

const moddle = new BpmnModdle(schemaPackages(loadSchemaModels())) as any;
let minted = 0;
const model = { moddle: () => moddle, ids: { nextPrefixed: (prefix: string) => `${prefix}${++minted}` } } as unknown as EditorModel;

const LOOP: Template = {
  id: 'test::template:1',
  name: 'Loop',
  bpmnType: 'bpmn:SubProcess',
  elements: {
    Loop: {
      type: 'SubProcess',
      documentation: 'Gate decides when Work stops.',
      flowElements: {
        Work: { type: 'Task', name: 'Work, then ask {Gate}' },
        Gate: { type: 'ExclusiveGateway', name: 'Gate' },
        F1: 'Work -> Gate',
        F2: { sourceRef: 'Gate', targetRef: 'Work', conditionExpression: "state.trace.count('Gate') < 3" },
      },
    },
  },
};

const holding = (...ids: string[]) =>
  studyflowToDefinitions({ definitions: {}, elements: Object.fromEntries(ids.map((id) => [id, { type: 'Task' }])) }, moddle);

test('ids the document does not hold are kept', () => {
  const { shape, flow } = createTemplateElement(model, LOOP, holding('Other'));
  expect((shape.businessObject as any).id).toBe('Loop');
  expect(flow.nodes.map((node) => node.businessObject.id)).toEqual(['Work', 'Gate']);
});

test('a held id is suffixed, and only code that names it follows: expressions and placeholders, not prose', () => {
  const { shape, flow } = createTemplateElement(model, LOOP, holding('Gate'));
  const [work, gate] = flow.nodes.map((node) => node.businessObject);
  const back = flow.flows.find((sequenceFlow) => sequenceFlow.sourceRef === gate);

  expect(gate.id).toMatch(/^Gate_\d+$/);
  expect(work.id).toBe('Work');
  expect(back.conditionExpression.body).toBe(`state.trace.count('${gate.id}') < 3`);
  expect(work.name).toBe(`Work, then ask {${gate.id}}`);
  expect(gate.name).toBe('Gate');
  expect((shape.businessObject as any).documentation[0].text).toBe('Gate decides when Work stops.');
});
