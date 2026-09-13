import { expect, test } from '@playwright/test';
import { freshPackages } from '@tests/schemas';

import { parseStudyflow } from '@runner/studyflow';
import { botForUnity } from '@skills/behaverse/browser/botConfig';
import { getBehaverseTaskPayload } from '@skills/behaverse/browser/parser';
import type { BehaverseBotPayload, BehaverseTaskPayload } from '@skills/behaverse/browser/types';
import type { FlowNode } from '@runner/flow';

/** The `RunCognitiveTask` wire contract, from the runner side. */

async function payloadOf(xml: string): Promise<BehaverseTaskPayload | null> {
  const { flowNodes } = await parseStudyflow(xml, freshPackages());
  return getBehaverseTaskPayload(flowNodes.get('TheTask') as FlowNode);
}

function taskXml(configurations: string): string {
  const indented = `${configurations.trimEnd()}\nBot:\n  ResponseSource: external`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" id="payload_fixture" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:process id="PayloadFixture" name="Payload fixture">
    <bpmn2:extensionElements>
      <studyflow:study />
    </bpmn2:extensionElements>
    <bpmn2:task id="TheTask" name="The task">
      <bpmn2:extensionElements>
        <behaverse:task scene="NB" agentType="bot">
          <cognitive:configurations>${indented}</cognitive:configurations>
        </behaverse:task>
      </bpmn2:extensionElements>
    </bpmn2:task>
  </bpmn2:process>
</bpmn2:definitions>`;
}

/** A cognitive task whose lower band is `actor`, with a Prompt wired into it. */
function bandsXml(actor: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" xmlns:agentic="https://w3id.org/studyflow/agentic" xmlns:reachy="https://w3id.org/studyflow/reachy" id="bands_fixture" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:collaboration id="Actors">
    <bpmn2:participant id="Screen" name="Screen"><bpmn2:extensionElements><cognitive:actor actorType="hardware" /></bpmn2:extensionElements></bpmn2:participant>
    <bpmn2:participant id="Taker" name="Taker"><bpmn2:extensionElements>${actor}</bpmn2:extensionElements></bpmn2:participant>
  </bpmn2:collaboration>
  <bpmn2:process id="BandsFixture" name="Bands fixture">
    <bpmn2:extensionElements><studyflow:study /></bpmn2:extensionElements>
    <bpmn2:choreographyTask id="TheTask" name="The task" initiatingParticipantRef="Screen">
      <bpmn2:extensionElements><behaverse:task scene="NB"><cognitive:configurations>Bot: {Speed: 20}</cognitive:configurations></behaverse:task></bpmn2:extensionElements>
      <bpmn2:participantRef>Screen</bpmn2:participantRef><bpmn2:participantRef>Taker</bpmn2:participantRef>
      <bpmn2:dataInputAssociation id="In1"><bpmn2:sourceRef>Instructions</bpmn2:sourceRef></bpmn2:dataInputAssociation>
    </bpmn2:choreographyTask>
    <bpmn2:dataObjectReference id="Instructions" name="Instructions"><bpmn2:extensionElements><agentic:prompt><agentic:template>Answer Match or NonMatch.</agentic:template></agentic:prompt></bpmn2:extensionElements></bpmn2:dataObjectReference>
  </bpmn2:process>
</bpmn2:definitions>`;
}

/** The task in a human pool, with unnamed message flows to two partners. */
const TWO_PARTNERS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" id="partners_fixture" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:collaboration id="C">
    <bpmn2:participant id="Lab" name="Lab" processRef="P"><bpmn2:extensionElements><cognitive:actor actorType="human" /></bpmn2:extensionElements></bpmn2:participant>
    <bpmn2:participant id="Claude" name="Claude"><bpmn2:extensionElements><cognitive:actor actorType="llm" implementation="claude://claude-haiku-4-5" /></bpmn2:extensionElements></bpmn2:participant>
    <bpmn2:participant id="Agent" name="Agent"><bpmn2:extensionElements><cognitive:actor actorType="software" implementation="my-agent" /></bpmn2:extensionElements></bpmn2:participant>
    <bpmn2:messageFlow id="M1" sourceRef="TheTask" targetRef="Claude" />
    <bpmn2:messageFlow id="M2" sourceRef="TheTask" targetRef="Agent" />
  </bpmn2:collaboration>
  <bpmn2:process id="P"><bpmn2:extensionElements><studyflow:study /></bpmn2:extensionElements>
    <bpmn2:choreographyTask id="TheTask" name="The task"><bpmn2:extensionElements><behaverse:task scene="NB" /></bpmn2:extensionElements></bpmn2:choreographyTask>
  </bpmn2:process>
