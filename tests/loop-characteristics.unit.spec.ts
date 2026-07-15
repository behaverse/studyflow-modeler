import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '../src/core/catalog';
import { SCHEMAS } from '../src/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/core/schema';
import { runUpdateLoopCharacteristics } from '../src/modeler/controllers/attributes/updateLoopCharacteristics';
import {
  loopKindOf,
  supportsLoopCharacteristics,
} from '../src/modeler/models/inspector/loopCharacteristics';

/**
 * The `update-loop-characteristics` command behind the inspector's Loop tab:
 * adds/removes/switches an activity's `loopCharacteristics` child and edits
 * its fields, routing every write through `modeling` (one undo step each).
 * Exercised against plain moddle objects with a recording fake of the two
 * modeling calls the handler is allowed to make.
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');

const models = SCHEMAS.map(({ prefix }) =>
  fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
);

setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const moddle = new BpmnModdle(packages) as any;

/** Fake DI container: modeling applies writes like bpmn-js would (without the
 *  command stack) and records which handler each write went through. */
function fakeModeler() {
  const calls: string[] = [];
  const services: Record<string, any> = {
    modeling: {
      updateProperties(element: any, properties: Record<string, any>) {
        calls.push('updateProperties');
        for (const [name, value] of Object.entries(properties)) element.businessObject.set(name, value);
      },
      updateModdleProperties(_element: any, moddleElement: any, properties: Record<string, any>) {
        calls.push('updateModdleProperties');
        for (const [name, value] of Object.entries(properties)) moddleElement.set(name, value);
      },
    },
    bpmnFactory: {
      create: (type: string, properties: Record<string, any>) => moddle.create(type, properties),
    },
  };
  return { modeler: { get: (name: string) => services[name] }, calls };
}

function activityElement(type = 'bpmn:SubProcess', id = 'Improve') {
  return { id, businessObject: moddle.create(type, { id }) };
}

test.describe('update-loop-characteristics command', () => {
  test('adds a standard loop child with its fields', () => {
    const { modeler, calls } = fakeModeler();
    const element = activityElement();

    runUpdateLoopCharacteristics(modeler, {
      type: 'update-loop-characteristics',
      element,
      loopType: 'bpmn:StandardLoopCharacteristics',
      properties: { loopCondition: 'metrics.mean_judge_score < 4', loopMaximum: 3 },
    });

    const lc = element.businessObject.loopCharacteristics;
    expect(lc.$type).toBe('bpmn:StandardLoopCharacteristics');
    expect(lc.$parent).toBe(element.businessObject);
    expect(lc.get('loopCondition')).toBe('metrics.mean_judge_score < 4');
    expect(lc.get('loopMaximum')).toBe(3);
    expect(calls).toEqual(['updateProperties']);
  });

  test('edits fields on the existing child without replacing it', () => {
    const { modeler, calls } = fakeModeler();
    const element = activityElement();

    runUpdateLoopCharacteristics(modeler, {
      type: 'update-loop-characteristics',
      element,
      loopType: 'bpmn:StandardLoopCharacteristics',
    });
    const created = element.businessObject.loopCharacteristics;

    runUpdateLoopCharacteristics(modeler, {
      type: 'update-loop-characteristics',
      element,
      loopType: 'bpmn:StandardLoopCharacteristics',
      properties: { loopCondition: 'score < 0.9' },
    });
    runUpdateLoopCharacteristics(modeler, {
      type: 'update-loop-characteristics',
      element,
      loopType: 'bpmn:StandardLoopCharacteristics',
      properties: { loopMaximum: 5, testBefore: true },
    });

    const lc = element.businessObject.loopCharacteristics;
    expect(lc).toBe(created);
    expect(lc.get('loopCondition')).toBe('score < 0.9');
    expect(lc.get('loopMaximum')).toBe(5);
    expect(lc.get('testBefore')).toBe(true);
    // Child edits go through updateModdleProperties, not a child swap.
    expect(calls).toEqual(['updateProperties', 'updateModdleProperties', 'updateModdleProperties']);
  });

  test('switches between standard and multi-instance', () => {
    const { modeler } = fakeModeler();
    const element = activityElement('bpmn:SubProcess', 'Per_Item');

    runUpdateLoopCharacteristics(modeler, {
      type: 'update-loop-characteristics',
      element,
      loopType: 'bpmn:StandardLoopCharacteristics',
      properties: { loopMaximum: 3 },
    });
    expect(loopKindOf(element)).toBe('standard');

    runUpdateLoopCharacteristics(modeler, {
      type: 'update-loop-characteristics',
      element,
      loopType: 'bpmn:MultiInstanceLoopCharacteristics',
    });
    const lc = element.businessObject.loopCharacteristics;
    expect(loopKindOf(element)).toBe('multi-instance');
    expect(lc.$parent).toBe(element.businessObject);
    // A switch is a fresh child; the standard-loop fields do not leak over.
    expect(lc.get('loopMaximum')).toBeUndefined();

    runUpdateLoopCharacteristics(modeler, {
      type: 'update-loop-characteristics',
      element,
      loopType: 'bpmn:MultiInstanceLoopCharacteristics',
      properties: { isSequential: true },
    });
    expect(element.businessObject.loopCharacteristics).toBe(lc);
    expect(lc.get('isSequential')).toBe(true);
  });

  test('removes the child, and removal without one is a no-op', () => {
    const { modeler, calls } = fakeModeler();
    const element = activityElement();

    runUpdateLoopCharacteristics(modeler, {
      type: 'update-loop-characteristics',
      element,
      loopType: null,
    });
    expect(calls).toEqual([]);

    runUpdateLoopCharacteristics(modeler, {
      type: 'update-loop-characteristics',
      element,
      loopType: 'bpmn:MultiInstanceLoopCharacteristics',
    });
    runUpdateLoopCharacteristics(modeler, {
      type: 'update-loop-characteristics',
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
      type: 'update-loop-characteristics',
      element,
      loopType: 'bpmn:StandardLoopCharacteristics',
      properties: { loopCondition: 'metrics.mean_judge_score < 4', loopMaximum: 3, testBefore: true },
    });

    const process = moddle.create('bpmn:Process', {
      id: 'P_1',
      flowElements: [element.businessObject],
    });
    element.businessObject.$parent = process;
    const definitions = moddle.create('bpmn:Definitions', { id: 'D_1', rootElements: [process] });
    process.$parent = definitions;

    const { xml } = await moddle.toXML(definitions);
    // exec:LoopCondition flattens the expression element to a plain string
    // attribute, as in agent_eval.studyflow's Improve node.
    expect(xml).toContain('exec:loopCondition="metrics.mean_judge_score &#60; 4"');
    expect(xml).toContain('loopMaximum="3"');
    expect(xml).toContain('testBefore="true"');
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
