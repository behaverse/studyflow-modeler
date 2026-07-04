import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { fromWireXml, toWireXml } from '../src/core/codec/choreography';
import { SCHEMAS } from '../src/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/core/schema';

/**
 * Wire-format guarantees for choreography diagrams: saving a pure-choreography
 * process emits the BPMN 2.0 metamodel shape — a `bpmn:Choreography` root with
 * declared participants, `participantRef`/`initiatingParticipantRef` on each
 * task, and the exchange as a `bpmn:MessageFlow` (`messageFlows` on the root,
 * `messageFlowRef` on the task) — and loading folds it back to the canvas
 * process form carrying the studyflow band attributes.
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');

const models = SCHEMAS.map(({ prefix }) =>
  fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
);
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const moddle = () => new BpmnModdle(structuredClone(packages)) as any;

const CANVAS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="chor_wire" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:process id="Process_1" isExecutable="false">
    <bpmn2:startEvent id="Start_1">
      <bpmn2:outgoing>F1</bpmn2:outgoing>
    </bpmn2:startEvent>
    <bpmn2:choreographyTask id="Consent" name="Give consent" studyflow:topParticipant="Subject" studyflow:bottomParticipant="Experimenter" studyflow:initiator="bottom">
      <bpmn2:incoming>F1</bpmn2:incoming>
      <bpmn2:outgoing>F2</bpmn2:outgoing>
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

    // Participants declared once and referenced per task, top band first; the
    // initiating participant follows the band model (initiator="bottom").
    const task = choreography.flowElements.find((el: any) => el.$type === 'bpmn:ChoreographyTask');
    expect(choreography.participants.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
    expect(task.participantRef.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
    expect(task.initiatingParticipantRef.name).toBe('Experimenter');

    // The exchange itself: a message flow from initiating to receiving.
    expect(choreography.messageFlows).toHaveLength(1);
    const flow = choreography.messageFlows[0];
    expect(task.messageFlowRef?.[0]).toBe(flow);
    expect(flow.sourceRef.name).toBe('Experimenter');
    expect(flow.targetRef.name).toBe('Subject');

    // Band attributes stay off the wire.
    expect(wire).not.toContain('topParticipant');
    expect(wire).not.toContain('initiator=');
  });

  test('load folds the spec form back to the canvas band model', async () => {
    const wire = await toWireXml(CANVAS_XML, moddle());
    const canvas = await fromWireXml(wire, moddle());

    const { rootElement } = await moddle().fromXML(canvas);
    const process = rootElement.rootElements.find((re: any) => re.$type === 'bpmn:Process');
    const task = process.flowElements.find((el: any) => el.$type === 'bpmn:ChoreographyTask');

    expect(task.get('topParticipant')).toBe('Subject');
    expect(task.get('bottomParticipant')).toBe('Experimenter');
    expect(task.get('initiator')).toBe('bottom');

    // The spec references are dropped with the choreography root.
    expect(canvas).not.toContain('participantRef');
    expect(canvas).not.toContain('messageFlowRef');
  });
});
