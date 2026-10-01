import { expect, test } from '@playwright/test';

import { Study } from '@canvas/index.ts';
import type { Element } from '@core/model/index';
import { runUpdateLoopCharacteristics } from '@modeler/inspector/commands';
import { loopKindOf } from '@modeler/inspector/loopCharacteristics';
import type { Editor } from '@modeler/editor/port';
import { freshMetamodel } from './schemas';

/** `UpdateLoopCharacteristics` writes every `loopCharacteristics` change through the study, one commit each. */

/** An activity in a study of its own, and the editor the command writes through: that study, which it reaches alone. */
async function build() {
  const study = await Study.open(`id: Defs
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  flowElements:
    Improve: { type: SubProcess }
`, { metamodel: freshMetamodel() });
  return { study, modeler: { study } as unknown as Editor, element: () => study.element('Improve')! };
}

test.describe('update-loop-characteristics command', () => {
  test('a loop is added, switched to another kind, edited in place and removed, one commit each', async () => {
    const { study, modeler, element } = await build();
    const update = (loopType: string | null, properties?: Record<string, any>) => runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics', element: element(), loopType, properties,
    });
    const child = () => element().loopCharacteristics as Element | undefined;

    update(null);
    expect(study.revision, 'removing a loop that is not there writes nothing').toBe(0);

    update('bpmn:StandardLoopCharacteristics', { loopMaximum: 3 });
    expect(loopKindOf(element())).toBe('loop');
    expect(child()?.loopMaximum).toBe(3);

    // Another kind is another child: the old kind's fields do not carry over.
    update('bpmn:MultiInstanceLoopCharacteristics');
    expect(loopKindOf(element())).toBe('parallel');
    expect(child()?.loopMaximum).toBeUndefined();

    // The same kind is edited in place.
    update('bpmn:MultiInstanceLoopCharacteristics', { isSequential: true });
    expect(child()?.type).toBe('bpmn:MultiInstanceLoopCharacteristics');
    expect(loopKindOf(element())).toBe('sequential');

    update(null);
    expect(child()).toBeUndefined();
    expect(loopKindOf(element())).toBe('none');
    expect(study.revision, 'one commit, one undo step, each').toBe(4);
  });

  test('a loop condition typed as text is BPMN\'s formal expression in the XML, and cleared when emptied', async () => {
    const { study, modeler, element } = await build();
    const update = (properties: Record<string, any>) => runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics', element: element(), loopType: 'bpmn:StandardLoopCharacteristics', properties,
    });

    update({ loopCondition: 'score < 0.9' });
    expect((element().loopCharacteristics as Element).loopCondition).toBe('score < 0.9');
    // BPMN's own form, `xsi:type="bpmn:tFormalExpression"`, not a studyflow attribute.
    expect(await study.toXml()).toMatch(/<bpmn:loopCondition xsi:type="bpmn:tFormalExpression">score &lt; 0.9<\/bpmn:loopCondition>/);

    update({ loopCondition: '' });
    expect((element().loopCharacteristics as Element).loopCondition).toBeUndefined();
  });
});
