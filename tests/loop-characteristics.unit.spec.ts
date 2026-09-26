
import { expect, test } from '@playwright/test';

import { Study } from '@canvas/index.ts';
import { runUpdateLoopCharacteristics } from '@modeler/inspector/commands';
import { freshModdle } from './schemas';
import { loopKindOf } from '@modeler/inspector/loopCharacteristics';
import type { Editor } from '@modeler/editor/port';

/** `UpdateLoopCharacteristics` writes every `loopCharacteristics` change through the study, one commit each. */

/** An activity in a study of its own, and the editor the command writes through: that study, which it reaches alone. */
function build() {
  const moddle = freshModdle();
  const activity = moddle.create('bpmn:SubProcess', { id: 'Improve' });
  const process = moddle.create('bpmn:Process', { id: 'Study', flowElements: [activity] });
  const definitions = moddle.create('bpmn:Definitions', { id: 'Defs', rootElements: [process] });
  activity.$parent = process;
  process.$parent = definitions;
  const study = Study.fromDefinitions(definitions);
  return { study, modeler: { study } as unknown as Editor, element: { id: 'Improve', businessObject: activity } };
}

test.describe('update-loop-characteristics command', () => {
  test('a loop is added, switched to another kind, edited in place and removed, one commit each', () => {
    const { study, modeler, element } = build();
    const update = (loopType: string | null, properties?: Record<string, any>) => runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics', element, loopType, properties,
    });
    const child = () => element.businessObject.loopCharacteristics;

    update(null);
    expect(study.revision, 'removing a loop that is not there writes nothing').toBe(0);

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
    expect(study.revision, 'one commit, one undo step, each').toBe(4);
  });

  test('a loop condition typed as text is stored as a BPMN formal expression, and cleared when emptied', () => {
    const { modeler, element } = build();
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
