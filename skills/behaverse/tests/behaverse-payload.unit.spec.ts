import { expect, test } from '@playwright/test';

import { parseStudyflow } from '@runner/studyflow';
import { botForUnity } from '@skills/behaverse/browser/botConfig';
import { getBehaverseTaskPayload } from '@skills/behaverse/browser/parser';
import type { BehaverseBotPayload, BehaverseTaskPayload } from '@skills/behaverse/browser/types';
import type { FlowNode } from '@runner/flow';
import { freshPackages } from '@tests/schemas';

/** The `RunCognitiveTask` wire contract, from the runner side. */

async function payloadOf(xml: string): Promise<BehaverseTaskPayload | null> {
  const { flowNodes } = await parseStudyflow(xml, freshPackages());
  return getBehaverseTaskPayload(flowNodes.get('TheTask') as FlowNode);
}

/** Parameters data objects, one per YAML text, each wired into `TheTask`. */
function wiredParameters(values: string[]): { objects: string; wires: string } {
  return {
    objects: values.map((text, i) => `<bpmn2:dataObjectReference id="P${i + 1}"><bpmn2:extensionElements><studyflow:parameters><studyflow:values>${text}</studyflow:values></studyflow:parameters></bpmn2:extensionElements></bpmn2:dataObjectReference>`).join('\n'),
    wires: values.map((_, i) => `<bpmn2:dataInputAssociation id="In_P${i + 1}"><bpmn2:sourceRef>P${i + 1}</bpmn2:sourceRef></bpmn2:dataInputAssociation>`).join(''),
  };
}

/** The task, reading the Parameters objects `values` spell. */
function taskXml(...values: string[]): string {
  const { objects, wires } = wiredParameters(values);
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" id="payload_fixture" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:process id="PayloadFixture" name="Payload fixture">
    <bpmn2:extensionElements>
      <studyflow:study />
    </bpmn2:extensionElements>
    <bpmn2:task id="TheTask" name="The task">
      <bpmn2:extensionElements>
        <behaverse:task instrument="NB" />
      </bpmn2:extensionElements>
      ${wires}
    </bpmn2:task>
    ${objects}
  </bpmn2:process>
</bpmn2:definitions>`;
}

/** A cognitive task whose lower band is `actor`, with a Prompt and its Parameters wired into it. */
function bandsXml(actor: string): string {
  const { objects, wires } = wiredParameters(['Bot: {Speed: 20}']);
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" xmlns:agentic="https://w3id.org/studyflow/agentic" xmlns:reachy="https://w3id.org/studyflow/reachy" id="bands_fixture" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:collaboration id="Actors">
    <bpmn2:participant id="Screen" name="Screen"><bpmn2:extensionElements><studyflow:actor actorType="hardware" /></bpmn2:extensionElements></bpmn2:participant>
    <bpmn2:participant id="Taker" name="Taker"><bpmn2:extensionElements>${actor}</bpmn2:extensionElements></bpmn2:participant>
  </bpmn2:collaboration>
  <bpmn2:process id="BandsFixture" name="Bands fixture">
    <bpmn2:extensionElements><studyflow:study /></bpmn2:extensionElements>
    <bpmn2:choreographyTask id="TheTask" name="The task" initiatingParticipantRef="Screen">
      <bpmn2:extensionElements><behaverse:task instrument="NB" timeline="XCIT_NB_01" /></bpmn2:extensionElements>
      <bpmn2:participantRef>Screen</bpmn2:participantRef><bpmn2:participantRef>Taker</bpmn2:participantRef>
      <bpmn2:dataInputAssociation id="In1"><bpmn2:sourceRef>Instructions</bpmn2:sourceRef></bpmn2:dataInputAssociation>
      ${wires}
    </bpmn2:choreographyTask>
    ${objects}
    <bpmn2:dataObjectReference id="Instructions" name="Instructions"><bpmn2:extensionElements><agentic:prompt><agentic:template>Answer Match or NonMatch.</agentic:template></agentic:prompt></bpmn2:extensionElements></bpmn2:dataObjectReference>
  </bpmn2:process>
</bpmn2:definitions>`;
}

