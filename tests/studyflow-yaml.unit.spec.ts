import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';

import { looksLikeXml, studyflowToXml, xmlToStudyflow } from '@core/document';
import { exampleNames as examples, exampleXml } from './utils';
import { parseStudyflow } from '@runner/studyflow';
import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import { loadSchemaModels } from './schemas';

/** Over every bundled example: YAML is a fixed point of YAML -> XML -> YAML, and both feed the runner alike. */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

function studyflowOf(file: string): Promise<string> {
  return xmlToStudyflow(exampleXml(file), new BpmnModdle(structuredClone(packages)) as any);
}

test.describe('studyflow YAML format', () => {
  test('isMany value-typed lists survive a load (data-loss regression)', async () => {
    // moddle silently drops value-typed list text unless the association format is String (see toModdlePackages).
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const text = await studyflowOf('spirit2025.studyflow.png');
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

  test('implementation attribute and arguments value survive a load (function calls)', async () => {
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const text = await studyflowOf('function_call_demo.studyflow.png');
    const xml = await studyflowToXml(text, new BpmnModdle(structuredClone(packages)) as any);
    const { rootElement } = await moddle.fromXML(xml);
    const study = rootElement.rootElements.find(
      (re: any) => re.$type === 'bpmn:Process' || re.$type === 'studyflow:Study',
    );
    const map = study.flowElements.find((el: any) => el.id === 'MapRT');

    expect(map.get('implementation')).toBe('python://pkg_for_st.do_map@1.2');
    // `arguments` is a value-typed YAML string; compare parsed content, not whitespace.
    expect(yaml.load(map.get('studyflow:additionalArguments'))).toEqual({ column: 'rt', fn: 'median' });

    const fetch = study.flowElements.find((el: any) => el.id === 'FetchScript');
    expect(fetch.get('implementation')).toBe('https://example.org/scripts/clean.py@v2');
    expect(fetch.get('studyflow:additionalArguments')).toBeUndefined();
  });

  test('folds extension wrappers, config bodies, diagram geometry, and id keys into elements', async () => {
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const text = await studyflowOf('bot_ollama.studyflow.png');
    const xml = await studyflowToXml(text, new BpmnModdle(structuredClone(packages)) as any);
    const doc: any = yaml.load(await xmlToStudyflow(xml, moddle));

    expect(doc.id).toBe('demo5_ollama_bot');
    expect(doc.studyflow).toBeUndefined();
    expect(doc.definitions.id).toBeUndefined();
    expect(doc.diagram).toBeUndefined();
    expect(doc.elements).toBeUndefined();

    // A namespace the writer declares on its own is not written; the XML still carries it.
    expect(doc.definitions['xmlns:studyflow']).toBeUndefined();
    expect(xml).toContain('xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1"');

    const process = doc.Demo5_OllamaBot;
    expect(process.type).toBe('Process');
    expect(process.flowElements.Start.id).toBeUndefined();

    expect(Array.isArray(process.extensionElements)).toBe(true);
    expect(process.extensionElements[0].type).toBe('studyflow:Study');

    const ext = process.flowElements.Warmup_1Back.extensionElements[0];
    expect(ext.type).toBe('cognitive:BehaverseTask');
    expect(ext.configurations.Blocks.Demo5_Warmup.Parameters.NValue).toBe(1);
    expect(ext.botConfigurations.LLM.Provider).toBe('ollama');

    // Geometry is one line per DI node: `x y width height`, and `x,y x,y` for a route.
    const start = process.flowElements.Start;
    expect(start.bounds).toMatch(/^-?[\d.]+ -?[\d.]+ 36 36$/);
    expect(start.label).toMatch(/^(-?[\d.]+ ){3}-?[\d.]+$/);
    expect(process.flowElements.Flow_Start_Warmup.waypoint).toMatch(/^-?[\d.]+,-?[\d.]+( -?[\d.]+,-?[\d.]+)+$/);
    // Implied by the flows, so not written; and a flow under `flowElements` needs no type.
    expect(start.outgoing).toBeUndefined();
    expect(process.flowElements.Warmup_1Back.incoming).toBeUndefined();
    expect(process.flowElements.Flow_Start_Warmup.type).toBeUndefined();
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

  test('unfolded YAML spelling (values/value wrappers + diagram section) still loads', async () => {
    const legacy = `
studyflow: "1"
definitions:
  id: legacy_demo
  targetNamespace: http://bpmn.io/schema/bpmn
  xmlns:studyflow: http://behaverse.org/schemas/studyflow/v1
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
            - type: cognitive:BehaverseTask
              behaverseScene: NB
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

    const moddle2 = new BpmnModdle(structuredClone(packages)) as any;
    const doc: any = yaml.load(await xmlToStudyflow(xml, moddle2));
    expect(doc.id).toBe('legacy_demo');
    expect(doc.definitions['xmlns:studyflow']).toBeUndefined();
    expect(doc.diagram).toBeUndefined();
    const process = doc.P;
    expect(Array.isArray(process.extensionElements)).toBe(true);
    expect(process.flowElements.T1.extensionElements[0].configurations.Timelines).toBeDefined();
    expect(process.flowElements.Start.bounds).toBe('160 180 36 36');
  });

  test('the short spellings: bare types, implied flow types, one-line geometry, arrows, one key per colour', async () => {
    const doc = `
id: short_demo
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    Start:
      type: StartEvent
      bounds: 0 0 36 36
    T1:
      type: Task
      name: Read
      bounds: 100 0 100 80
      fill: "#dbe8f5"
      stroke: "#4a6f9c"
    End:
      type: EndEvent
      bounds: 300 0 36 36
      label: 290 40 56 14
    F1: Start -> T1
    F2:
      name: done
      sourceRef: T1
      targetRef: End
      waypoint: 200,40 300,40
  artifacts:
    Note_1:
      text: hello
    Assoc_1: Note_1 -> T1
`;
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const xml = await studyflowToXml(doc, moddle);
    expect(xml).toMatch(/<bpmn2?:task id="T1" name="Read">/);
    expect(xml).toMatch(/<bpmn2?:sequenceFlow id="F1" sourceRef="Start" targetRef="T1" \/>/);
    expect(xml).toMatch(/<bpmn2?:sequenceFlow id="F2" name="done" sourceRef="T1" targetRef="End" \/>/);
    expect(xml).toMatch(/<bpmn2?:textAnnotation id="Note_1">/);
    expect(xml).toMatch(/<bpmn2?:association id="Assoc_1" sourceRef="Note_1" targetRef="T1" \/>/);
    expect(xml).toMatch(/:outgoing>F1</);
    expect(xml).toMatch(/<dc:Bounds x="100" y="0" width="100" height="80" \/>/);
    expect(xml).toMatch(/<di:waypoint x="200" y="40" \/>/);
    expect(xml).toMatch(/<bpmndi:BPMNLabel>\s*<dc:Bounds x="290" y="40" width="56" height="14" \/>/);
    // One colour key writes both DI vocabularies.
    expect(xml).toContain('color:background-color="#dbe8f5"');
    expect(xml).toContain('bioc:fill="#dbe8f5"');
    expect(xml).toContain('color:border-color="#4a6f9c"');
    expect(xml).toContain('bioc:stroke="#4a6f9c"');

    const back: any = yaml.load(await xmlToStudyflow(xml, new BpmnModdle(structuredClone(packages)) as any));
    expect(back.P.type).toBe('Process');
    expect(back.P.flowElements.T1).toEqual({ type: 'Task', name: 'Read', bounds: '100 0 100 80', fill: '#dbe8f5', stroke: '#4a6f9c' });
    expect(back.P.flowElements.End.label).toBe('290 40 56 14');
    expect(back.P.flowElements.F1).toBe('Start -> T1');
    expect(back.P.flowElements.F2).toEqual({ name: 'done', sourceRef: 'T1', targetRef: 'End', waypoint: '200,40 300,40' });
    expect(back.P.artifacts.Note_1).toEqual({ text: 'hello' });
    expect(back.P.artifacts.Assoc_1).toBe('Note_1 -> T1');
  });

  test('a config body carrying XML-unsafe markup round-trips XML <-> YAML', async () => {
    // moddle escapes a text body only when it is typed exactly `String`; raw `<`/`&` would break the export.
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

    expect(xml1).toContain('&lt;');
    expect(xml1).toContain('&amp;');
    expect(xml1).not.toContain('<<<');

    const moddle2 = new BpmnModdle(structuredClone(packages)) as any;
    const yaml1 = await xmlToStudyflow(xml1, moddle2);
    const back: any = yaml.load(yaml1);
    expect(back.P.flowElements.T1.extensionElements[0].configurations.stimulus).toBe('<p>&lt; L &amp; R <<< </p>');

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

  for (const file of examples) {
    test(`${file}: its YAML projection is the fixed point of YAML -> XML -> YAML`, async () => {
      const text = await studyflowOf(file);
      expect(looksLikeXml(text)).toBe(false);

      const xml = await studyflowToXml(text, new BpmnModdle(structuredClone(packages)) as any);
      const yaml1 = await xmlToStudyflow(xml, new BpmnModdle(structuredClone(packages)) as any);

      expect(yaml1).toBe(text);
    });

    test(`${file}: runner sees the same flow graph through both serializations`, async () => {
      const yamlText = await studyflowOf(file);
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
