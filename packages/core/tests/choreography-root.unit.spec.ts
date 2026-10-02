
import { expect, test } from '@playwright/test';

import { studyToXml, xmlToStudy } from '@core/document';
import { bandsOf, ensureParticipantsIn } from '@core/model/choreography';
import { documentationOf, StudyModel, type Element } from '@core/model/index';
import { freshMetamodel, xmlOf, yamlOf } from '@tests/schemas';

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
  const model = await xmlToStudy(CHOREOGRAPHY_XML, freshMetamodel());
  const roots = model.study.roots;
  expect(roots.some((root) => model.host(root) === 'bpmn:Choreography')).toBe(false);
  const process = roots.find((root) => model.host(root) === 'bpmn:Process')!;
  const collaboration = roots.find((root) => model.host(root) === 'bpmn:Collaboration')!;
  const task = model.get('Consent')!;
  const names = (ids: unknown) => (ids as string[]).map((id) => model.get(id)?.name);
  expect(task.type).toBe('bpmn:ChoreographyTask');
  expect((collaboration.participants as Element[]).map((p) => p.name)).toEqual(['Subject', 'Experimenter']);
  expect(names(task.participantRef)).toEqual(['Subject', 'Experimenter']);
  expect(model.get(String(task.initiatingParticipantRef))?.name).toBe('Experimenter');
  expect(task.messageFlowRef).toBeUndefined();
  expect(process.name).toBe('Dyadic decision study');
  // The Study it carried types it, as it types a process read as one.
  expect(process.type).toBe('studyflow:Study');
  expect(documentationOf(process)).toContain('two-participant');
  expect(model.studyOf(process)?.tags).toEqual(['Reference']);
  expect(process['studyflow:signature']).toBe('abc123');

  // Saved, it stays a process, and its exchange is the BPMN task it is.
  const saved = await studyToXml(model);
  expect(saved).not.toMatch(/<bpmn2?:choreography/);
  expect(saved).toMatch(/<bpmn2?:task id="Consent" name="Give consent" studyflow:exchange="true" studyflow:participants="P_Sub P_Exp" studyflow:initiator="P_Exp">/);
});

test('a choreography task\'s participant pair is minted, into a headless collaboration, on first need only', () => {
  const task: Element = { type: 'bpmn:ChoreographyTask', id: 'Consent', name: 'Give consent' };
  const model = new StudyModel({ id: 'Defs', definitions: {}, roots: [{ type: 'bpmn:Process', id: 'Proc', flowElements: [task] }], layout: {} }, freshMetamodel());
  let minted = 0;
  const ids = { next: (prefix: string) => `${prefix}${++minted}`, free: (base: string) => base };

  const [top, bottom] = ensureParticipantsIn(model, task, ids);
  // Two named participants, told apart by name.
  expect(top.name).toBeTruthy();
  expect(bottom.name).toBeTruthy();
  expect(top.name).not.toBe(bottom.name);

  expect(task.participantRef).toEqual([top.id, bottom.id]);
  expect(task.initiatingParticipantRef).toBe(top.id);
  const collaboration = model.study.roots.find((root) => root.type === 'bpmn:Collaboration')!;
  expect(collaboration.participants).toEqual([top, bottom]);
  expect(bandsOf(model, task)).toEqual({ top: top.name, bottom: bottom.name, initiator: 'top' });

  ensureParticipantsIn(model, task, ids);
  expect(collaboration.participants).toHaveLength(2);
});

/** A collaboration with no pool only holds actors for the process; a plane naming it is pointed at the process on load. */
test('a plane naming a collaboration with no pool is pointed at the process on load; one with a pool is left alone', async () => {
  const xml = (participant: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" id="Definitions_1">
  <bpmn2:collaboration id="Actors">${participant}</bpmn2:collaboration>
  <bpmn2:process id="Process_1" isExecutable="false"><bpmn2:startEvent id="Start" /></bpmn2:process>
  <bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="Actors" /></bpmndi:BPMNDiagram>
</bpmn2:definitions>`;
  const planeRoot = async (source: string) => (await xmlToStudy(source, freshMetamodel())).primaryRoot()?.id;

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
  const xml = await xmlOf(study);
  expect(xml).toMatch(/<bpmn:task id="Play" name="Play" studyflow:exchange="true" studyflow:participants="Robot">/);
  expect(xml).not.toContain('choreographyTask');
  expect(await yamlOf(xml)).toBe(study);
});