</bpmn2:definitions>`;

const PROMPT = 'Answer Match or NonMatch.';

test('what Unity receives: the payload a task builds, its bot less the keys only the runner reads', async () => {
  // `unityBot`, where it differs, is `botForUnity` of the payload's bot: Unity throws on a field it does not know.
  const CASES: {
    label: string;
    xml: string;
    payload?: Omit<BehaverseTaskPayload, 'scene' | 'metadata'>;
    unityBot?: BehaverseBotPayload;
    error?: RegExp;
  }[] = [
    {
      label: 'a timeline named but not defined runs the build\'s own, and `Bot:` leaves the parameters for the bot',
      xml: taskXml('Timelines:\n  XCIT_NB_01:\n'),
      payload: { agentType: 'bot', configMode: 'builtin', timeline: 'XCIT_NB_01', bot: { ResponseSource: 'external' } },
    },
    {
      label: 'an inline timeline definition runs inline and keeps its definition',
      xml: taskXml('Blocks:\n  B1:\n    Name: B1\nTimelines:\n  T1:\n    Name: T1\n    blocks:\n      - name: B1\n'),
      payload: {
        agentType: 'bot', configMode: 'inline', timeline: 'T1', bot: { ResponseSource: 'external' },
        parameters: { Blocks: { B1: { Name: 'B1' } }, Timelines: { T1: { Name: 'T1', blocks: [{ name: 'B1' }] } } },
      },
    },
    {
      // Unity null-merges `parameters` over the build's own, so a by-name entry would erase that timeline.
      label: 'inline overrides beside a timeline reference ship without the reference entry',
      xml: taskXml('Blocks:\n  B1:\n    Name: B1\nTimelines:\n  XCIT_NB_01:\n'),
      payload: {
        agentType: 'bot', configMode: 'inline', timeline: 'XCIT_NB_01', bot: { ResponseSource: 'external' },
        parameters: { Blocks: { B1: { Name: 'B1' } } },
      },
    },
    {
      label: 'a reference among inline timelines is stripped, and the first key still names the run',
      xml: taskXml('Timelines:\n  XCIT_NB_01:\n  T1:\n    Name: T1\n    blocks: []\n'),
      payload: {
        agentType: 'bot', configMode: 'inline', timeline: 'XCIT_NB_01', bot: { ResponseSource: 'external' },
        parameters: { Timelines: { T1: { Name: 'T1', blocks: [] } } },
      },
    },
    {
      label: 'a model on the lower band answers through the runner, with the wired Prompt; Unity waits for an external answer',
      xml: bandsXml('<cognitive:actor actorType="llm" implementation="claude://claude-haiku-4-5" />'),
      payload: {
        agentType: 'bot', configMode: 'builtin',
        bot: { Speed: 20, ResponseSource: 'llm', LLM: { Provider: 'claude', Model: 'claude-haiku-4-5' }, Prompt: PROMPT },
      },
      unityBot: { Speed: 20, ResponseSource: 'external' },
    },
    {
      label: 'a robot on the lower band answers over its bridge, where the schema\'s default says it listens',
      xml: bandsXml('<reachy:robot />'),
      payload: {
        agentType: 'bot', configMode: 'builtin',
        bot: { Speed: 20, ResponseSource: 'external', BridgeUrl: 'ws://localhost:8765', Prompt: PROMPT },
      },
      unityBot: { Speed: 20, ResponseSource: 'external' },
    },
    {
      label: 'a person on the lower band plays the task, with no bot',
      xml: bandsXml('<cognitive:actor actorType="human" />'),
      payload: { agentType: 'human', configMode: 'builtin' },
    },
    {
      // Nothing says which partner answers, and the file's order is not an answer.
      label: 'unnamed message flows to two partners are an error',
      xml: TWO_PARTNERS_XML,
      error: /Claude, Agent.*messageRef/,
    },
  ];

  for (const { label, xml, payload, unityBot, error } of CASES) {
    if (error) {
      await expect(payloadOf(xml), label).rejects.toThrow(error);
      continue;
    }
    const built = await payloadOf(xml);
    expect(built, label).toEqual({ scene: 'NB', metadata: { studyflowNodeId: 'TheTask' }, ...payload });
    expect(botForUnity(built?.bot), `${label}: the bot Unity gets`).toEqual(unityBot ?? payload?.bot);
  }
});
