
import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '@core/notation';
import { toModdlePackages } from '@core/notation/schemaFile';
import { runUpdateLoopCharacteristics } from '@modeler/inspector/commands';
import { loadSchemaModels } from './schemas';
import {
  loopKindOf,
  supportsLoopCharacteristics,
} from '@modeler/inspector/loopCharacteristics';
import type { EditorPort } from '@modeler/editor/port';
import type { PortHandle } from '@modeler/editor/registry';

/** `update-loop-characteristics` routes every `loopCharacteristics` write through `modeling` (one undo step each). */


const models = loadSchemaModels();

setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const moddle = new BpmnModdle(packages) as any;

/**
 * A handle over a partial `EditorPort`: the command reaches the document through
 * `mutate` and `model` alone, so those two are all the fake owes it. `mutate`
 * applies each write the way a real backend's undo step would, and records which
 * of the two writers ran — the distinction the tests below are about.
 */
function fakeModeler(): { modeler: PortHandle; calls: string[] } {
  const calls: string[] = [];
  const editor = {
    mutate: {
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
  } as unknown as EditorPort;

  return { modeler: { editor, destroy() {} }, calls };
}

function activityElement(type = 'bpmn:SubProcess', id = 'Improve') {
  return { id, businessObject: moddle.create(type, { id }) };
}

test.describe('update-loop-characteristics command', () => {
  test('adds a multi-instance child with its fields', () => {
    const { modeler, calls } = fakeModeler();
    const element = activityElement();

    runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: 'bpmn:MultiInstanceLoopCharacteristics',
      properties: { isSequential: true },
    });

    const lc = element.businessObject.loopCharacteristics;
    expect(lc.$type).toBe('bpmn:MultiInstanceLoopCharacteristics');
    expect(lc.$parent).toBe(element.businessObject);
    expect(lc.get('isSequential')).toBe(true);
    expect(calls).toEqual(['updateProperties']);
  });

  test('edits fields on the existing child without replacing it', () => {
    const { modeler, calls } = fakeModeler();
    const element = activityElement();

    runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: 'bpmn:MultiInstanceLoopCharacteristics',
    });
    const created = element.businessObject.loopCharacteristics;

    runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: 'bpmn:MultiInstanceLoopCharacteristics',
      properties: { isSequential: true },
    });
    runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: 'bpmn:MultiInstanceLoopCharacteristics',
      properties: { isSequential: false },
    });

    const lc = element.businessObject.loopCharacteristics;
    expect(lc).toBe(created);
    expect(lc.get('isSequential')).toBe(false);
    expect(calls).toEqual(['updateProperties', 'updateModdleProperties', 'updateModdleProperties']);
  });

  test('switches between loop and fan-out kinds', () => {
    const { modeler } = fakeModeler();
    const element = activityElement('bpmn:SubProcess', 'Per_Item');

    runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: 'bpmn:StandardLoopCharacteristics',
      properties: { loopMaximum: 3 },
    });
    expect(loopKindOf(element)).toBe('loop');

    runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: 'bpmn:MultiInstanceLoopCharacteristics',
    });
    const lc = element.businessObject.loopCharacteristics;
    expect(loopKindOf(element)).toBe('parallel');
    expect(lc.$parent).toBe(element.businessObject);
    expect(lc.get('loopMaximum')).toBeUndefined();

    runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: 'bpmn:MultiInstanceLoopCharacteristics',
      properties: { isSequential: true },
    });
    expect(element.businessObject.loopCharacteristics).toBe(lc);
    expect(loopKindOf(element)).toBe('sequential');
  });

  test('removes the child, and removal without one is a no-op', () => {
    const { modeler, calls } = fakeModeler();
    const element = activityElement();

    runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: null,
    });
    expect(calls).toEqual([]);

    runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: 'bpmn:MultiInstanceLoopCharacteristics',
    });
    runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: null,
    });
    expect(element.businessObject.loopCharacteristics).toBeUndefined();
    expect(loopKindOf(element)).toBe('none');
  });

  test('serializes the flattened loopCondition string (canonical example shape)', async () => {
    const { modeler } = fakeModeler();
    const element = activityElement();

    runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: 'bpmn:StandardLoopCharacteristics',
      properties: { loopCondition: 'score < 0.9', loopMaximum: 5, testBefore: true },
    });

    const process = moddle.create('bpmn:Process', {
      id: 'P_1',
      flowElements: [element.businessObject],
    });
    element.businessObject.$parent = process;
    const definitions = moddle.create('bpmn:Definitions', { id: 'D_1', rootElements: [process] });
    process.$parent = definitions;

    const { xml } = await moddle.toXML(definitions);
    // `loopCondition` serializes in BPMN's own form: an expression element with `xsi:type`, not a studyflow attribute.
    expect(xml).toContain('xsi:type="bpmn:tFormalExpression"');
    expect(xml).toMatch(/<bpmn:loopCondition[^>]*>score (&lt;|&#60;) 0.9<\/bpmn:loopCondition>/);
    expect(xml).toContain('loopMaximum="5"');
    expect(xml).toContain('testBefore="true"');
  });

  test('serializes the multi-instance child natively (canonical example shape)', async () => {
    const { modeler } = fakeModeler();
    const element = activityElement('bpmn:SubProcess', 'Per_Item');

    runUpdateLoopCharacteristics(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: 'bpmn:MultiInstanceLoopCharacteristics',
      properties: { isSequential: true },
    });

    const process = moddle.create('bpmn:Process', {
      id: 'P_1',
      flowElements: [element.businessObject],
    });
    element.businessObject.$parent = process;
    const definitions = moddle.create('bpmn:Definitions', { id: 'D_1', rootElements: [process] });
    process.$parent = definitions;

    const { xml } = await moddle.toXML(definitions);
    expect(xml).toContain('multiInstanceLoopCharacteristics');
    expect(xml).toContain('isSequential="true"');
  });
});

test.describe('loop model helpers', () => {
  test('only activities support loopCharacteristics', () => {
    expect(supportsLoopCharacteristics(activityElement('bpmn:Task'))).toBe(true);
    expect(supportsLoopCharacteristics(activityElement('bpmn:ServiceTask'))).toBe(true);
    expect(supportsLoopCharacteristics(activityElement('bpmn:SubProcess'))).toBe(true);
    expect(supportsLoopCharacteristics(activityElement('bpmn:StartEvent'))).toBe(false);
    expect(supportsLoopCharacteristics(activityElement('bpmn:SequenceFlow'))).toBe(false);
    expect(supportsLoopCharacteristics(null)).toBe(false);
  });
});
