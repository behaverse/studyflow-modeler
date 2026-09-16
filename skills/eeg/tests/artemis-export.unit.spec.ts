import { expect, test } from '@playwright/test';

import { exportToArtemis } from '@skills/eeg/modeler';
import { dataInput, dataOutput, exampleExportModel, fakeExportModel, moddle, wrapperElement } from '@tests/exporterFixture';
import { exampleNames } from '@tests/utils';

/** The ARTEM-IS report, over hand-built business objects. */

/** A cognitive task, an EEG recording, a cleaning step, and a summarizing step, one per report block. */
function eegDiagram(): any {
  const task = wrapperElement('bpmn:Task', 'cognitive:CognitiveTask', {
    id: 'Task_1',
    name: 'N-back',
    platform: 'jspsych',
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

  const clean = moddle.create('bpmn:ServiceTask', {
    id: 'Filter_1',
    name: 'Remove artifacts',
    implementation: 'docker://sccn/eegprep',
  });
  clean.dataInputAssociations = [dataInput(recording)];
  clean.dataOutputAssociations = [dataOutput(cleaned)];

  const summarize = moddle.create('bpmn:ServiceTask', {
    id: 'Reduce_1',
    name: 'Fit model',
    implementation: 'python://sklearn.linear_model.LinearRegression',
  });
  summarize.dataInputAssociations = [dataInput(cleaned)];

  return fakeExportModel([task, recording, cleaned, clean, summarize], { diagramName: 'EEG study' });
}

function report(modeler: any): any {
  return JSON.parse(exportToArtemis(modeler));
}

test.describe('ARTEM-IS export', () => {
  test('fills the task, preprocessing, analysis and dataset blocks from the diagram\'s elements', () => {
    const { task, preprocessing, analysis, datasets } = report(eegDiagram());

    // A list, not the `{ not_applicable: true }` placeholder: a wrapper-style type with the `instrument` role is all it asks.
    expect(task, JSON.stringify(task)).toEqual([expect.objectContaining({
      element_id: 'Task_1', label: 'N-back', studyflow_type: 'cognitive:CognitiveTask', platform: 'jspsych',
    })]);
    // The operation over the EEG recording is preprocessing; the one downstream of it, analysis.
    expect(preprocessing, JSON.stringify(preprocessing)).toEqual([expect.objectContaining({
      element_id: 'Filter_1', label: 'Remove artifacts', implementation: 'docker://sccn/eegprep', studyflow_type: 'bpmn:ServiceTask',
    })]);
    expect(analysis, JSON.stringify(analysis)).toEqual([expect.objectContaining({
      element_id: 'Reduce_1', implementation: 'python://sklearn.linear_model.LinearRegression',
    })]);
    // The recording is a dataset, with its declared attributes.
    expect(datasets, JSON.stringify(datasets)).toEqual([expect.objectContaining({
      element_id: 'EEG_1', studyflow_type: 'studyflow:Timeseries', sampling_rate: 250, channel_count: 16,
    })]);
  });

  test('every shipped example exports a report with every block, named after its diagram', async () => {
    for (const name of exampleNames) {
      const model = await exampleExportModel(name);
      const out = report(model);
      expect(out.studyflow_source.diagram_name, name).toBe(model.diagramName);
      for (const block of ['general', 'participants', 'task', 'acquisition', 'preprocessing', 'analysis', 'datasets']) {
        expect(out[block], `${name}: ARTEM-IS block '${block}'`).toBeTruthy();
      }
    }
  });
});
