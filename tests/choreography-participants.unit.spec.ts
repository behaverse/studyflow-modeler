import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { readChoreographyBands } from '../src/core/codec/choreography';
import { ensureChoreographyParticipants, swapChoreographyInitiator } from '../src/modeler/models/choreographyParticipants';
import { SCHEMAS } from '../src/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/core/schema';

/**
 * Model-level guarantees for the choreography participant helpers the modeler's
 * label editor and context pad drive: a fresh task materializes two
 * participants into a headless collaboration and references them natively, and
 * the initiator flip flips `initiatingParticipantRef`. Uses a fake `modeling`
 * that applies moddle properties directly, so it needs no bpmn-js / DOM.
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');
const models = SCHEMAS.map(({ prefix }) =>
  fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
);
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

/** Minimal stand-ins for bpmn-js `modeling` and `bpmnFactory`. */
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

  // The task references them natively; they live in a collaboration root (a
  // Participant is not a RootElement).
  expect(task.get('participantRef')).toEqual([top, bottom]);
  expect(task.get('initiatingParticipantRef')).toBe(top);
  const collaboration = definitions.get('rootElements').find((r: any) => r.$type === 'bpmn:Collaboration');
  expect(collaboration).toBeTruthy();
  expect(collaboration.get('participants')).toEqual([top, bottom]);

  // The shared reader sees them as bands, top-initiated.
  expect(readChoreographyBands(task)).toEqual({ top: 'Participant A', bottom: 'Participant B', initiator: 'top' });

  // Calling again is idempotent — no duplicate participants.
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
