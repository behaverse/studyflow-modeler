import { expect, test } from '@playwright/test';

import { readChoreographyBands } from '@core/document';
import { IdGenerator, ensureChoreographyParticipants } from '@canvas/index.ts';
import { selectBandParticipant, swapChoreographyInitiator } from '@modeler/shape/choreographyParticipants';
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

test('clearing a band keeps a pool the canvas draws, even one with no process; an actor only bands named goes', () => {
  const moddle = freshModdle();
  const model = moddle.create('bpmn:Participant', { id: 'Model', name: 'Model' }); // a model's pool: drawn, no process
  const actor = moddle.create('bpmn:Participant', { id: 'Subject', name: 'Subject' }); // named only on a band
  const collaboration = moddle.create('bpmn:Collaboration', { id: 'C', participants: [model, actor] });
  const task = moddle.create('bpmn:ChoreographyTask', {
    id: 'Play',
    extensionElements: moddle.create('bpmn:ExtensionElements', { values: [moddle.create('cognitive:CognitiveTask', {})] }),
  });
  const process = moddle.create('bpmn:Process', { id: 'Proc', flowElements: [task] });
  const definitions = moddle.create('bpmn:Definitions', { id: 'Defs', rootElements: [collaboration, process] });
  for (const [child, parent] of [[model, collaboration], [actor, collaboration], [task, process], [collaboration, definitions], [process, definitions]]) {
    child.$parent = parent;
  }
  const canvas = { ...updater, get: (id: string) => (id === 'Model' ? {} : undefined) };
  const ids = new IdGenerator();

  task.set('participantRef', [model]);
  selectBandParticipant({ businessObject: task }, canvas, ids, 'bottom', null);
  expect(collaboration.get('participants')).toEqual([model, actor]);

  task.set('participantRef', [actor]);
  selectBandParticipant({ businessObject: task }, canvas, ids, 'bottom', null);
  expect(collaboration.get('participants')).toEqual([model]);
});
