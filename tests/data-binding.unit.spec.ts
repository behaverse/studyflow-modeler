import { expect, test } from '@playwright/test';

import { Study } from '@canvas/index.ts';
import type { Editor } from '@modeler/editor/port';
import { runUpdateDataBinding, runUpdateTransformation } from '@modeler/inspector/commands';
import { freshModdle } from './schemas';

/**
 * A data association as the inspector writes it: bound to a property from the picker, its transformation
 * set by the binding field on every keystroke, or by the expression field on blur.
 */

/** A step with one input association, in a study that declares one property and holds `DataOutput_rate` elsewhere. */
function build() {
  const moddle = freshModdle();
  const property = moddle.create('bpmn:Property', { id: 'rate', name: 'rate' });
  const association = moddle.create('bpmn:DataInputAssociation', { id: 'In' });
  const task = moddle.create('bpmn:Task', { id: 'Step', dataInputAssociations: [association] });
  const elsewhere = moddle.create('bpmn:Task', { id: 'DataOutput_rate' });
  const process = moddle.create('bpmn:Process', { id: 'Study', properties: [property], flowElements: [task, elsewhere] });
  const definitions = moddle.create('bpmn:Definitions', { id: 'Defs', rootElements: [process] });
  association.$parent = task;
  property.$parent = process;
  task.$parent = process;
  elsewhere.$parent = process;
  process.$parent = definitions;
  const editor = { study: Study.fromDefinitions(definitions) } as unknown as Editor;
  return { task, association, property, editor };
}

const body = (association: any): string | undefined => association.get('transformation')?.get('body');

test('the binding field keeps what is typed, spaces included, and an empty one removes the transformation', () => {
  const { task, association, editor } = build();
  const type = (value: string) => runUpdateDataBinding(editor, {
    type: 'UpdateDataBinding', element: task, action: 'set-binding', direction: 'input', associationId: 'In', value,
  });

  type('not ');
  expect(body(association), 'a keystroke at a time: the space just typed stays').toBe('not ');
  type('not done');
  expect(body(association)).toBe('not done');
  type('');
  expect(association.get('transformation')).toBeUndefined();
});

test('the expression field, committed on blur, trims', () => {
  const { association, editor } = build();
  runUpdateTransformation(editor, { type: 'UpdateTransformation', element: association, field: 'body', value: '  a + b \n' });
  expect(body(association)).toBe('a + b');
  runUpdateTransformation(editor, { type: 'UpdateTransformation', element: association, field: 'body', value: '   ' });
  expect(association.get('transformation')).toBeUndefined();
});

test('a bound property\'s association is named for its direction and the property, clear of the ids taken', () => {
  const { task, property, editor } = build();
  const bind = (direction: 'input' | 'output') => runUpdateDataBinding(editor, {
    type: 'UpdateDataBinding', element: task, action: 'bind', direction, propertyId: 'rate',
  });

  bind('input');
  bind('input');
  bind('output');
  const inputs = task.get('dataInputAssociations');
  const outputs = task.get('dataOutputAssociations');
  expect(inputs.map((a: any) => a.id), 'the step\'s own ids').toEqual(['In', 'DataInput_rate', 'DataInput_rate_2']);
  expect(outputs.map((a: any) => a.id), 'an id held elsewhere in the document').toEqual(['DataOutput_rate_2']);
  expect(inputs[1].sourceRef).toEqual([property]);
  expect(outputs[0].targetRef).toBe(property);
});
