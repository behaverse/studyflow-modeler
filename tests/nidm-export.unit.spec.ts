import { expect, test } from '@playwright/test';

import { exportToNidm } from '../src/modeler/export/nidm';
import { fakeExportModel, moddle, wrapperElement } from './exporterFixture';

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

function expectEveryPrefixDeclared(turtle: string): void {
  const declared = declaredPrefixes(turtle);
  const undeclared = [...usedPrefixes(turtle)].filter((prefix) => !declared.has(prefix));
  expect(undeclared, `undeclared prefix(es) in:\n${turtle}`).toEqual([]);
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
  const filter = wrapperElement('bpmn:ServiceTask', 'functional:Filter', {
    id: 'Filter_1',
    name: 'Filter signal',
    'bpmn:documentation': 'Band-pass 1-100 Hz.',
  });
  filter.dataInputAssociations = [dataInput(recording)];
  filter.dataOutputAssociations = [dataOutput(table)];

  return fakeExportModel([recording, table, filter], { diagramName: 'EEG study' });
}

test.describe('NIDM export', () => {
  test('declares every prefix it uses', () => {
    const turtle = exportToNidm(analysisDiagram());

    expectEveryPrefixDeclared(turtle);
    // The studyflow namespace is bound as `core:`; `studyflow:` never is.
    expect(turtle).not.toContain('studyflow:');
  });

  test('declares every prefix it uses in the empty-diagram placeholder', () => {
    expectEveryPrefixDeclared(exportToNidm(fakeExportModel([])));
  });

  test("writes an activity's operation as a core: predicate", () => {
    const turtle = exportToNidm(analysisDiagram());

    // `functional:Filter` pins `operationType: filter` in the schema.
    expect(turtle).toContain('core:operation "filter"');
    expect(turtle).toContain('core:Filter_1 a prov:Activity , core:Filter ;');
    expect(turtle).toContain('rdfs:comment "Band-pass 1-100 Hz."');
  });

  test('reports wrapper-style data elements as entities, with their attributes', () => {
    const turtle = exportToNidm(analysisDiagram());

    expect(turtle).toContain('core:EEG_1 a prov:Entity , core:Timeseries ;');
    expect(turtle).toContain('rdfs:label "Raw EEG"');
    expect(turtle).toContain('nidm:format "edf"');
    expect(turtle).toContain('dct:title "EEG study"');
  });

  test('associates entities with the activity that used and generated them', () => {
    const turtle = exportToNidm(analysisDiagram());

    expect(turtle).toContain('prov:used core:EEG_1');
    expect(turtle).toContain('core:Table_1 prov:wasGeneratedBy core:Filter_1 .');
  });

  test('falls back to the placeholder bundle for a diagram with no data plane', () => {
    const turtle = exportToNidm(fakeExportModel([moddle.create('bpmn:Task', { id: 'Task_1', name: 'Rest' })]));

    expect(turtle).toContain('# No data-operation activities or data-plane elements found');
    expect(turtle).not.toContain('core:Task_1');
  });
});
