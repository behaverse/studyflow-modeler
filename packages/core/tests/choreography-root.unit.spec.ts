
import { expect, test } from '@playwright/test';

import { ensureChoreographyParticipants, fromWireXml, readChoreographyBands, studyflowToXml, toWireXml, xmlToStudyflow } from '@core/document';
import { freshModdle } from '@tests/schemas';

/** A study is a process: a `bpmn:Choreography` from another tool is read as a process of exchanges, and a process of
 * exchanges is saved as one, each exchange in its BPMN XML the task it is. */

/** Another tool's choreography: the spec `bpmn:Choreography` shape, a root that carries more than its flow. */
const CHOREOGRAPHY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="chor_wire" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:choreography id="Process_1" name="Dyadic decision study" studyflow:signature="abc123">
    <bpmn2:documentation>A two-participant choreography.</bpmn2:documentation>
    <bpmn2:extensionElements><studyflow:study><studyflow:tags>Reference</studyflow:tags></studyflow:study></bpmn2:extensionElements>
    <bpmn2:participant id="P_Sub" name="Subject" />
    <bpmn2:participant id="P_Exp" name="Experimenter" />
    <bpmn2:messageFlow id="M1" sourceRef="P_Exp" targetRef="P_Sub" />
    <bpmn2:startEvent id="Start_1"><bpmn2:outgoing>F1</bpmn2:outgoing></bpmn2:startEvent>
    <bpmn2:choreographyTask id="Consent" name="Give consent" initiatingParticipantRef="P_Exp">
      <bpmn2:incoming>F1</bpmn2:incoming>
      <bpmn2:outgoing>F2</bpmn2:outgoing>
      <bpmn2:participantRef>P_Sub</bpmn2:participantRef>
      <bpmn2:participantRef>P_Exp</bpmn2:participantRef>
      <bpmn2:messageFlowRef>M1</bpmn2:messageFlowRef>
    </bpmn2:choreographyTask>
    <bpmn2:endEvent id="End_1"><bpmn2:incoming>F2</bpmn2:incoming></bpmn2:endEvent>
    <bpmn2:sequenceFlow id="F1" sourceRef="Start_1" targetRef="Consent" />
    <bpmn2:sequenceFlow id="F2" sourceRef="Consent" targetRef="End_1" />
  </bpmn2:choreography>
</bpmn2:definitions>`;

test('a choreography is read as a process of exchanges, keeps what its root carries, and is saved as a process', async () => {
  const opened = await fromWireXml(CHOREOGRAPHY_XML, freshModdle());
  const { rootElement: definitions } = await freshModdle().fromXML(opened);
  const process = definitions.rootElements.find((re: any) => re.$type === 'bpmn:Process');
  const collaboration = definitions.rootElements.find((re: any) => re.$type === 'bpmn:Collaboration');
  expect(definitions.rootElements.some((re: any) => re.$type === 'bpmn:Choreography')).toBe(false);
  const task = process.flowElements.find((el: any) => el.id === 'Consent');
  expect(task.$type).toBe('bpmn:ChoreographyTask');
  expect(collaboration.participants.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
  expect(task.participantRef.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
  expect(task.initiatingParticipantRef.name).toBe('Experimenter');
  expect(task.messageFlowRef ?? []).toEqual([]);
  expect(process.name).toBe('Dyadic decision study');
  expect(process.documentation?.[0]?.text).toContain('two-participant');
  expect(process.extensionElements?.values?.[0]?.tags).toEqual(['Reference']);
  expect(process.$attrs['studyflow:signature']).toBe('abc123');

  // Saved, it stays a process, and its exchange is the BPMN task it is.
  const saved = await toWireXml(opened, freshModdle());
  expect(saved).not.toMatch(/<bpmn2?:choreography/);
  expect(saved).toMatch(/<bpmn2?:task id="Consent" name="Give consent" studyflow:exchange="true" studyflow:participants="P_Sub P_Exp" studyflow:initiator="P_Exp">/);
});

test('a choreography task\'s participant pair is minted, into a headless collaboration, on first need only', () => {
  const moddle = freshModdle();
  const task = moddle.create('bpmn:ChoreographyTask', { id: 'Consent', name: 'Give consent' });
  const process = moddle.create('bpmn:Process', { id: 'Proc', flowElements: [task] });
  const definitions = moddle.create('bpmn:Definitions', { id: 'Defs', rootElements: [process] });
  task.$parent = process;
  process.$parent = definitions;
  let minted = 0;
  const ids = { nextPrefixed: (prefix: string) => `${prefix}${++minted}` };

  const [top, bottom] = ensureChoreographyParticipants(task, ids)!;
  // Two named participants, told apart by name.
  expect(top.name).toBeTruthy();
  expect(bottom.name).toBeTruthy();
  expect(top.name).not.toBe(bottom.name);

  expect(task.get('participantRef')).toEqual([top, bottom]);
  expect(task.get('initiatingParticipantRef')).toBe(top);
  const collaboration = definitions.get('rootElements').find((r: any) => r.$type === 'bpmn:Collaboration');
  expect(collaboration.get('participants')).toEqual([top, bottom]);
  expect(readChoreographyBands(task)).toEqual({ top: top.name, bottom: bottom.name, initiator: 'top' });

  ensureChoreographyParticipants(task, ids);
  expect(collaboration.get('participants')).toHaveLength(2);
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

test('a choreography task in a process is written as the BPMN task it is, marked, with its bands and data, and reads back', async () => {
  // BPMN defines choreography tasks only in a choreography, and gives them no data: a typed one in a process, with an
  // actor on its bands and a data edge in, is a task.
  const study = `id: exchange
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Subjects:
      name: Subjects
      processRef: S
    Robot:
      name: Robot
S:
  type: Process
  flowElements:
    Settings:
      type: DataObjectReference
    Play:
      type: cognitive:CognitiveTask
      name: Play
      platform: jsPsych
      participantRef:
        - Robot
      dataInputAssociations:
        In_Play:
          sourceRef:
            - Settings
`;
  const xml = await studyflowToXml(study, freshModdle());
  expect(xml).toMatch(/<bpmn:task id="Play" name="Play" studyflow:exchange="true" studyflow:participants="Robot">/);
  expect(xml).not.toContain('choreographyTask');
  expect(await xmlToStudyflow(xml, freshModdle())).toBe(study);
});
