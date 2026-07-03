import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';

import { looksLikeXml, readStudyflowMetadata, studyflowToXml, xmlToStudyflow } from '../src/lib/core/studyflowYaml';
import { SCHEMAS } from '../src/lib/core/constants';
import { parseStudyflow } from '../src/lib/core/parseStudyflow';
import { fromModdleYaml, toModdlePackages } from '../src/lib/core/schema';

/**
 * `.studyflow` YAML format guarantees, checked against every bundled example
 * diagram (real studies with extension wrappers, traits, templates, nested
 * sub-process flows, colors, and DI geometry). Examples ship as YAML (the
 * format the modeler writes on save); `.bpmn` files stay XML:
 *
 * 1. Fixed point: each shipped file is its own canonical serialization —
 *    YAML -> XML -> YAML yields the identical YAML, so nothing is lost or
 *    invented by either direction.
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

test.describe('studyflow YAML format', () => {
  test('isMany value-typed lists survive a load (data-loss regression)', async () => {
    // Before toModdlePackages rewrote value-typed wire formats to String,
    // moddle silently dropped this text on every XML load.
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const text = readFileSync(path.join(EXAMPLES_DIR, 'spirit2025.studyflow'), 'utf8');
    const xml = await studyflowToXml(text, new BpmnModdle(structuredClone(packages)) as any);
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

  test('uses attribute and with value survive a load (function calls)', async () => {
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const text = readFileSync(path.join(EXAMPLES_DIR, 'function_call_demo.studyflow'), 'utf8');
    const xml = await studyflowToXml(text, new BpmnModdle(structuredClone(packages)) as any);
    const { rootElement } = await moddle.fromXML(xml);
    const study = rootElement.rootElements.find(
      (re: any) => re.$type === 'bpmn:Process' || re.$type === 'studyflow:Study',
    );
    const map = study.flowElements.find((el: any) => el.id === 'MapRT');

    expect(map.get('studyflow:uses')).toBe('python://pkg_for_st.do_map@1.2');
    // `with` is a value-typed YAML string (inlined as a mapping in the YAML
    // form); compare parsed content, not whitespace.
    expect(yaml.load(map.get('studyflow:with'))).toEqual({ column: 'rt', fn: 'median' });

    const fetch = study.flowElements.find((el: any) => el.id === 'FetchScript');
    expect(fetch.get('studyflow:uses')).toBe('https://example.org/scripts/clean.py@v2');
    expect(fetch.get('studyflow:with')).toBeUndefined();
  });

  test('folds extension wrappers, config bodies, diagram geometry, and id keys into elements', async () => {
    // Round the shipped YAML through XML so the folding path (xmlToStudyflow)
    // is what actually produces the document under test.
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const text = readFileSync(path.join(EXAMPLES_DIR, 'bot_ollama.studyflow'), 'utf8');
    const xml = await studyflowToXml(text, new BpmnModdle(structuredClone(packages)) as any);
    const doc: any = yaml.load(await xmlToStudyflow(xml, moddle));

    // The definitions id sits at the root; no version key, no bpmndi tree.
    expect(doc.id).toBe('demo5_ollama_bot');
    expect(doc.studyflow).toBeUndefined();
    expect(doc.definitions.id).toBeUndefined();
    expect(doc.diagram).toBeUndefined();
    expect(doc.elements).toBeUndefined();

    // The format version rides on the core namespace; legacy (unversioned)
    // declarations are rewritten on load, so only the versioned form survives.
    expect(doc.definitions['xmlns:studyflow']).toBe('http://behaverse.org/schemas/studyflow/v1');

    // Root elements and containment collections are keyed by id.
    const process = doc.Demo5_OllamaBot;
    expect(process.type).toBe('bpmn:Process');
    expect(process.flowElements.Start.id).toBeUndefined();

    // extensionElements is a plain list (no `values:` wrapper).
    expect(Array.isArray(process.extensionElements)).toBe(true);
    expect(process.extensionElements[0].type).toBe('studyflow:Study');

    // Config wrappers inline their YAML body (no `value: |` string block).
    const ext = process.flowElements.Warmup_1Back.extensionElements[0];
    expect(ext.type).toBe('behaverse:Task');
    expect(ext.configurations.Blocks.Demo5_Warmup.Parameters.NValue).toBe(1);
    expect(ext.botConfigurations.LLM.Provider).toBe('ollama');

    // Geometry lives on the element it describes.
    const start = process.flowElements.Start;
    expect(start.bounds).toMatchObject({ width: 36, height: 36 });
    expect(start.label.bounds).toBeDefined();
    expect(Array.isArray(process.flowElements.Flow_Start_Warmup.waypoint)).toBe(true);
  });

  test('hand-written keyed YAML loads; missing incoming/outgoing are derived', async () => {
    const text = `
id: keyed_demo
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: bpmn:Process
  flowElements:
    Start:
      type: bpmn:StartEvent
      bounds: { x: 0, "y": 0, width: 36, height: 36 }
    T1:
      type: bpmn:Task
      bounds: { x: 100, "y": 0, width: 100, height: 80 }
    End:
      type: bpmn:EndEvent
      bounds: { x: 300, "y": 0, width: 36, height: 36 }
    F1:
      type: bpmn:SequenceFlow
      sourceRef: Start
      targetRef: T1
      waypoint: [{ x: 36, "y": 18 }, { x: 100, "y": 18 }]
    F2:
      type: bpmn:SequenceFlow
      sourceRef: T1
      targetRef: End
      waypoint: [{ x: 200, "y": 18 }, { x: 300, "y": 18 }]
`;
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const xml = await studyflowToXml(text, moddle);
    expect(xml).toContain('id="keyed_demo"');
    // incoming/outgoing were omitted by hand and derived from the flows.
    expect(xml).toMatch(/:outgoing>F1</);
    expect(xml).toMatch(/:incoming>F1</);
    expect(xml).toMatch(/:outgoing>F2</);
    expect(xml).toMatch(/:incoming>F2</);

    const graph = await parseStudyflow(text, structuredClone(packages));
    expect(graph.startId).toBe('Start');
    expect(graph.flowNodes.get('T1')?.incoming).toEqual(['F1']);
    expect(graph.flowNodes.get('T1')?.outgoing).toEqual(['F2']);
  });

  test('legacy YAML spelling (values/value wrappers + diagram section) still loads', async () => {
    const legacy = `
studyflow: "1"
definitions:
  id: legacy_demo
  targetNamespace: http://bpmn.io/schema/bpmn
  xmlns:studyflow: http://behaverse.org/schemas/studyflow
elements:
  - type: bpmn:Process
    id: P
    extensionElements:
      values:
        - type: studyflow:Study
    flowElements:
      - type: bpmn:StartEvent
        id: Start
        outgoing: [F1]
      - type: bpmn:Task
        id: T1
        extensionElements:
          values:
            - type: behaverse:Task
              scene: NB
              configurations:
                value: |
                  Timelines:
                    XCIT_NB_01:
        incoming: [F1]
        outgoing: [F2]
      - type: bpmn:EndEvent
        id: End
        incoming: [F2]
      - type: bpmn:SequenceFlow
        id: F1
        sourceRef: Start
        targetRef: T1
      - type: bpmn:SequenceFlow
        id: F2
        sourceRef: T1
        targetRef: End
diagram:
  - id: BPMNDiagram_1
    plane:
      id: BPMNPlane_1
      bpmnElement: P
      planeElement:
        - type: bpmndi:BPMNShape
          id: Start_di
          bpmnElement: Start
          bounds: { x: 160, "y": 180, width: 36, height: 36 }
`;
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const xml = await studyflowToXml(legacy, moddle);
    expect(xml).toContain('XCIT_NB_01');
    expect(xml).toContain('Start_di');

    // Re-saving normalizes the legacy spelling to the folded, id-keyed format.
    const moddle2 = new BpmnModdle(structuredClone(packages)) as any;
    const doc: any = yaml.load(await xmlToStudyflow(xml, moddle2));
    expect(doc.id).toBe('legacy_demo');
    expect(doc.definitions['xmlns:studyflow']).toBe('http://behaverse.org/schemas/studyflow/v1');
    expect(doc.diagram).toBeUndefined();
    const process = doc.P;
    expect(Array.isArray(process.extensionElements)).toBe(true);
    expect(process.flowElements.T1.extensionElements[0].configurations.Timelines).toBeDefined();
    expect(process.flowElements.Start.bounds.x).toBe(160);
  });

  test('a config body carrying XML-unsafe markup round-trips XML <-> YAML', async () => {
    // moddle escapes a text body only when it is typed exactly `String`; a raw
    // `<`/`&` in a `cognitive:Configurations` (YAMLString) body used to produce
    // invalid XML on the Save As > BPMN 2.0 XML path.
    const doc = `
id: escape_demo
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: bpmn:Process
  flowElements:
    T1:
      type: bpmn:Task
      extensionElements:
        - type: cognitive:CognitiveTask
          instrument: jspsych
          configurations:
            stimulus: "<p>&lt; L &amp; R <<< </p>"
    End:
      type: bpmn:EndEvent
    F1:
      type: bpmn:SequenceFlow
      sourceRef: T1
      targetRef: End
`;
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const xml1 = await studyflowToXml(doc, moddle);

    // The body markup is escaped, so the document is well-formed XML.
    expect(xml1).toContain('&lt;');
    expect(xml1).toContain('&amp;');
    expect(xml1).not.toContain('<<<');

    // Reading it back decodes the entities; the folded YAML preserves the value.
    const moddle2 = new BpmnModdle(structuredClone(packages)) as any;
    const yaml1 = await xmlToStudyflow(xml1, moddle2);
    const back: any = yaml.load(yaml1);
    expect(back.P.flowElements.T1.extensionElements[0].configurations.stimulus).toBe('<p>&lt; L &amp; R <<< </p>');

    // And it reaches a fixed point: XML -> YAML -> XML -> YAML is stable.
    const moddle3 = new BpmnModdle(structuredClone(packages)) as any;
    const xml2 = await studyflowToXml(yaml1, moddle3);
    const moddle4 = new BpmnModdle(structuredClone(packages)) as any;
    expect(await xmlToStudyflow(xml2, moddle4)).toBe(yaml1);
  });

  test('sniffer distinguishes XML from YAML', () => {
    expect(looksLikeXml('<?xml version="1.0"?>\n<definitions/>')).toBe(true);
    expect(looksLikeXml('﻿  <bpmn2:definitions>')).toBe(true);
    expect(looksLikeXml('studyflow: "1"\nelements: []')).toBe(false);
  });

  test('metadata probe reads the primary root without a moddle round-trip', () => {
    // Prefers the Process root and reads name + documentation.
    expect(readStudyflowMetadata([
      'id: my_study',
      'definitions: { targetNamespace: x }',
      'My_Collab:',
      '  type: bpmn:Collaboration',
      'My_Process:',
      '  type: bpmn:Process',
      '  name: Stroop battery',
      '  documentation: Classic color-word interference protocol.',
    ].join('\n'))).toEqual({
      id: 'My_Process',
      name: 'Stroop battery',
      description: 'Classic color-word interference protocol.',
    });

    // Falls back to the Choreography root; documentation may fold as a list.
    expect(readStudyflowMetadata([
      'Dyadic_Study:',
      '  type: bpmn:Choreography',
      '  name: Dyadic decision study',
      '  documentation:',
      '    - text: Two-participant choreography.',
    ].join('\n'))).toEqual({
      id: 'Dyadic_Study',
      name: 'Dyadic decision study',
      description: 'Two-participant choreography.',
    });

    // Unnamed roots surface only the id; non-document YAML yields nothing.
    expect(readStudyflowMetadata('SPIRIT_2025:\n  type: bpmn:Process')).toEqual({
      id: 'SPIRIT_2025',
      name: undefined,
      description: undefined,
    });
    expect(readStudyflowMetadata('just a string')).toEqual({});
  });

  for (const file of examples) {
    test(`${file}: metadata probe returns a usable title source`, () => {
      const text = readFileSync(path.join(EXAMPLES_DIR, file), 'utf8');
      const meta = readStudyflowMetadata(text);
      expect(meta.name || meta.id, `${file} should expose a name or root id`).toBeTruthy();
    });
  }

  for (const file of examples) {
    test(`${file}: shipped YAML is the fixed point of YAML -> XML -> YAML`, async () => {
      const text = readFileSync(path.join(EXAMPLES_DIR, file), 'utf8');
      expect(looksLikeXml(text)).toBe(false);

      const xml = await studyflowToXml(text, new BpmnModdle(structuredClone(packages)) as any);
      const yaml1 = await xmlToStudyflow(xml, new BpmnModdle(structuredClone(packages)) as any);

      expect(yaml1).toBe(text);
    });

    test(`${file}: runner sees the same flow graph through both serializations`, async () => {
      const yamlText = readFileSync(path.join(EXAMPLES_DIR, file), 'utf8');
      const xml = await studyflowToXml(yamlText, new BpmnModdle(structuredClone(packages)) as any);

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
