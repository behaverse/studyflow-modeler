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
 * process form, where the same native references are preserved and the
 * participants are hosted in a headless `bpmn:Collaboration` (a `Participant`
 * is not a `RootElement`, so it needs a collaboration container; bpmn-js draws
 * no pool for a plane-less one).
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');

const models = SCHEMAS.map(({ prefix }) =>
  fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
);
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

    // Participants declared once on the choreography and referenced per task,
    // top band first; the initiating participant is the Experimenter.
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

    // The transient participant collaboration is consumed into the choreography.
    expect(rootElement.rootElements.some((re: any) => re.$type === 'bpmn:Collaboration')).toBe(false);
  });

  test('load folds the spec form back to the native canvas form', async () => {
    const wire = await toWireXml(CANVAS_XML, moddle());
    const canvas = await fromWireXml(wire, moddle());

    const { rootElement } = await moddle().fromXML(canvas);
    const process = rootElement.rootElements.find((re: any) => re.$type === 'bpmn:Process');
    const collaboration = rootElement.rootElements.find((re: any) => re.$type === 'bpmn:Collaboration');
    const task = process.flowElements.find((el: any) => el.$type === 'bpmn:ChoreographyTask');

    // The task keeps BPMN's own references; the participants live in the headless
    // collaboration so those references still resolve on the canvas Process.
    expect(collaboration).toBeTruthy();
    expect(collaboration.participants.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
    expect(task.participantRef.map((p: any) => p.name)).toEqual(['Subject', 'Experimenter']);
    expect(task.initiatingParticipantRef.name).toBe('Experimenter');

    // No studyflow band attributes are introduced, and the message flow that
    // dies with the choreography root leaves no dangling reference.
    expect(canvas).not.toContain('topParticipant');
    expect(canvas).not.toContain('messageFlowRef');
  });
});