/** The task in a human pool, with unnamed message flows to two partners. */
const TWO_PARTNERS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" id="partners_fixture" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:collaboration id="C">
    <bpmn2:participant id="Lab" name="Lab" processRef="P"><bpmn2:extensionElements><studyflow:actor actorType="human" /></bpmn2:extensionElements></bpmn2:participant>
    <bpmn2:participant id="Claude" name="Claude"><bpmn2:extensionElements><studyflow:actor actorType="llm" implementation="claude://claude-haiku-4-5" /></bpmn2:extensionElements></bpmn2:participant>
    <bpmn2:participant id="Agent" name="Agent"><bpmn2:extensionElements><studyflow:actor actorType="software" implementation="my-agent" /></bpmn2:extensionElements></bpmn2:participant>
    <bpmn2:messageFlow id="M1" sourceRef="TheTask" targetRef="Claude" />
    <bpmn2:messageFlow id="M2" sourceRef="TheTask" targetRef="Agent" />
  </bpmn2:collaboration>
  <bpmn2:process id="P"><bpmn2:extensionElements><studyflow:study /></bpmn2:extensionElements>
    <bpmn2:choreographyTask id="TheTask" name="The task"><bpmn2:extensionElements><behaverse:task instrument="NB" timeline="XCIT_NB_01" /></bpmn2:extensionElements></bpmn2:choreographyTask>
  </bpmn2:process>
