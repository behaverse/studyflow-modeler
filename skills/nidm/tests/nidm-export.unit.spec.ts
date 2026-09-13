import { expect, test } from '@playwright/test';

import { StudyflowElement } from '@core/element';
import { exportToNidm } from '@skills/nidm/modeler';
import { exampleExportModel, fakeExportModel, moddle, wrapperElement } from '@tests/exporterFixture';
import { exampleNames } from '@tests/utils';

/** The NIDM-Results (Turtle) export, over hand-built business objects. */

function declaredPrefixes(turtle: string): Set<string> {
  return new Set([...turtle.matchAll(/^@prefix\s+([A-Za-z][\w.-]*):/gm)].map((match) => match[1]));
}

function usedPrefixes(turtle: string): Set<string> {
  const body = turtle
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('@prefix'))
    .join('\n')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/<[^>]*>/g, '<>');
  return new Set([...body.matchAll(/([A-Za-z][\w.-]*):/g)].map((match) => match[1]));
}

function expectEveryPrefixDeclared(turtle: string, label: string): void {
  const declared = declaredPrefixes(turtle);
  const undeclared = [...usedPrefixes(turtle)].filter((prefix) => !declared.has(prefix));
  expect(undeclared, `${label}: undeclared prefix(es) in:\n${turtle}`).toEqual([]);
}

function dataInput(source: any): any {
  return moddle.create('bpmn:DataInputAssociation', { sourceRef: [source] });
}

function dataOutput(target: any): any {
  return moddle.create('bpmn:DataOutputAssociation', { targetRef: target });
}

/** An EEG recording, an operation over it, and the table it writes. */
function analysisDiagram(): any {
  const recording = wrapperElement('bpmn:DataObjectReference', 'studyflow:Timeseries', {
    id: 'EEG_1',
    name: 'Raw EEG',
    samplingRate: 250,
    format: 'edf',
  });
  const table = wrapperElement('bpmn:DataObjectReference', 'studyflow:Table', {
    id: 'Table_1',
    name: 'Trial table',
    format: 'parquet',
  });
  const filter = moddle.create('bpmn:ServiceTask', {
    id: 'Filter_1',
    name: 'Filter signal',
    implementation: 'python://scipy.signal.butter',
  });
  StudyflowElement.fromBusinessObject(filter).setAttribute('documentation', 'Band-pass 1-100 Hz.');
  filter.dataInputAssociations = [dataInput(recording)];
  filter.dataOutputAssociations = [dataOutput(table)];

  return fakeExportModel([recording, table, filter], { diagramName: 'EEG study' });
}

test.describe('NIDM export', () => {
  // consort2025, among others, has no data plane: the placeholder bundle is checked here too.
  test('every shipped example exports Turtle that declares every prefix it uses', async () => {
    for (const name of exampleNames) expectEveryPrefixDeclared(exportToNidm(await exampleExportModel(name)), name);
  });

  test('writes an operation as an activity, its data as entities, and which it used and generated', () => {
    const turtle = exportToNidm(analysisDiagram());

    // The activity, its implementation as a core: predicate.
    expect(turtle).toContain('core:Filter_1 a prov:Activity , core:ServiceTask ;');
    expect(turtle).toContain('core:implementation "python://scipy.signal.butter"');
    expect(turtle).toContain('rdfs:comment "Band-pass 1-100 Hz."');
    // A wrapper-style data element is an entity, with its attributes.
    expect(turtle).toContain('core:EEG_1 a prov:Entity , core:Timeseries ;');
    expect(turtle).toContain('rdfs:label "Raw EEG"');
    expect(turtle).toContain('nidm:format "edf"');
    expect(turtle).toContain('dct:title "EEG study"');
    // What the activity read, and what it wrote.
    expect(turtle).toContain('prov:used core:EEG_1');
    expect(turtle).toContain('core:Table_1 prov:wasGeneratedBy core:Filter_1 .');
  });
});
