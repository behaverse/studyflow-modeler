
import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { exportToLinkML } from '@modeler/export/linkml';
import { fakeExportModel, moddle, wrapperElement } from './exporterFixture';

/** Every catalog-declared attribute of a data element must appear in the exported linkml schema. */

test('exportToLinkML collects a data element\'s catalog-declared attributes', () => {
  const table = moddle.create('studyflow:Table', {
    id: 'MyTable',
    name: 'My Table',
    format: 'parquet',
  });

  const out = exportToLinkML(fakeExportModel([table]));
  const doc = yaml.load(out) as any;

  const cls = doc.classes.My_Table;
  expect(cls).toBeTruthy();
  expect(cls.class_uri).toBe('studyflow:Table');
  expect(cls.annotations.format).toBe('parquet');
});

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
