import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import type { Editor } from '@modeler/editor/port';
import { runUpdateDataBinding, runUpdateTransformation } from '@modeler/inspector/commands';
import { loadSchemaModels, schemaPackages } from './schemas';

/** A data association's transformation, as the inspector writes it: the binding field on every keystroke, the expression field on blur. */

const packages: Record<string, any> = schemaPackages(loadSchemaModels());

function build() {
  const moddle = new BpmnModdle(structuredClone(packages)) as any;
  const association = moddle.create('bpmn:DataInputAssociation', { id: 'In' });
  const task = moddle.create('bpmn:Task', { id: 'Step', dataInputAssociations: [association] });
  association.$parent = task;
  const editor = {
    model: { create: (type: string, props?: Record<string, unknown>) => moddle.create(type, props ?? {}) },
    canvas: {
      updateModdleProperties(_element: any, target: any, props: Record<string, any>) {
        for (const [key, value] of Object.entries(props)) target.set(key, value);
      },
    },
  } as unknown as Editor;
  return { task, association, editor };
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
