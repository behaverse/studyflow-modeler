import { readdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { exportToArtemis } from '../src/modeler/export/artemis';
import { exportToLinkML } from '../src/modeler/export/linkml';
import { exportToNidm } from '../src/modeler/export/nidm';
import { buildExportModel, type ExportModel } from '../src/modeler/export/model';
import { fakeModeler, makeModdle } from './exporterFixture';
import { exampleXml } from './utils';

/**
 * Every interchange exporter over every shipped example.
 *
 * The per-exporter specs pin behaviour on hand-built elements; this one is the
 * blast radius: one semantic model (`buildExportModel`) now feeds all three, so
 * a change to what it collects has to hold across every diagram we ship, not
 * just the fixtures a given exporter was written against.
 */

const EXAMPLES_DIR = path.join(process.cwd(), 'src/assets/examples');
const examples = readdirSync(EXAMPLES_DIR).filter((file) => file.endsWith('.png')).sort();

const ROOT_TYPES = new Set([
  'bpmn:Process', 'studyflow:Study', 'bpmn:Collaboration', 'bpmn:Choreography',
]);

/** Stands in for the element registry: every identified element in the tree, DI excluded. */
function businessObjects(definitions: any): any[] {
  const out: any[] = [];
  const seen = new Set<any>();

  (function visit(node: any): void {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (typeof node.$type === 'string' && typeof node.id === 'string') out.push(node);
    for (const key of Object.keys(node)) {
      if (key.startsWith('$') || key === 'diagrams' || key === 'di') continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  })(definitions);

  return out;
}

async function modelOf(filename: string): Promise<ExportModel> {
  const { rootElement } = await makeModdle().fromXML(exampleXml(filename));
  const root = (rootElement.rootElements ?? []).find((element: any) => ROOT_TYPES.has(element.$type));
  return buildExportModel(fakeModeler(businessObjects(rootElement), { diagramName: root?.name }));
}

function undeclaredPrefixes(turtle: string): string[] {
  const declared = new Set(
    [...turtle.matchAll(/^@prefix\s+([A-Za-z][\w.-]*):/gm)].map((match) => match[1]),
  );
  const body = turtle
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('@prefix'))
    .join('\n')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/<[^>]*>/g, '<>');
  return [...new Set([...body.matchAll(/([A-Za-z][\w.-]*):/g)].map((match) => match[1]))]
    .filter((prefix) => !declared.has(prefix));
}

test.describe('interchange exports over the shipped examples', () => {
  test('there are examples to export', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  for (const filename of examples) {
    test(`${filename} exports to every interchange format`, async () => {
      const model = await modelOf(filename);
      expect(model.elements.length, `${filename} holds no elements`).toBeGreaterThan(0);

      // Data elements and operations are drawn from the same pass, so ids agree by construction.
      for (const element of model.dataElements) expect(model.byId.get(element.id)).toBe(element);
      for (const operation of model.operations) expect(operation.isDataOperation).toBe(true);

      const linkml = yaml.load(exportToLinkML(model)) as any;
      expect(linkml.classes, `${filename}: LinkML export has no classes`).toBeTruthy();
      expect(Object.keys(linkml.classes).length).toBeGreaterThan(0);

      const artemis = JSON.parse(exportToArtemis(model));
      expect(artemis.studyflow_source.diagram_name).toBe(model.diagramName);
      for (const block of ['general', 'participants', 'task', 'acquisition', 'preprocessing', 'analysis', 'datasets']) {
        expect(artemis[block], `${filename}: ARTEM-IS block '${block}' is missing`).toBeTruthy();
      }

      const nidm = exportToNidm(model);
      expect(undeclaredPrefixes(nidm), `${filename}: undeclared prefix in:\n${nidm}`).toEqual([]);
    });
  }
});
