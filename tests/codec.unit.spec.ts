import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { looksLikeXml, studyflowYamlToXml, xmlToStudyflowYaml } from '../src/lib/core/codec';
import { SCHEMAS } from '../src/lib/core/constants';
import { parseStudyflow } from '../src/lib/core/parsers/studyflow';
import { fromModdleYaml, toModdlePackages } from '../src/lib/core/schema';

/**
 * `.studyflow` YAML codec guarantees, checked against every bundled example
 * diagram (real studies with extension wrappers, traits, templates, nested
 * sub-process flows, colors, and DI geometry):
 *
 * 1. Fixed point: XML -> YAML -> XML -> YAML yields the identical YAML, so
 *    nothing is lost or invented by either direction.
 * 2. Semantic equivalence: the runner's parser sees the same flow graph
 *    (nodes, types, extension types, edges, conditions) through both
 *    serializations.
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');
const EXAMPLES_DIR = path.join(process.cwd(), 'src/assets/examples');

const models = SCHEMAS.map(({ prefix }) =>
  fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
);
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const examples = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.studyflow'));

test.describe('studyflow YAML codec', () => {
  test('isMany value-typed lists survive a load (data-loss regression)', async () => {
    // Before toModdlePackages rewrote value-typed wire formats to String,
    // moddle silently dropped this text on every load.
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const xml = readFileSync(path.join(EXAMPLES_DIR, 'spirit2025.studyflow'), 'utf8');
    const { rootElement } = await moddle.fromXML(xml);
    const study = rootElement.rootElements.find(
      (re: any) => re.$type === 'bpmn:Process' || re.$type === 'studyflow:Study',
    );
    const gate = study.flowElements.find((el: any) => el.id === 'Eligibility_Gate');
    const wrapper = gate.extensionElements.values[0];

    expect(wrapper.inclusionCriteria).toEqual([
      'Adults aged 18 to 65 years',
      'DSM-5 diagnosis of attentional disorder',
      'Stable medication regimen for 3 months',
    ]);
  });

  test('sniffer distinguishes XML from YAML', () => {
    expect(looksLikeXml('<?xml version="1.0"?>\n<definitions/>')).toBe(true);
    expect(looksLikeXml('﻿  <bpmn2:definitions>')).toBe(true);
    expect(looksLikeXml('studyflow: "1"\nelements: []')).toBe(false);
  });

  for (const file of examples) {
    test(`${file}: XML -> YAML -> XML round trip reaches a fixed point`, async () => {
      const moddle = new BpmnModdle(structuredClone(packages)) as any;
      const xml = readFileSync(path.join(EXAMPLES_DIR, file), 'utf8');

      const yaml1 = await xmlToStudyflowYaml(xml, moddle);
      const xml2 = await studyflowYamlToXml(yaml1, moddle);
      const yaml2 = await xmlToStudyflowYaml(xml2, moddle);

      expect(yaml2).toBe(yaml1);
    });

    test(`${file}: runner sees the same flow graph through both serializations`, async () => {
      const moddle = new BpmnModdle(structuredClone(packages)) as any;
      const xml = readFileSync(path.join(EXAMPLES_DIR, file), 'utf8');
      const yamlText = await xmlToStudyflowYaml(xml, moddle);

      const fromXmlGraph = await parseStudyflow(xml, structuredClone(packages));
      const fromYamlGraph = await parseStudyflow(yamlText, structuredClone(packages));

      const project = (graph: Awaited<ReturnType<typeof parseStudyflow>>) => ({
        start: graph.startId,
        nodes: [...graph.flowNodes.values()]
          .map(({ id, type, extensionType, incoming, outgoing }) => ({ id, type, extensionType, incoming, outgoing }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        flows: [...graph.sequenceFlows.values()]
          .map(({ id, sourceId, targetId, conditionExpression }) => ({ id, sourceId, targetId, conditionExpression }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      });

      expect(project(fromYamlGraph)).toEqual(project(fromXmlGraph));
    });
  }
});
