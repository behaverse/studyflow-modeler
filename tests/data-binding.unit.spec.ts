import { expect, test } from '@playwright/test';

import type { Editor } from '@modeler/editor/port';
import { runUpdateDataBinding, runUpdateTransformation } from '@modeler/inspector/commands';
import { freshModdle } from './schemas';

/** A data association's transformation, as the inspector writes it: the binding field on every keystroke, the expression field on blur. */

/** A step with one input association, in a study that declares one property; `held` ids the rest of the document holds. */
function build() {
  const moddle = freshModdle();
  const property = moddle.create('bpmn:Property', { id: 'rate', name: 'rate' });
  const association = moddle.create('bpmn:DataInputAssociation', { id: 'In' });
  const task = moddle.create('bpmn:Task', { id: 'Step', dataInputAssociations: [association] });
  const process = moddle.create('bpmn:Process', { id: 'Study', properties: [property], flowElements: [task] });
  association.$parent = task;
  property.$parent = process;
  task.$parent = process;
  const held = new Set<string>();
  const create = (type: string, props?: Record<string, unknown>) => moddle.create(type, props ?? {});
  const editor = {
    model: { create, createBusinessObject: create, ids: { assigned: (id: string) => held.has(id) } },
    canvas: {
      updateModdleProperties(_element: any, target: any, props: Record<string, any>) {
        for (const [key, value] of Object.entries(props)) target.set(key, value);
      },
    },
  } as unknown as Editor;
  return { task, association, property, editor, held };
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

test('the expression field, committed on blur, trims, and its language select sets the expression\'s language', () => {
  const { association, editor } = build();
  const language = () => association.get('transformation')?.get('language');
  runUpdateTransformation(editor, { type: 'UpdateTransformation', element: association, field: 'body', value: '  a + b \n' });
  expect(body(association)).toBe('a + b');
  runUpdateTransformation(editor, { type: 'UpdateTransformation', element: association, field: 'language', value: 'python' });
  expect(language()).toBe('python');
  runUpdateTransformation(editor, { type: 'UpdateTransformation', element: association, field: 'language', value: '' });
  expect(language(), 'the engine\'s own language is no attribute at all').toBeUndefined();
  runUpdateTransformation(editor, { type: 'UpdateTransformation', element: association, field: 'body', value: '   ' });
  expect(association.get('transformation')).toBeUndefined();
});

test('a bound property\'s association is named for its direction and the property, clear of the ids taken', () => {
  const { task, property, editor, held } = build();
  const bind = (direction: 'input' | 'output') => runUpdateDataBinding(editor, {
    type: 'UpdateDataBinding', element: task, action: 'bind', direction, propertyId: 'rate',
  });
  held.add('DataOutput_rate');

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
