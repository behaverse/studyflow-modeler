import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { studyflowToXml, xmlToStudyflow } from '@core/document';
import { runUpdateStateProperties } from '@modeler/inspector/commands';
import type { Editor } from '@modeler/editor/port';
import { toModdlePackages } from '@core/notation/schemaFile';
import { loadSchemaModels } from './schemas';
import { exampleStudyflow } from './utils';

/** State as BPMN's own declared variables. */


const models = loadSchemaModels();
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const moddle = () => new BpmnModdle(structuredClone(packages)) as any;

/** Two scopes of state, typed by item definitions, read and written by the step that runs the trial. */
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

    expect(xml).toContain('<bpmn:property id="Arm" itemSubjectRef="Item_Arm" name="arm">');
    expect(xml).toContain('<bpmn:property id="Failed_Trials"');
    expect(xml).toContain('<bpmn:itemDefinition id="Item_Arm" structureRef="string" />');
    expect(xml).toContain('<bpmn:dataState name="allocated" />');

    const stateDecls = xml.match(/<bpmn:property[^>]*>/g) ?? [];
    expect(stateDecls).toHaveLength(2);
    for (const decl of stateDecls) expect(decl).not.toContain('studyflow:');
  });

  test('an output association narrows a return value into a property, in BPMN\'s own form', async () => {
    const source = await exampleStudyflow('sklearn_pipeline.studyflow.png', moddle());
    const xml = await studyflowToXml(source, moddle());

    expect(xml).toContain('<bpmn:property id="mean_cv_accuracy" itemSubjectRef="Item_Number" name="mean_cv_accuracy" />');
    expect(xml).toContain('<bpmn:itemDefinition id="Item_Estimator" structureRef="sklearn.pipeline.Pipeline" />');

    expect(xml).toContain('<bpmn:transformation>result.test_accuracy[\'mean\']</bpmn:transformation>');
    expect(xml).not.toContain('<bpmn:formalExpression>');

    expect(xml).toContain('mean_cv_accuracy &gt;= 0.90');
  });

  test('bpmn:implementation stays on the step that runs software', async () => {
    const xml = await studyflowToXml(PROBE, moddle());

    expect(xml).toMatch(/<bpmn:serviceTask[^>]*implementation="python:\/\/battery\.run_trial@1\.0"/);
    expect(xml).not.toMatch(/<bpmn:subProcess[^>]*implementation=/);
  });

  test('a property is addressable as a data-association endpoint across scopes', async () => {
    const xml = await studyflowToXml(PROBE, moddle());
    const { rootElement } = await moddle().fromXML(xml);
    const process = rootElement.rootElements.find((el: any) => el.$type === 'bpmn:Process');
    const battery = process.flowElements.find((el: any) => el.id === 'Battery');
    const trial = battery.flowElements.find((el: any) => el.id === 'Run_Trial');

    expect(process.properties.map((p: any) => p.name)).toEqual(['arm']);
    expect(process.properties[0].itemSubjectRef.structureRef).toBe('string');
    expect(process.properties[0].dataState.name).toBe('allocated');

    expect(battery.properties.map((p: any) => p.name)).toEqual(['failed_trials']);

    expect(trial.dataInputAssociations[0].sourceRef[0]).toBe(process.properties[0]);
    expect(trial.dataOutputAssociations[0].targetRef).toBe(battery.properties[0]);
  });
});

test.describe('property names', () => {
  test('a rename to a `_`-prefixed name is refused; the previous name stays', () => {
    const m = moddle();
    const property = m.create('bpmn:Property', { id: 'P1', name: 'count' });
    const process = m.create('bpmn:Process', { id: 'S', properties: [property] });
    property.$parent = process;
    const element = { id: 'S', businessObject: process };
    const modeler = {
      canvas: {
        updateModdleProperties(_el: any, target: any, props: Record<string, any>) {
          for (const [k, v] of Object.entries(props)) target.set(k, v);
        },
      },
    } as unknown as Editor;

    runUpdateStateProperties(modeler, { type: 'UpdateStateProperties', element, action: 'rename', propertyId: 'P1', name: '_prov' });
    expect(property.name).toBe('count');

    runUpdateStateProperties(modeler, { type: 'UpdateStateProperties', element, action: 'rename', propertyId: 'P1', name: 'total' });
    expect(property.name).toBe('total');
  });
});
