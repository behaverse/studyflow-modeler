
import { expect, test } from '@playwright/test';

import { runUpdateLoopCharacteristics } from '@modeler/inspector/commands';
import { freshModdle } from './schemas';
import { loopKindOf } from '@modeler/inspector/loopCharacteristics';
import type { Editor } from '@modeler/editor/port';

/** `UpdateLoopCharacteristics` writes every `loopCharacteristics` change through the canvas, one undoable write each. */

const moddle = freshModdle();

/**
 * A partial `Editor`: the command reaches the document through `canvas` and
 * `model` alone, so those two are all the fake owes it. The canvas applies each
 * write and records which of its two writers ran: the child set on the
 * activity, or a field set on the child standing there.
 */
function fakeModeler(): { modeler: Editor; calls: string[] } {
  const calls: string[] = [];
  const modeler = {
    canvas: {
      updateProperties(element: any, properties: Record<string, any>) {
        calls.push('updateProperties');
        for (const [name, value] of Object.entries(properties)) element.businessObject.set(name, value);
      },
      updateModdleProperties(_element: any, moddleElement: any, properties: Record<string, any>) {
        calls.push('updateModdleProperties');
        for (const [name, value] of Object.entries(properties)) moddleElement.set(name, value);
      },
    },
    model: {
      createBusinessObject: (type: string, properties: Record<string, any>) => moddle.create(type, properties),
    },
  } as unknown as Editor;

  return { modeler, calls };
}

function activityElement(type = 'bpmn:SubProcess', id = 'Improve') {
  return { id, businessObject: moddle.create(type, { id }) };
}

test.describe('update-loop-characteristics command', () => {
  test('a loop is added, switched to another kind, edited in place and removed, one write each', () => {
    const { modeler, calls } = fakeModeler();
    const element = activityElement();
    const update = (loopType: string | null, properties?: Record<string, any>) => runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics', element, loopType, properties,
    });
    const child = () => element.businessObject.loopCharacteristics;

    update(null);
    expect(calls, 'removing a loop that is not there writes nothing').toEqual([]);

    update('bpmn:StandardLoopCharacteristics', { loopMaximum: 3 });
    expect(loopKindOf(element)).toBe('loop');
    expect(child().$parent, 'a new child is parented to its activity').toBe(element.businessObject);
    expect(child().get('loopMaximum')).toBe(3);

    // Another kind is another child: the old kind's fields do not carry over.
    update('bpmn:MultiInstanceLoopCharacteristics');
    const fanOut = child();
    expect(loopKindOf(element)).toBe('parallel');
    expect(fanOut.$parent).toBe(element.businessObject);
    expect(fanOut.get('loopMaximum')).toBeUndefined();

    // The same kind is edited in place.
    update('bpmn:MultiInstanceLoopCharacteristics', { isSequential: true });
    expect(child()).toBe(fanOut);
    expect(loopKindOf(element)).toBe('sequential');

    update(null);
    expect(child()).toBeUndefined();
    expect(loopKindOf(element)).toBe('none');

    // A child is set on the activity; a field of the child standing there is set on the child.
    expect(calls).toEqual(['updateProperties', 'updateProperties', 'updateModdleProperties', 'updateProperties']);
  });

  test('a loop condition typed as text is stored as a BPMN formal expression, and cleared when emptied', () => {
    const { modeler } = fakeModeler();
    const element = activityElement();
    const update = (properties: Record<string, any>) => runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics', element, loopType: 'bpmn:StandardLoopCharacteristics', properties,
    });

    update({ loopCondition: 'score < 0.9' });
    const lc = element.businessObject.loopCharacteristics;
    // BPMN's own form, which serializes as `xsi:type="bpmn:tFormalExpression"`, not a studyflow attribute.
    expect(lc.loopCondition.$type).toBe('bpmn:FormalExpression');
    expect(lc.loopCondition.body).toBe('score < 0.9');
    expect(lc.loopCondition.$parent).toBe(lc);

    update({ loopCondition: '' });
    expect(lc.loopCondition).toBeUndefined();
  });
});
