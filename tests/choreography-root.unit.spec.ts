
import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { fromWireXml, toWireXml } from '@behaverse/studyflow-core/document';
import { toModdlePackages } from '@behaverse/studyflow-core/notation/schemaFile';
import { loadSchemaModels } from './schemas';

/** Choreography wire format: save emits the spec `bpmn:Choreography` shape, load folds back to process form. */


const models = loadSchemaModels();
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const moddle = () => new BpmnModdle(structuredClone(packages)) as any;

/** Canvas form: a Process of choreography tasks + a headless participant collaboration. */
const CANVAS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" id="chor_wire" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:collaboration id="Collab">
    <bpmn2:participant id="P_Sub" name="Subject" />
    <bpmn2:participant id="P_Exp" name="Experimenter" />
  </bpmn2:collaboration>
  <bpmn2:process id="Process_1" isExecutable="false">
    <bpmn2:startEvent id="Start_1">
      <bpmn2:outgoing>F1</bpmn2:outgoing>
    </bpmn2:startEvent>
    <bpmn2:choreographyTask id="Consent" name="Give consent" initiatingParticipantRef="P_Exp">
      <bpmn2:incoming>F1</bpmn2:incoming>
      <bpmn2:outgoing>F2</bpmn2:outgoing>
      <bpmn2:participantRef>P_Sub</bpmn2:participantRef>
      <bpmn2:participantRef>P_Exp</bpmn2:participantRef>
    </bpmn2:choreographyTask>
    <bpmn2:endEvent id="End_1">
      <bpmn2:incoming>F2</bpmn2:incoming>
    </bpmn2:endEvent>
    <bpmn2:sequenceFlow id="F1" sourceRef="Start_1" targetRef="Consent" />
    <bpmn2:sequenceFlow id="F2" sourceRef="Consent" targetRef="End_1" />
  </bpmn2:process>
</bpmn2:definitions>`;

test.describe('choreography wire format', () => {
  test('save emits the BPMN 2.0 choreography shape', async () => {
    const wire = await toWireXml(CANVAS_XML, moddle());
    const { rootElement } = await moddle().fromXML(wire);
    const choreography = rootElement.rootElements.find((re: any) => re.$type === 'bpmn:Choreography');
    expect(choreography).toBeTruthy();

    const task = choreography.flowElements.find((el: any) => el.$type === 'bpmn:ChoreographyTask');
    expect(choreography.participants.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
    expect(task.participantRef.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
    expect(task.initiatingParticipantRef.name).toBe('Experimenter');

    expect(choreography.messageFlows).toHaveLength(1);
    const flow = choreography.messageFlows[0];
    expect(task.messageFlowRef?.[0]).toBe(flow);
    expect(flow.sourceRef.name).toBe('Experimenter');
    expect(flow.targetRef.name).toBe('Subject');

    expect(rootElement.rootElements.some((re: any) => re.$type === 'bpmn:Collaboration')).toBe(false);
  });

  test('load folds the spec form back to the native canvas form', async () => {
    const wire = await toWireXml(CANVAS_XML, moddle());
    const canvas = await fromWireXml(wire, moddle());

    const { rootElement } = await moddle().fromXML(canvas);
    const process = rootElement.rootElements.find((re: any) => re.$type === 'bpmn:Process');
    const collaboration = rootElement.rootElements.find((re: any) => re.$type === 'bpmn:Collaboration');
    const task = process.flowElements.find((el: any) => el.$type === 'bpmn:ChoreographyTask');

    expect(collaboration).toBeTruthy();
    expect(collaboration.participants.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
    expect(task.participantRef.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
    expect(task.initiatingParticipantRef.name).toBe('Experimenter');

    expect(canvas).not.toContain('topParticipant');
    expect(canvas).not.toContain('messageFlowRef');
  });

  test('a root-level schema attribute the rewrite never heard of survives both directions', async () => {
    const authored = CANVAS_XML.replace(
      '<bpmn2:process id="Process_1" isExecutable="false">',
      '<bpmn2:process id="Process_1" isExecutable="false" studyflow:signature="abc123">',
    ).replace(
      'xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL"',
      'xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1"',
    );

    const wire = await toWireXml(authored, moddle());
    expect(wire).toContain('studyflow:signature="abc123"');
    const { rootElement: saved } = await moddle().fromXML(wire);
    const choreography = saved.rootElements.find((re: any) => re.$type === 'bpmn:Choreography');
    expect(choreography.$attrs['studyflow:signature']).toBe('abc123');

    const { rootElement: reloaded } = await moddle().fromXML(await fromWireXml(wire, moddle()));
    const process = reloaded.rootElements.find((re: any) => re.$type === 'bpmn:Process');
    expect(process.$attrs['studyflow:signature']).toBe('abc123');
    expect(wire).not.toContain('isExecutable');
  });

  test('what the root carries besides its flow survives both directions', async () => {
    // Root rewrite moves a fixed property list; anything missing from it is silently dropped on save.
    const authored = CANVAS_XML.replace(
      '<bpmn2:process id="Process_1" isExecutable="false">',
      `<bpmn2:process id="Process_1" name="Dyadic decision study" isExecutable="false">
    <bpmn2:documentation>A two-participant choreography.</bpmn2:documentation>
    <bpmn2:extensionElements><studyflow:study /></bpmn2:extensionElements>
    <studyflow:tags>Reference</studyflow:tags>
    <studyflow:tags>Study designs</studyflow:tags>`,
    ).replace(
      'xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL"',
      'xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1"',
    );

    const wire = await toWireXml(authored, moddle());
    const { rootElement: saved } = await moddle().fromXML(wire);
    const choreography = saved.rootElements.find((re: any) => re.$type === 'bpmn:Choreography');
    expect(choreography.name).toBe('Dyadic decision study');
    expect(choreography.get('tags')).toEqual(['Reference', 'Study designs']);
    expect(choreography.documentation?.[0]?.text).toContain('two-participant');
    expect(choreography.extensionElements?.values?.[0]?.$type).toBe('studyflow:Study');

    const { rootElement: reloaded } = await moddle().fromXML(await fromWireXml(wire, moddle()));
    const process = reloaded.rootElements.find((re: any) => re.$type === 'bpmn:Process');
    expect(process.name).toBe('Dyadic decision study');
    expect(process.get('tags')).toEqual(['Reference', 'Study designs']);
    expect(process.documentation?.[0]?.text).toContain('two-participant');
    expect(process.extensionElements?.values?.[0]?.$type).toBe('studyflow:Study');
  });
});
