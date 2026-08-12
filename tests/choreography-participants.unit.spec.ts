
import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { readChoreographyBands } from '@behaverse/studyflow-core/document';
import { ensureChoreographyParticipants, swapChoreographyInitiator } from '../src/modeler/bpmn/choreographyParticipants';
import { toModdlePackages } from '@behaverse/studyflow-core/notation/schemaFile';
import { loadSchemaModels } from './schemas';

/** Choreography participant helpers: materializing two participants, and flipping `initiatingParticipantRef`. */

const models = loadSchemaModels();
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const fakeModeling = {
  updateModdleProperties: (_el: any, target: any, props: Record<string, any>) => {
    for (const [k, v] of Object.entries(props)) target.set(k, v);
  },
};

function build() {
  const moddle = new BpmnModdle(structuredClone(packages)) as any;
  const task = moddle.create('bpmn:ChoreographyTask', { id: 'Consent', name: 'Give consent' });
  const process = moddle.create('bpmn:Process', { id: 'Proc', flowElements: [task] });
  const definitions = moddle.create('bpmn:Definitions', { id: 'Defs', rootElements: [process] });
  task.$parent = process;
  process.$parent = definitions;
  definitions.$parent = null;
  const bpmnFactory = { create: (type: string, attrs: any) => moddle.create(type, attrs) };
  return { definitions, task, element: { businessObject: task }, bpmnFactory };
}

test('materializes two participants into a headless collaboration on first need', () => {
  const { definitions, task, element, bpmnFactory } = build();

  const [top, bottom] = ensureChoreographyParticipants(element, fakeModeling, bpmnFactory);
  expect(top.name).toBe('Participant A');
  expect(bottom.name).toBe('Participant B');

  expect(task.get('participantRef')).toEqual([top, bottom]);
  expect(task.get('initiatingParticipantRef')).toBe(top);
  const collaboration = definitions.get('rootElements').find((r: any) => r.$type === 'bpmn:Collaboration');
  expect(collaboration).toBeTruthy();
  expect(collaboration.get('participants')).toEqual([top, bottom]);

  expect(readChoreographyBands(task)).toEqual({ top: 'Participant A', bottom: 'Participant B', initiator: 'top' });

  ensureChoreographyParticipants(element, fakeModeling, bpmnFactory);
  expect(collaboration.get('participants')).toHaveLength(2);
});

test('swap flips the initiating participant', () => {
  const { task, element, bpmnFactory } = build();
  const [top, bottom] = ensureChoreographyParticipants(element, fakeModeling, bpmnFactory);
  expect(task.get('initiatingParticipantRef')).toBe(top);

  swapChoreographyInitiator(element, fakeModeling, bpmnFactory);
  expect(task.get('initiatingParticipantRef')).toBe(bottom);
  expect(readChoreographyBands(task).initiator).toBe('bottom');

  swapChoreographyInitiator(element, fakeModeling, bpmnFactory);
  expect(task.get('initiatingParticipantRef')).toBe(top);
});
