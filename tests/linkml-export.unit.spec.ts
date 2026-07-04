import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';

import { buildCatalog, setCatalog } from '../src/core/catalog';
import { SCHEMAS } from '../src/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/core/schema';
import { exportToLinkML } from '../src/modeler/models/exporters/linkml';

/**
 * Regression for the linkml exporter after it moved from a hardcoded PROBES
 * list to iterating the StudyflowElement's catalog-declared attributes: a data
 * element's declared attributes must appear in the exported schema.
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

function fakeModeler(bos: any[]): any {
  const elements = bos.map((bo) => ({ businessObject: bo, type: 'shape', id: bo.id }));
  return {
    get: (service: string) => {
      if (service === 'elementRegistry') return { forEach: (fn: any) => elements.forEach(fn) };
      if (service === 'canvas') return { getRootElement: () => undefined };
      return undefined;
    },
  };
}

test('exportToLinkML collects a data element\'s catalog-declared attributes', () => {
  const table = moddle.create('studyflow:Table', {
    id: 'MyTable',
    name: 'My Table',
    rowCount: 42,
    format: 'parquet',
  });

  const out = exportToLinkML(fakeModeler([table]));
  const doc = yaml.load(out) as any;

  const cls = doc.classes.My_Table;
  expect(cls).toBeTruthy();
  expect(cls.class_uri).toBe('studyflow:Table');
  // rowCount was reached via the catalog, not a hardcoded probe.
  expect(cls.attributes.rowCount.range).toBe('integer');
  expect(cls.annotations.format).toBe('parquet');
});
