
import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { readChoreographyBands } from '@core/document';
import { IdGenerator, ensureChoreographyParticipants } from '@canvas/index.ts';
import { swapChoreographyInitiator } from '@modeler/shape/choreographyParticipants';
import { loadSchemaModels, schemaPackages } from './schemas';

/** Choreography participant helpers: materializing two participants, and flipping `initiatingParticipantRef`. */

const models = loadSchemaModels();
const packages: Record<string, any> = schemaPackages(models);

const updater = {
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
  return { definitions, task, element: { businessObject: task }, ids: new IdGenerator() };
}

test('materializes two participants into a headless collaboration on first need', () => {
  const { definitions, task, ids } = build();

  const [top, bottom] = ensureChoreographyParticipants(task, ids)!;
  expect(top.name).toBe('Participant A');
  expect(bottom.name).toBe('Participant B');

  expect(task.get('participantRef')).toEqual([top, bottom]);
  expect(task.get('initiatingParticipantRef')).toBe(top);
  const collaboration = definitions.get('rootElements').find((r: any) => r.$type === 'bpmn:Collaboration');
  expect(collaboration).toBeTruthy();
  expect(collaboration.get('participants')).toEqual([top, bottom]);

  expect(readChoreographyBands(task)).toEqual({ top: 'Participant A', bottom: 'Participant B', initiator: 'top' });

  ensureChoreographyParticipants(task, ids);
  expect(collaboration.get('participants')).toHaveLength(2);
});

test('swap flips the initiating participant', () => {
  const { task, element, ids } = build();
  const [top, bottom] = ensureChoreographyParticipants(task, ids)!;
  expect(task.get('initiatingParticipantRef')).toBe(top);

  swapChoreographyInitiator(element, updater, ids);
  expect(task.get('initiatingParticipantRef')).toBe(bottom);
  expect(readChoreographyBands(task).initiator).toBe('bottom');

  swapChoreographyInitiator(element, updater, ids);
  expect(task.get('initiatingParticipantRef')).toBe(top);
});
