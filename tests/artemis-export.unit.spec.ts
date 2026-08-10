import { expect, test } from '@playwright/test';

import { exportToArtemis } from '../src/modeler/export/artemis';
import { fakeExportModel, moddle, wrapperElement } from './exporterFixture';

/** The ARTEM-IS report, over hand-built business objects. */

function dataInput(source: any): any {
  return moddle.create('bpmn:DataInputAssociation', { sourceRef: [source] });
}

function dataOutput(target: any): any {
  return moddle.create('bpmn:DataOutputAssociation', { targetRef: target });
}

/** A cognitive task, an EEG recording, a cleaning step, and a summarizing step — one per report block. */
function eegDiagram(): any {
  const task = wrapperElement('bpmn:Task', 'cognitive:CognitiveTask', {
    id: 'Task_1',
    name: 'N-back',
    instrument: 'jspsych',
  });
  const recording = wrapperElement('bpmn:DataObjectReference', 'studyflow:Timeseries', {
    id: 'EEG_1',
    name: 'Raw EEG',
    samplingRate: 250,
    channelCount: 16,
  });
  const cleaned = wrapperElement('bpmn:DataObjectReference', 'studyflow:Table', {
    id: 'Table_1',
    name: 'Cleaned trials',
    format: 'parquet',
  });

  const clean = wrapperElement('bpmn:ServiceTask', 'functional:Filter', {
    id: 'Filter_1',
    name: 'Remove artifacts',
  });
  clean.dataInputAssociations = [dataInput(recording)];
  clean.dataOutputAssociations = [dataOutput(cleaned)];

  const summarize = wrapperElement('bpmn:ServiceTask', 'functional:Reduce', {
    id: 'Reduce_1',
    name: 'Fit model',
  });
  summarize.dataInputAssociations = [dataInput(cleaned)];

  return fakeExportModel([task, recording, cleaned, clean, summarize], { diagramName: 'EEG study' });
}

function report(modeler: any): any {
  return JSON.parse(exportToArtemis(modeler));
}

test.describe('ARTEM-IS export', () => {
  test('fills the task block from a wrapper-style instrument type', () => {
    const task = report(eegDiagram()).task;

    // Not the `{ not_applicable: true }` placeholder: declaring `instrument` is all the exporter asks.
    expect(Array.isArray(task), JSON.stringify(task)).toBe(true);
    expect(task).toHaveLength(1);
    expect(task[0].element_id).toBe('Task_1');
    expect(task[0].label).toBe('N-back');
    expect(task[0].studyflow_type).toBe('cognitive:CognitiveTask');
    expect(task[0].instrument).toBe('jspsych');
  });

  test('splits the operations into preprocessing over EEG and downstream analysis', () => {
    const { preprocessing, analysis } = report(eegDiagram());

    expect(Array.isArray(preprocessing), JSON.stringify(preprocessing)).toBe(true);
    expect(preprocessing).toHaveLength(1);
    expect(preprocessing[0]).toMatchObject({
      element_id: 'Filter_1',
      label: 'Remove artifacts',
      operation: 'filter',
      studyflow_type: 'functional:Filter',
    });

    expect(Array.isArray(analysis), JSON.stringify(analysis)).toBe(true);
    expect(analysis.map((entry: any) => entry.element_id)).toEqual(['Reduce_1']);
    expect(analysis[0].operation).toBe('reduce');
  });

  test('reports the EEG recording as a dataset with its declared attributes', () => {
    const datasets = report(eegDiagram()).datasets;

    expect(datasets).toHaveLength(1);
    expect(datasets[0]).toMatchObject({
      element_id: 'EEG_1',
      studyflow_type: 'studyflow:Timeseries',
      sampling_rate: 250,
      channel_count: 16,
    });
  });

  test('marks preprocessing not applicable only when the diagram has no EEG element', () => {
    const noEeg = report(fakeExportModel([moddle.create('bpmn:Task', { id: 'Task_1', name: 'Rest' })]));
    expect(noEeg.preprocessing.not_applicable).toBe(true);
    expect(noEeg.task.not_applicable).toBe(true);

    // An EEG element with nothing operating on it means a block to fill in by hand, not one that does not apply.
    const unprocessed = report(fakeExportModel([
      wrapperElement('bpmn:DataObjectReference', 'studyflow:Timeseries', {
        id: 'EEG_1',
        name: 'Raw EEG',
        samplingRate: 250,
      }),
    ]));
    expect(unprocessed.preprocessing.not_applicable).toBe(false);
    expect(unprocessed.preprocessing.notes).toContain('no data operation');
  });

  test('titles the report after the diagram', () => {
    const out = report(eegDiagram());

    expect(out.studyflow_source.diagram_name).toBe('EEG study');
    expect(out.general.study_title).toBe('EEG study');
  });
});
