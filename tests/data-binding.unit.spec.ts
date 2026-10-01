import { expect, test } from '@playwright/test';

import { Study } from '@canvas/index.ts';
import { isElement, type Element } from '@core/model/index';
import type { Editor } from '@modeler/editor/port';
import { runUpdateDataBinding, runUpdateTransformation } from '@modeler/inspector/commands';
import { freshMetamodel } from './schemas';

/**
 * A data association as the inspector writes it: bound to a property from the picker, its transformation
 * set by the binding field on every keystroke, or by the expression field on blur.
 */

/** A step with one input association, in a study that declares one property and holds `DataOutput_rate` elsewhere. */
async function build() {
  const study = await Study.open(`id: Defs
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  properties:
    rate: { name: rate }
  flowElements:
    Step:
      type: Task
      dataInputAssociations:
        In: {}
    DataOutput_rate: { type: Task }
`, { metamodel: freshMetamodel() });
  return { study, editor: { study } as unknown as Editor, task: () => study.element('Step')!, association: () => study.element('In')! };
}

const body = (association: Element): unknown => (isElement(association.transformation) ? association.transformation.body : association.transformation);

const associations = (task: Element, list: string): Element[] => ((task[list] as unknown[] | undefined) ?? []).filter(isElement);

test('the binding field keeps what is typed, spaces included, and an empty one removes the transformation', async () => {
  const { task, association, editor } = await build();
  const type = (value: string) => runUpdateDataBinding(editor, {
    type: 'UpdateDataBinding', element: task(), action: 'set-binding', direction: 'input', associationId: 'In', value,
  });

  type('not ');
  expect(body(association()), 'a keystroke at a time: the space just typed stays').toBe('not ');
  type('not done');
  expect(body(association())).toBe('not done');
  type('');
  expect(association().transformation).toBeUndefined();
});

test('the expression field, committed on blur, trims', async () => {
  const { association, editor } = await build();
  runUpdateTransformation(editor, { type: 'UpdateTransformation', element: association(), field: 'body', value: '  a + b \n' });
  expect(body(association())).toBe('a + b');
  runUpdateTransformation(editor, { type: 'UpdateTransformation', element: association(), field: 'body', value: '   ' });
  expect(association().transformation).toBeUndefined();
});

test('a bound property\'s association is named for its direction and the property, clear of the ids taken', async () => {
  const { task, editor } = await build();
  const bind = (direction: 'input' | 'output') => runUpdateDataBinding(editor, {
    type: 'UpdateDataBinding', element: task(), action: 'bind', direction, propertyId: 'rate',
  });

  bind('input');
  bind('input');
  bind('output');
  const inputs = associations(task(), 'dataInputAssociations');
  const outputs = associations(task(), 'dataOutputAssociations');
  expect(inputs.map((a) => a.id), 'the step\'s own ids').toEqual(['In', 'DataInput_rate', 'DataInput_rate_2']);
  expect(outputs.map((a) => a.id), 'an id held elsewhere in the document').toEqual(['DataOutput_rate_2']);
  expect(inputs[1].sourceRef).toEqual(['rate']);
  expect(outputs[0].targetRef).toBe('rate');
});