</bpmn2:definitions>`;

const PROMPT = 'Answer Match or NonMatch.';

test('what Unity receives: the payload a task builds, its bot less the keys only the runner reads', async () => {
  // `unityBot`, where it differs, is `botForUnity` of the payload's bot: Unity throws on a field it does not know.
  const CASES: {
    label: string;
    xml: string;
    /** The instrument is the fixture's own NB, and the timeline XCIT_NB_01, unless a row says otherwise. */
    payload?: Omit<BehaverseTaskPayload, 'scene' | 'timeline' | 'metadata'> & { scene?: string; timeline?: string };
    unityBot?: BehaverseBotPayload;
    error?: RegExp;
  }[] = [
    {
      label: 'a timeline the task names runs the build\'s own, with no GameConfig to send, and a person with no one named takes it',
      xml: taskXml('timeline: XCIT_NB_01\n'),
      payload: { agentType: 'human', configMode: 'builtin' },
    },
    {
      label: 'a timeline the Parameters define runs inline and keeps its definition',
      xml: taskXml('timeline: T1\nBlocks:\n  B1:\n    Name: B1\nTimelines:\n  T1:\n    Name: T1\n    blocks:\n      - name: B1\n'),
      payload: {
        agentType: 'human', configMode: 'inline', timeline: 'T1',
        parameters: { Blocks: { B1: { Name: 'B1' } }, Timelines: { T1: { Name: 'T1', blocks: [{ name: 'B1' }] } } },
      },
    },
    {
      label: 'inline overrides beside a timeline the build ships run inline over it',
      xml: taskXml('timeline: XCIT_NB_01\nBlocks:\n  B1:\n    Name: B1\n'),
      payload: { agentType: 'human', configMode: 'inline', parameters: { Blocks: { B1: { Name: 'B1' } } } },
    },
    {
      // Nothing drawn orders the wires, so the objects merge key by key and a value set twice is refused.
      label: 'two Parameters objects wired into the task merge into one GameConfig',
      xml: taskXml('timeline: XCIT_NB_01\n', 'Blocks:\n  B1:\n    Name: B1\n'),
      payload: { agentType: 'human', configMode: 'inline', parameters: { Blocks: { B1: { Name: 'B1' } } } },
    },
    {
      label: 'a timeline the task names runs, not the first one the Parameters define',
      xml: taskXml('timeline: T2\nTimelines:\n  T1: {Name: T1}\n  T2: {Name: T2}\n'),
      payload: {
        agentType: 'human', configMode: 'inline', timeline: 'T2',
        parameters: { Timelines: { T1: { Name: 'T1' }, T2: { Name: 'T2' } } },
      },
    },
    {
      // `instrument` names an attribute of the task: it runs WO in place of the task's own NB, and never reaches the GameConfig.
      label: 'an instrument the wired Parameters set is the instrument that runs',
      xml: taskXml('instrument: WO\ntimeline: SimonTask\n'),
      payload: { scene: 'WO', agentType: 'human', configMode: 'builtin', timeline: 'SimonTask' },
    },
    {
      label: 'a task naming no timeline has no trials to run, and is refused',
      xml: taskXml('Blocks:\n  B1:\n    Name: B1\n'),
      error: /timeline/,
    },
    {
      // Unity null-merges `parameters` over the build's own, so an empty entry would erase that timeline, not name it.
      label: 'an empty Timelines entry defines nothing, and is refused',
      xml: taskXml('timeline: XCIT_NB_01\nTimelines:\n  XCIT_NB_01:\n'),
      error: /XCIT_NB_01/,
    },
    {
      label: 'a value two wired Parameters objects both set is an error naming both',
      xml: taskXml('Bot:\n  Speed: 20\n', 'Bot:\n  Speed: 5\n'),
      error: /TheTask.*Bot\.Speed.*P1.*P2/,
    },
    {
      label: 'a model on the lower band answers through the runner, with the wired Prompt; Unity waits for an external answer',
      xml: bandsXml('<studyflow:actor actorType="llm" implementation="claude://claude-haiku-4-5" />'),
      payload: {
        agentType: 'bot', configMode: 'builtin',
        bot: { Speed: 20, ResponseSource: 'llm', LLM: { Provider: 'claude', Model: 'claude-haiku-4-5' }, Prompt: PROMPT },
      },
      unityBot: { Speed: 20, ResponseSource: 'external' },
    },
    {
      label: 'a model on the lower band names the model it is, never a default',
      xml: bandsXml('<studyflow:actor actorType="llm" />'),
      error: /implementation/,
    },
    {
      label: 'the build\'s random bot takes the task when the band says so, a software actor whose implementation is random',
      xml: bandsXml('<studyflow:actor actorType="software" implementation="random" />'),
      payload: { agentType: 'bot', configMode: 'builtin', bot: { Speed: 20 } },
    },
    {
      // Its answers come along message flows from its own steps, which only the local runtime carries.
      label: 'a robot on the lower band is refused here, and no one stands in for it',
      xml: bandsXml('<reachy:robot />'),
      error: /local runtime/,
    },
    {
      label: 'a `Bot:` entry naming who answers is refused: the drawing says that',
      xml: taskXml('timeline: XCIT_NB_01\nBot:\n  ResponseSource: external'),
      error: /ResponseSource/,
    },
    {
      label: 'a person on the lower band plays the task, with no bot',
      xml: bandsXml('<studyflow:actor actorType="human" />'),
      payload: { agentType: 'human', configMode: 'builtin' },
    },
    {
      // Nothing says which partner answers, and the file's order is not an answer.
      label: 'unnamed message flows to two partners are an error',
      xml: TWO_PARTNERS_XML,
      error: /Claude.*Agent.*messageRef/,
    },
  ];

  for (const { label, xml, payload, unityBot, error } of CASES) {
    if (error) {
      await expect(payloadOf(xml), label).rejects.toThrow(error);
      continue;
    }
    const built = await payloadOf(xml);
    expect(built, label).toEqual({ scene: 'NB', timeline: 'XCIT_NB_01', metadata: { studyflowNodeId: 'TheTask' }, ...payload });
    expect(botForUnity(built?.bot), `${label}: the bot Unity gets`).toEqual(unityBot ?? payload?.bot);
  }
});
