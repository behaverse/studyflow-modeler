import { expect, test } from '@playwright/test';

import { ensureChoreographyParticipants, readChoreographyBands } from '@core/document';
import { Study } from '@canvas/index.ts';
import { selectBandParticipant, swapChoreographyInitiator } from '@modeler/shape/choreographyParticipants';
import { freshModdle } from './schemas';

/** Flipping a choreography task's `initiatingParticipantRef`. Materializing the pair is core's (`packages/core/tests/choreography-root.unit.spec.ts`). */

function build() {
  const moddle = freshModdle();
  const task = moddle.create('bpmn:ChoreographyTask', { id: 'Consent', name: 'Give consent' });
  const process = moddle.create('bpmn:Process', { id: 'Proc', flowElements: [task] });
  const definitions = moddle.create('bpmn:Definitions', { id: 'Defs', rootElements: [process] });
  task.$parent = process;
  process.$parent = definitions;
  return { task, element: { businessObject: task }, study: Study.fromDefinitions(definitions) };
}

test('swap flips the initiating participant', () => {
  const { task, element, study } = build();
  study.edit('Consent', (writer) => ensureChoreographyParticipants(task, writer.ids));
  const [top, bottom] = task.get('participantRef');
  expect(task.get('initiatingParticipantRef')).toBe(top);
  const swap = () => study.edit('Consent', (writer) => swapChoreographyInitiator(element, writer));

  swap();
  expect(task.get('initiatingParticipantRef')).toBe(bottom);
  expect(readChoreographyBands(task).initiator).toBe('bottom');

  swap();
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
  const study = Study.fromDefinitions(definitions);
  const canvas = { get: (id: string) => (id === 'Model' ? {} : undefined) };
  const clearBottom = () => study.edit('Play', (writer) => selectBandParticipant({ businessObject: task }, writer, canvas, 'bottom', null));

  task.set('participantRef', [model]);
  clearBottom();
  expect(collaboration.get('participants')).toEqual([model, actor]);

  task.set('participantRef', [actor]);
  clearBottom();
  expect(collaboration.get('participants')).toEqual([model]);
});
