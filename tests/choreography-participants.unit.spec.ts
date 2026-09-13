import { expect, test } from '@playwright/test';

import { readChoreographyBands } from '@core/document';
import { IdGenerator, ensureChoreographyParticipants } from '@canvas/index.ts';
import { swapChoreographyInitiator } from '@modeler/shape/choreographyParticipants';
import { freshModdle } from './schemas';

/** Flipping a choreography task's `initiatingParticipantRef`. Materializing the pair is the canvas's (`packages/canvas/tests/canvas.unit.spec.ts`). */

const updater = {
  updateModdleProperties: (_el: any, target: any, props: Record<string, any>) => {
    for (const [k, v] of Object.entries(props)) target.set(k, v);
  },
};

function build() {
  const moddle = freshModdle();
  const task = moddle.create('bpmn:ChoreographyTask', { id: 'Consent', name: 'Give consent' });
  const process = moddle.create('bpmn:Process', { id: 'Proc', flowElements: [task] });
  const definitions = moddle.create('bpmn:Definitions', { id: 'Defs', rootElements: [process] });
  task.$parent = process;
  process.$parent = definitions;
  definitions.$parent = null;
  return { definitions, task, element: { businessObject: task }, ids: new IdGenerator() };
}

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
