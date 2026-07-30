import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { studyflowToXml, xmlToStudyflow } from '../src/core/codec';
import { toModdlePackages } from '../src/core/schema';
import { loadSchemaModels } from './schemas';
import { exampleStudyflow } from './utils';

/**
 * State as BPMN's own declared variables.
 *
 * BPMN 2.0 §10.3.1 defines `bpmn:Property` as an item-aware element that,
 * unlike a Data Object, is never drawn on the diagram, and that only
 * Processes, Activities, and Events may contain. The Process attribute table
 * adds the scope rule: all Tasks and Sub-Processes have access to the
 * properties of their Process. §10.4.7 makes scopes hierarchically nested,
 * and §10.3.2 fills an activity's declared inputs from "elements in the
 * context, such as Data Objects or Properties" through data associations.
 *
 * That is the state model the notation needs: declared, typed, scoped by its
 * container, explicit in the file and absent from the canvas. These tests pin
 * that the codec carries it losslessly, and that the XML projection stays
 * plain BPMN, before anything is built on top of it.
 */


const models = loadSchemaModels();
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const moddle = () => new BpmnModdle(structuredClone(packages)) as any;

/**
 * Two scopes of state, typed by item definitions, read and written by the step
 * that runs the trial. The trial task reads study-scoped `arm` from the
 * enclosing process and writes battery-scoped `failed_trials` to its own
 * sub-process. No DI anywhere: none of this state is drawn.
 */
const PROBE = readFileSync(
  path.join(process.cwd(), 'tests/fixtures/state-properties.studyflow'),
  'utf8',
);

test.describe('state as bpmn:Property', () => {
  test('properties, item definitions, and data states survive YAML -> XML -> YAML', async () => {
    const xml = await studyflowToXml(PROBE, moddle());
    const back = await xmlToStudyflow(xml, moddle());
    expect(back).toBe(PROBE);
  });

  test('the XML projection is plain BPMN, with no studyflow namespace on the state', async () => {
    const xml = await studyflowToXml(PROBE, moddle());

    // State lands in BPMN's own containers, not inside extensionElements.
    expect(xml).toContain('<bpmn:property id="Arm" itemSubjectRef="Item_Arm" name="arm">');
    expect(xml).toContain('<bpmn:property id="Failed_Trials"');
    expect(xml).toContain('<bpmn:itemDefinition id="Item_Arm" structureRef="string" />');
    expect(xml).toContain('<bpmn:dataState name="allocated" />');

    // A generic BPMN tool reads every state declaration without knowing any
    // Studyflow schema: the only namespaced payload is the binding refinement.
    const stateDecls = xml.match(/<bpmn:property[^>]*>/g) ?? [];
    expect(stateDecls).toHaveLength(2);
    for (const decl of stateDecls) expect(decl).not.toContain('studyflow:');
  });

  test('an output association narrows a return value into a property, in BPMN\'s own form', async () => {
    const source = await exampleStudyflow('sklearn_pipeline.png', moddle());
    const xml = await studyflowToXml(source, moddle());

    // In-memory intermediates are declared, not drawn; only persisted
    // artifacts keep a shape on the canvas.
    expect(xml).toContain('<bpmn:property id="Mean_CV_Accuracy" itemSubjectRef="Item_Number" name="mean_cv_accuracy" />');
    expect(xml).toContain('<bpmn:itemDefinition id="Item_Estimator" structureRef="sklearn.pipeline.Pipeline" />');

    // `transformation` is named after the property, per BPMN's own
    // serialization hint — `<bpmn:formalExpression>` is not valid here.
    //
    // The expression indexes the statistic rather than reaching for it as a
    // field, because the step calls `DataFrame.describe`, which puts the
    // statistics on the index: `.mean` would name the Series method and the
    // gate downstream would compare a method to a number. The example really
    // runs (see `src/runner/python/`), so this is load-bearing, not cosmetic.
    expect(xml).toContain('<bpmn:transformation>result.test_accuracy[\'mean\']</bpmn:transformation>');
    expect(xml).not.toContain('<bpmn:formalExpression>');

    // The gate reads the declared name, not a path into a persisted file.
    expect(xml).toContain('mean_cv_accuracy &gt;= 0.90');
  });

  test('bpmn:implementation stays on the step that runs software', async () => {
    const xml = await studyflowToXml(PROBE, moddle());

    // BPMN declares `implementation` on service-style tasks, and exec's trait
    // redefines it there. It must not drift onto the sub-process, which has no
    // such attribute in the BPMN XSD.
    expect(xml).toMatch(/<bpmn:serviceTask[^>]*implementation="python:\/\/battery\.run_trial@1\.0"/);
    expect(xml).not.toMatch(/<bpmn:subProcess[^>]*implementation=/);
  });

  test('a property is addressable as a data-association endpoint across scopes', async () => {
    const xml = await studyflowToXml(PROBE, moddle());
    const { rootElement } = await moddle().fromXML(xml);
    const process = rootElement.rootElements.find((el: any) => el.$type === 'bpmn:Process');
    const battery = process.flowElements.find((el: any) => el.id === 'Battery');
    const trial = battery.flowElements.find((el: any) => el.id === 'Run_Trial');

    // Study-scoped state is declared on the process, typed by an ItemDefinition ...
    expect(process.properties.map((p: any) => p.name)).toEqual(['arm']);
    expect(process.properties[0].itemSubjectRef.structureRef).toBe('string');
    expect(process.properties[0].dataState.name).toBe('allocated');

    // ... battery-scoped state on the sub-process (BPMN §10.4.7 nesting) ...
    expect(battery.properties.map((p: any) => p.name)).toEqual(['failed_trials']);

    // ... and the associations resolve to those declarations rather than to loose
    // strings, reaching up the scope chain for `arm` and staying inside the
    // battery for `failed_trials`.
    expect(trial.dataInputAssociations[0].sourceRef[0]).toBe(process.properties[0]);
    expect(trial.dataOutputAssociations[0].targetRef).toBe(battery.properties[0]);
  });
});
