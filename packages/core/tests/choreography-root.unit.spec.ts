
import { expect, test } from '@playwright/test';

import { fromWireXml, readChoreographyBands, toWireXml } from '@core/document';
import { freshModdle } from '@tests/schemas';

/** Choreography wire format: save emits the spec `bpmn:Choreography` shape, load folds back to process form. */

/** Canvas form: a Process of choreography tasks + a headless participant collaboration, and a root that carries more than its flow. */
const CANVAS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="chor_wire" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:collaboration id="Collab">
    <bpmn2:participant id="P_Sub" name="Subject" />
    <bpmn2:participant id="P_Exp" name="Experimenter" />
  </bpmn2:collaboration>
  <bpmn2:process id="Process_1" name="Dyadic decision study" isExecutable="false" studyflow:signature="abc123">
    <bpmn2:documentation>A two-participant choreography.</bpmn2:documentation>
    <bpmn2:extensionElements><studyflow:study /></bpmn2:extensionElements>
    <studyflow:tags>Reference</studyflow:tags>
    <studyflow:tags>Study designs</studyflow:tags>
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

test('save emits the BPMN 2.0 choreography shape, load folds it back, and the root keeps what it carries besides its flow', async () => {
  const wire = await toWireXml(CANVAS_XML, freshModdle());
  expect(wire).not.toContain('isExecutable');
  const { rootElement: saved } = await freshModdle().fromXML(wire);
  expect(saved.rootElements.some((re: any) => re.$type === 'bpmn:Collaboration')).toBe(false);
  const choreography = saved.rootElements.find((re: any) => re.$type === 'bpmn:Choreography');
  const task = choreography.flowElements.find((el: any) => el.$type === 'bpmn:ChoreographyTask');
  expect(choreography.participants.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
  expect(task.participantRef.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
  expect(task.initiatingParticipantRef.name).toBe('Experimenter');
  expect(choreography.messageFlows).toHaveLength(1);
  const [flow] = choreography.messageFlows;
  expect(task.messageFlowRef?.[0]).toBe(flow);
  expect(flow.sourceRef.name).toBe('Experimenter');
  expect(flow.targetRef.name).toBe('Subject');

  const canvas = await fromWireXml(wire, freshModdle());
  expect(canvas).not.toContain('topParticipant');
  expect(canvas).not.toContain('messageFlowRef');
  const { rootElement: reloaded } = await freshModdle().fromXML(canvas);
  const process = reloaded.rootElements.find((re: any) => re.$type === 'bpmn:Process');
  const collaboration = reloaded.rootElements.find((re: any) => re.$type === 'bpmn:Collaboration');
  const reloadedTask = process.flowElements.find((el: any) => el.$type === 'bpmn:ChoreographyTask');
  expect(collaboration.participants.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
  expect(reloadedTask.participantRef.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
  expect(reloadedTask.initiatingParticipantRef.name).toBe('Experimenter');

  // The rewrite moves a fixed property list, and attributes no schema declares (`$attrs`) apart: what it misses is dropped.
  for (const [label, root] of [['saved', choreography], ['reloaded', process]]) {
    expect(root.name, label).toBe('Dyadic decision study');
    expect(root.get('tags'), label).toEqual(['Reference', 'Study designs']);
    expect(root.documentation?.[0]?.text, label).toContain('two-participant');
    expect(root.extensionElements?.values?.[0]?.$type, label).toBe('studyflow:Study');
    expect(root.$attrs['studyflow:signature'], label).toBe('abc123');
  }
});

/** A runner stamps `prov:activity` into every element it ran; a stamp is not a type, so the task stays a plain exchange. */
test('a runner stamp on an untyped choreography task keeps its bands and its choreography root', async () => {
  const stamped = CANVAS_XML.replace(
    '<bpmn2:incoming>F1</bpmn2:incoming>',
    '<bpmn2:extensionElements><prov:activity action="executed" /></bpmn2:extensionElements><bpmn2:incoming>F1</bpmn2:incoming>',
  ).replace(
    'xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL"',
    'xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:prov="https://w3id.org/studyflow/prov"',
  );
  const { rootElement } = await freshModdle().fromXML(await toWireXml(stamped, freshModdle()));
  const choreography = rootElement.rootElements.find((re: any) => re.$type === 'bpmn:Choreography');
  expect(choreography).toBeTruthy();
  const task = choreography.flowElements.find((el: any) => el.$type === 'bpmn:ChoreographyTask');
  expect(task.extensionElements.values[0].$type).toBe('prov:Activity');
  expect(readChoreographyBands(task)).toEqual({ top: 'Subject', bottom: 'Experimenter', initiator: 'bottom' });
});

/** A collaboration with no pool only holds actors for the process; a plane naming it is pointed at the process on load. */
test('a plane naming a collaboration with no pool is pointed at the process on load; one with a pool is left alone', async () => {
  const xml = (participant: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" id="Definitions_1">
  <bpmn2:collaboration id="Actors">${participant}</bpmn2:collaboration>
  <bpmn2:process id="Process_1" isExecutable="false"><bpmn2:startEvent id="Start" /></bpmn2:process>
  <bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="Actors" /></bpmndi:BPMNDiagram>
</bpmn2:definitions>`;
  const planeRoot = async (source: string) =>
    (await freshModdle().fromXML(await fromWireXml(source, freshModdle()))).rootElement.diagrams[0].plane.bpmnElement.id;

  expect(await planeRoot(xml('<bpmn2:participant id="Claude" name="Claude" />'))).toBe('Process_1');
  expect(await planeRoot(xml('<bpmn2:participant id="Pool" name="Lab" processRef="Process_1" />'))).toBe('Actors');
});
