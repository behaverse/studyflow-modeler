
import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { exportToLinkML } from '@skills/linkml/modeler';
import { exampleExportModel, fakeExportModel, wrapperElement } from '@tests/exporterFixture';
import { exampleNames } from '@tests/utils';

/** Every catalog-declared attribute of a data element must appear in the exported linkml schema. */

test('exportToLinkML collects data elements stored as extension wrappers', () => {
  const recording = wrapperElement('bpmn:DataObjectReference', 'studyflow:Timeseries', {
    id: 'EEG_1',
    name: 'Raw EEG',
    samplingRate: 250,
    channelCount: 64,
    format: 'edf',
  });

  const doc = yaml.load(exportToLinkML(fakeExportModel([recording]))) as any;

  const cls = doc.classes.Raw_EEG;
  expect(cls, JSON.stringify(doc.classes)).toBeTruthy();
  expect(cls.class_uri).toBe('studyflow:Timeseries');
  expect(cls.attributes.samplingRate.range).toBe('float');
  expect(cls.attributes.channelCount.range).toBe('integer');
  expect(cls.annotations.format).toBe('edf');
});

test('every shipped example exports a LinkML document with classes', async () => {
  for (const name of exampleNames) {
    const doc = yaml.load(exportToLinkML(await exampleExportModel(name))) as any;
    expect(Object.keys(doc?.classes ?? {}).length, name).toBeGreaterThan(0);
  }
});
