import { expect, test } from '@playwright/test';

import { buildCatalog, setCatalog } from '@core/notation';
import { parseStudyflow } from '@runner/studyflow';
import { getBehaverseTaskPayload } from '@skills/behaverse/browser/parser';
import type { FlowNode } from '@runner/flow';
import { loadSchemaModels, schemaPackages } from '@tests/schemas';
import { exampleXml } from '@tests/utils';

/** The `RunCognitiveTask` wire contract, from the runner side. */

const models = loadSchemaModels();
const packages: Record<string, any> = schemaPackages(models);
// `getAttribute` resolves wrapper bodies through the catalog, so payload extraction needs it populated.
setCatalog(buildCatalog(models));

async function payloadsOf(xml: string): Promise<Map<string, ReturnType<typeof getBehaverseTaskPayload>>> {
  const { flowNodes } = await parseStudyflow(xml, packages);
  const payloads = new Map<string, ReturnType<typeof getBehaverseTaskPayload>>();
  for (const [id, node] of flowNodes) {
    const payload = getBehaverseTaskPayload(node as FlowNode);
    if (payload) payloads.set(id, payload);
  }
  return payloads;
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

test('a by-name-only timeline reference runs builtin, with no parameters on the wire', async () => {
  const payloads = await payloadsOf(taskXml('Timelines:\n  XCIT_NB_01:\n'));
  const payload = payloads.get('TheTask')!;
  expect(payload.configMode).toBe('builtin');
  expect(payload.timeline).toBe('XCIT_NB_01');
  expect(payload.parameters).toBeUndefined();
  // `Bot:` leaves `configurations` for the payload's own `bot`, so it never reaches Unity's GameConfig.
  expect(payload.bot).toEqual({ ResponseSource: 'external' });
});

test('an inline timeline definition runs inline and keeps its definition', async () => {
  const payloads = await payloadsOf(taskXml(
    'Blocks:\n  B1:\n    Name: B1\nTimelines:\n  T1:\n    Name: T1\n    blocks:\n      - name: B1\n',
  ));
  const payload = payloads.get('TheTask')!;
  expect(payload.configMode).toBe('inline');
  expect(payload.timeline).toBe('T1');
  expect(payload.parameters?.Blocks).toEqual({ B1: { Name: 'B1' } });
  expect(payload.parameters?.Timelines).toEqual({ T1: { Name: 'T1', blocks: [{ name: 'B1' }] } });
});

test('inline overrides alongside a timeline reference ship without the reference entry', async () => {
  // Stripping the by-name reference leaves the build's own definition untouched under Unity's null-merge.
  const payloads = await payloadsOf(taskXml(
    'Blocks:\n  B1:\n    Name: B1\nTimelines:\n  XCIT_NB_01:\n',
  ));
  const payload = payloads.get('TheTask')!;
  expect(payload.configMode).toBe('inline');
  expect(payload.timeline).toBe('XCIT_NB_01');
  expect(payload.parameters?.Blocks).toEqual({ B1: { Name: 'B1' } });
  expect(payload.parameters && 'Timelines' in payload.parameters).toBe(false);
});

test('references mixed among inline timelines are stripped; the first authored key still names the run', async () => {
  const payloads = await payloadsOf(taskXml(
    'Timelines:\n  XCIT_NB_01:\n  T1:\n    Name: T1\n    blocks: []\n',
  ));
  const payload = payloads.get('TheTask')!;
  expect(payload.configMode).toBe('inline');
  expect(payload.timeline).toBe('XCIT_NB_01');
  expect(payload.parameters?.Timelines).toEqual({ T1: { Name: 'T1', blocks: [] } });
});

test('an empty configurations body stays builtin with no timeline pinned', async () => {
  const payloads = await payloadsOf(taskXml('\n'));
  const payload = payloads.get('TheTask')!;
  expect(payload.configMode).toBe('builtin');
  expect(payload.timeline).toBeUndefined();
  expect(payload.parameters).toBeUndefined();
});

test('shipped bot examples derive the modes their tasks need', async () => {
  // bot_claude: two fully-inline NB blocks and one builtin WO reference.
  const payloads = await payloadsOf(exampleXml('bot_claude.studyflow.png'));

  const warmup = payloads.get('Warmup_1Back')!;
  expect(warmup.configMode).toBe('inline');
  expect(warmup.timeline).toBe('Demo4_Warmup');
  expect(warmup.agentType).toBe('bot');
  expect(warmup.parameters?.Blocks).toBeDefined();
  expect((warmup.bot as Record<string, unknown>).ResponseSource).toBe('llm');

  const whichOne = payloads.get('Visual_WhichOne')!;
  expect(whichOne.configMode).toBe('builtin');
  expect(whichOne.timeline).toBe('SimonTask');
  expect(whichOne.parameters).toBeUndefined();
  expect((whichOne.bot as Record<string, unknown>).IncludeScreenshot).toBe(true);
});

/** Who takes a cognitive task: the pool it sits in, unless a band on it names another party. */
function bandsXml(actor: string, options: { bands?: boolean | 'actor'; pool?: boolean; prompt?: boolean } = {}): string {
  const { bands = true, pool = false, prompt = false } = options;
  const taker = `<bpmn2:participant id="Taker" name="Taker"${pool ? ' processRef="BandsFixture"' : ''}><bpmn2:extensionElements>${actor}</bpmn2:extensionElements></bpmn2:participant>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" xmlns:agentic="https://w3id.org/studyflow/agentic" xmlns:reachy="https://w3id.org/studyflow/reachy" id="bands_fixture" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:collaboration id="Actors">
    <bpmn2:participant id="Screen" name="Screen"><bpmn2:extensionElements><cognitive:actor actorType="hardware" /></bpmn2:extensionElements></bpmn2:participant>
    ${taker}
  </bpmn2:collaboration>
  <bpmn2:process id="BandsFixture" name="Bands fixture">
    <bpmn2:extensionElements><studyflow:study /></bpmn2:extensionElements>
    <bpmn2:choreographyTask id="TheTask" name="The task"${bands === true ? ' initiatingParticipantRef="Screen"' : ''}>
      <bpmn2:extensionElements><behaverse:task scene="NB"><cognitive:configurations>Bot: {Speed: 20}</cognitive:configurations></behaverse:task></bpmn2:extensionElements>
      ${bands === true ? '<bpmn2:participantRef>Screen</bpmn2:participantRef><bpmn2:participantRef>Taker</bpmn2:participantRef>' : bands === 'actor' ? '<bpmn2:participantRef>Taker</bpmn2:participantRef>' : ''}
      ${prompt ? '<bpmn2:dataInputAssociation id="In1"><bpmn2:sourceRef>Instructions</bpmn2:sourceRef></bpmn2:dataInputAssociation>' : ''}
    </bpmn2:choreographyTask>
    <bpmn2:dataObjectReference id="Instructions" name="Instructions"><bpmn2:extensionElements><agentic:prompt><agentic:template>Answer Match or NonMatch.</agentic:template></agentic:prompt></bpmn2:extensionElements></bpmn2:dataObjectReference>
  </bpmn2:process>
</bpmn2:definitions>`;
}

const CLAUDE = '<cognitive:actor actorType="llm" implementation="claude://claude-haiku-4-5" />';

test('the actor on the lower band decides who answers: a model, a robot, or a person', async () => {
  const llm = (await payloadsOf(bandsXml(CLAUDE))).get('TheTask')!;
  expect(llm.agentType).toBe('bot');
  expect(llm.bot).toEqual({ Speed: 20, ResponseSource: 'llm', LLM: { Provider: 'claude', Model: 'claude-haiku-4-5' } });

  const robot = (await payloadsOf(bandsXml('<reachy:robot />'))).get('TheTask')!;
  expect(robot.agentType).toBe('bot');
  // A robot's trials go to its bridge; unset, the schema's default says where.
  expect(robot.bot).toEqual({ Speed: 20, ResponseSource: 'external', BridgeUrl: 'ws://localhost:8765' });

  const human = (await payloadsOf(bandsXml('<cognitive:actor actorType="human" />'))).get('TheTask')!;
  expect(human.agentType).toBe('human');
  expect(human.bot).toBeUndefined();
});

test('with no band, the pool the task sits in takes it, and a wired Prompt is its instructions', async () => {
  const pooled = (await payloadsOf(bandsXml(CLAUDE, { bands: false, pool: true, prompt: true }))).get('TheTask')!;
  expect(pooled.agentType).toBe('bot');
  expect(pooled.bot).toEqual({
    Speed: 20, ResponseSource: 'llm', LLM: { Provider: 'claude', Model: 'claude-haiku-4-5' }, Prompt: 'Answer Match or NonMatch.',
  });
  // No band and no pool naming the task: the study's own participant, a person, takes it.
  const nobody = (await payloadsOf(bandsXml(CLAUDE, { bands: false }))).get('TheTask')!;
  expect(nobody.agentType).toBe('human');
});

test('a message flow between the task and an actor pool names who answers, before containment', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" id="flows_fixture" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:collaboration id="C">
    <bpmn2:participant id="Lab" name="Lab" processRef="P"><bpmn2:extensionElements><cognitive:actor actorType="human" /></bpmn2:extensionElements></bpmn2:participant>
    <bpmn2:participant id="Claude" name="Claude"><bpmn2:extensionElements><cognitive:actor actorType="llm" implementation="claude://claude-haiku-4-5" /></bpmn2:extensionElements></bpmn2:participant>
    <bpmn2:messageFlow id="M1" sourceRef="TheTask" targetRef="Claude" />
  </bpmn2:collaboration>
  <bpmn2:process id="P"><bpmn2:extensionElements><studyflow:study /></bpmn2:extensionElements>
    <bpmn2:choreographyTask id="TheTask" name="The task"><bpmn2:extensionElements><behaverse:task scene="NB" /></bpmn2:extensionElements></bpmn2:choreographyTask>
  </bpmn2:process>
</bpmn2:definitions>`;
  const task = (await payloadsOf(xml)).get('TheTask')!;
  // The task sits in a human pool, but the message flow to Claude is the more explicit statement, and wins.
  expect(task.agentType).toBe('bot');
  expect(task.bot).toEqual({ ResponseSource: 'llm', LLM: { Provider: 'claude', Model: 'claude-haiku-4-5' } });
});

/** Two partners on message flows: `flows` is the collaboration's flows (and the file's messages), the task in a human pool. */
function partnersXml(flows: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" id="partners_fixture" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:collaboration id="C">
    <bpmn2:participant id="Lab" name="Lab" processRef="P"><bpmn2:extensionElements><cognitive:actor actorType="human" /></bpmn2:extensionElements></bpmn2:participant>
    <bpmn2:participant id="Claude" name="Claude"><bpmn2:extensionElements><cognitive:actor actorType="llm" implementation="claude://claude-haiku-4-5" /></bpmn2:extensionElements></bpmn2:participant>
    <bpmn2:participant id="Agent" name="Agent"><bpmn2:extensionElements><cognitive:actor actorType="software" implementation="my-agent" /></bpmn2:extensionElements></bpmn2:participant>
    ${flows}
  </bpmn2:collaboration>
  <bpmn2:message id="Trial" itemRef="Trial_Item" />
  <bpmn2:message id="Marker" itemRef="Marker_Item" />
  <bpmn2:itemDefinition id="Trial_Item" structureRef="behaverse:Trial" />
  <bpmn2:itemDefinition id="Marker_Item" structureRef="eeg:Marker" />
  <bpmn2:process id="P"><bpmn2:extensionElements><studyflow:study /></bpmn2:extensionElements>
    <bpmn2:choreographyTask id="TheTask" name="The task"><bpmn2:extensionElements><behaverse:task scene="NB" /></bpmn2:extensionElements></bpmn2:choreographyTask>
  </bpmn2:process>
</bpmn2:definitions>`;
}

test('a message flow naming its message says who takes the task; two partners with none named is an error', async () => {
  // Unnamed flows to two partners: nothing says which one answers, and the file's order is not an answer.
  await expect(payloadsOf(partnersXml(`
    <bpmn2:messageFlow id="M1" sourceRef="TheTask" targetRef="Claude" />
    <bpmn2:messageFlow id="M2" sourceRef="TheTask" targetRef="Agent" />`))).rejects.toThrow(/Claude, Agent.*messageRef/);
  // The flow carrying the trials names the taker; a flow carrying another skill's message (a marker) is not a candidate.
  const typed = (await payloadsOf(partnersXml(`
    <bpmn2:messageFlow id="M1" sourceRef="TheTask" targetRef="Claude" messageRef="Marker" />
    <bpmn2:messageFlow id="M2" sourceRef="TheTask" targetRef="Agent" messageRef="Trial" />`))).get('TheTask')!;
  expect(typed.agentType).toBe('bot');
  expect(typed.bot).toEqual({ ResponseSource: 'external' }); // the agent over the bridge, not Claude
  // A named flow outranks an unnamed one.
  const ranked = (await payloadsOf(partnersXml(`
    <bpmn2:messageFlow id="M1" sourceRef="TheTask" targetRef="Claude" />
    <bpmn2:messageFlow id="M2" sourceRef="TheTask" targetRef="Agent" messageRef="Trial" />`))).get('TheTask')!;
  expect(ranked.bot).toEqual({ ResponseSource: 'external' });
  // Trials leave the task; a trial drawn into it is the wrong way round.
  await expect(payloadsOf(partnersXml(`
    <bpmn2:messageFlow id="M1" sourceRef="Agent" targetRef="TheTask" messageRef="Trial" />`))).rejects.toThrow(/wrong way/);
});

test('a cognitive task holds one reference, the actor who takes it, and needs none for its own side', async () => {
  const one = (await payloadsOf(bandsXml(CLAUDE, { bands: 'actor' }))).get('TheTask')!;
  expect(one.agentType).toBe('bot');
  expect(one.bot).toEqual({ Speed: 20, ResponseSource: 'llm', LLM: { Provider: 'claude', Model: 'claude-haiku-4-5' } });
});

test('a robot names where its bridge listens, and the task sends its trials there', async () => {
  const robot = (await payloadsOf(bandsXml('<reachy:robot bridge="ws://localhost:9000" />'))).get('TheTask')!;
  expect(robot.bot).toMatchObject({ ResponseSource: 'external', BridgeUrl: 'ws://localhost:9000' });
});
