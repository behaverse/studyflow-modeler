import { expect, test } from '@playwright/test';

import { buildCatalog, setCatalog } from '@core/notation';
import { toModdlePackages } from '@core/notation/schemaFile';
import { parseStudyflow } from '@runner/studyflow';
import { getBehaverseTaskPayload } from '@runner/nodes/behaverse/parser';
import type { FlowNode } from '@runner/flow';
import { loadSchemaModels } from './schemas';
import { exampleXml } from './utils';

/** The `RunCognitiveTask` wire contract, from the runner side. */

const models = loadSchemaModels();
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
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
  const indented = configurations.trimEnd();
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" xmlns:cognitive="http://behaverse.org/schemas/studyflow/cognitive" id="payload_fixture" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:process id="PayloadFixture" name="Payload fixture">
    <bpmn2:extensionElements>
      <studyflow:study />
    </bpmn2:extensionElements>
    <bpmn2:task id="TheTask" name="The task">
      <bpmn2:extensionElements>
        <cognitive:behaverseTask behaverseScene="NB" agentType="bot">
          <cognitive:configurations>${indented}</cognitive:configurations>
          <cognitive:botConfigurations>ResponseSource: external</cognitive:botConfigurations>
        </cognitive:behaverseTask>
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
