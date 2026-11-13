import { expect, test } from '@playwright/test';

import { getRegisteredNodes, registerNode } from '@runner/nodes/registry';
import { Studyflow } from '@runner/studyflow';
import { validateUnwalked } from '@runner/unwalked';
import type { FlowNode } from '@runner/flow';
import { idOf, type Value } from '@core/model/index';
import { loadSchemaModels, schemaPackages } from '@tests/schemas';

const packages: Record<string, any> = schemaPackages(loadSchemaModels());

// A screen of its own for an instruction, the generic step every other task falls back to, and the screen a timer
// event's wait shows (a spec sharing this worker may have registered them already).
const registered = new Set(getRegisteredNodes().map((node) => node.type));
if (!registered.has('instruction')) registerNode({ type: 'instruction', match: { extensionType: 'cognitive:Instruction' }, toJob: (node: FlowNode) => ({ type: 'instruction', node, content: '' }), Component: () => null });
if (!registered.has('task')) registerNode({ type: 'task', match: { fallback: 'task' }, toJob: (node: FlowNode) => ({ type: 'task', node }), Component: () => null });
if (!registered.has('timer')) registerNode({ type: 'timer', match: { bpmnType: 'bpmn:IntermediateCatchEvent' }, toJob: (node: FlowNode) => ({ type: 'timer', node }), Component: () => null });
// A questionnaire's screen that asks a model on its band itself, and plays no other program; it reads its briefing,
// and gives its step a result.
if (!registered.has('questionnaire')) {
  registerNode({
    type: 'questionnaire',
    match: { extensionType: 'cognitive:Questionnaire' },
    toJob: (node: FlowNode) => ({ type: 'questionnaire', node }),
    Component: () => null,
    playsBand: (node: FlowNode) => (node.element.participantRef as Value[]).map(idOf).includes('Model'),
    reads: () => ['Briefing'],
    answers: true,
  });
}

/** A rest, as its type mints it: its timer is how long it lasts. */
const REST = `type: cognitive:Rest
      eventDefinitions:
        Practice_Timer: { type: TimerEventDefinition, timeDuration: PT1M }`;

/** A step's loop and its data edge out: an activity carries both, an event only the edge, a gateway neither. */
const LOOP = `
      loopCharacteristics:
        type: StandardLoopCharacteristics
        loopMaximum: 3`;
const WRITES = `
      dataOutputAssociations:
        Out_Score:
          targetRef: Score`;

const study = (model: string, sender: string) => Studyflow.parse(`id: unwalked
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Subject: { name: Subject, processRef: Study }
    Model: ${model}
  messageFlows:
    M_Ask: { sourceRef: Practice, targetRef: Model }
Study:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Practice:
      ${sender}
      name: Practice
    Score:
      type: DataObjectReference
    Timeout:
      type: BoundaryEvent
      name: Too slow
      attachedToRef: Practice
      eventDefinitions:
        Timer:
          type: TimerEventDefinition
          timeDuration: PT5M
    End:
      type: EndEvent
    F1: Start -> Practice
    F2: Practice -> End
    F3: Timeout -> End
`, structuredClone(packages));

/** A study a page cannot carry is refused before the first screen, not walked as another study. */
test('a message flow the page carries runs; one to a pool no one in the page plays, or from a screen, is refused; a screen fills no data edge, and a step no screen takes is passed over', async () => {
  const CASES: [string, string, string, string[]][] = [
    // A pool with no process and a human actor (none said is human) is the person at the page.
    // The asking task has no screen: the walk sends for it and fills its data edges.
    ['to the person at the page', '{ name: Model }', `type: Task${LOOP}${WRITES}`, []],
    ['to a model', '{ type: studyflow:Actor, name: Model, actorType: llm, implementation: "ollama://gemma4" }', `type: Task${LOOP}${WRITES}`, ['error M_Ask']],
    // A screen neither talks nor fills a data edge.
    ['from a screen', '{ name: Model }', `type: cognitive:Instruction${LOOP}${WRITES}`, ['error M_Ask', 'warning Practice']],
    // A timer event is the walk's, as in a local run: its screen only shows the wait, and the walk sends for it.
    ['from a timer event', '{ name: Model }', `${REST}${WRITES}`, []],
    // No screen takes a rest that says no time, which waits for nothing.
    ['from a step no screen takes', '{ name: Model }', `type: cognitive:Rest${WRITES}`, ['warning Practice']],
    // The walk decides every gateway, whatever its type: by a draw, or by its flows' conditions.
    ['from a gateway that draws', '{ name: Model }', 'type: cognitive:RandomGateway', []],
    ['from a gateway that weighs its conditions', '{ name: Model }', 'type: cognitive:EligibilityGateway', []],
  ];
  for (const [label, model, sender, says] of CASES) {
    const found = validateUnwalked(await study(model, sender)).map((issue) => `${issue.severity ?? 'error'} ${issue.nodeId}`).sort();
    expect(found, label).toEqual(says);
  }
  // The warning about a step no screen takes says what happens to it.
  const [passed] = validateUnwalked(await study('{ name: Model }', 'type: cognitive:Rest'));
  expect(passed.message).toBe('This runtime has no screen for a cognitive:Rest: the run passes over this step without one.');
});

/** A questionnaire whose band names `taker`, one of two programs, with no message flow drawn. */
const banded = (taker: string) => Studyflow.parse(`id: banded
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    Subject: { name: Subject, processRef: Study }
    Model: { type: studyflow:Actor, name: Model, actorType: llm, implementation: "ollama://gemma4" }
    Device: { type: studyflow:Actor, name: Device, actorType: hardware }
Study:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Survey:
      type: cognitive:Questionnaire
      name: Survey
      participantRef: [${taker}]
    End:
      type: EndEvent
    F1: Start -> Survey
    F2: Survey -> End
`, structuredClone(packages));

test('the exchange a task\'s band stands for is carried when the task\'s screen plays the pool on the band, and refused when it does not', async () => {
  const CASES: [string, string, string[]][] = [
    ['a model, which the screen asks itself', 'Model', []],
    // The plan writes a band as a flow each way, and each is refused at both of its ends.
    ['a device, which no one in the page plays', 'Device', ['error Device_to_Survey', 'error Device_to_Survey', 'error Survey_to_Device', 'error Survey_to_Device']],
  ];
  for (const [label, taker, says] of CASES) {
    const found = validateUnwalked(await banded(taker)).map((issue) => `${issue.severity ?? 'error'} ${issue.nodeId}`).sort();
    expect(found, label).toEqual(says);
  }
});

/** A step's data edges in from `sources`. */
const READS = (...sources: string[]) => `
      dataInputAssociations:
${sources.map((source) => `        In_${source}: { sourceRef: [${source}] }`).join('\n')}`;

/** A step's data edge out to the archive, which is kept at a `uri`. */
const ARCHIVES = `
      dataOutputAssociations:
        Out_Archive:
          targetRef: Archive`;

/** A questionnaire with `edges`: in from its Parameters, the briefing its screen reads or its notes, or out to a score
 * or to the archive. */
const surveying = (edges: string) => Studyflow.parse(`id: surveying
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Settings:
      type: studyflow:Parameters
      values: "items: 9"
    Briefing:
      type: DataObjectReference
    Notes:
      type: DataObjectReference
    Score:
      type: DataObjectReference
    Archive:
      type: DataStoreReference
      name: Scores
      uri: scores.jsonl
    Survey:
      type: cognitive:Questionnaire
      name: Survey${edges}
    End:
      type: EndEvent
    F1: Start -> Survey
    F2: Survey -> End
`, structuredClone(packages));

test('a screen is warned of the data edges the page leaves unfilled: not the Parameters wired into its step, a data object its screen reads itself, or the outputs of a screen that gives a result; a result written to data kept at a `uri` is warned of there, since a page saves nothing', async () => {
  const CASES: [string, string, string[]][] = [
    ['the Parameters wired into it, which the page binds before the walk', READS('Settings'), []],
    ['a data object its screen reads itself', READS('Briefing'), []],
    ['any other data object', READS('Notes'), ['warning Survey']],
    ['one such beside its Parameters', READS('Settings', 'Notes'), ['warning Survey']],
    // A screen that gives no result is warned of its data output: the instruction of the first test.
    ['a data output, which the result its screen gives is written along', WRITES, []],
    ['a data output kept at a `uri`: the result is held for the run, and saved nowhere', ARCHIVES, ['warning Archive']],
  ];
  for (const [label, edges, says] of CASES) {
    const found = validateUnwalked(await surveying(edges)).map((issue) => `${issue.severity ?? 'error'} ${issue.nodeId}`).sort();
    expect(found, label).toEqual(says);
  }
  // The warning names the data and where it is kept.
  const [kept] = validateUnwalked(await surveying(ARCHIVES));
  expect(kept.message).toBe('\'Scores\' is kept at scores.jsonl, which this runtime neither loads nor saves. The local runtime carries it (`studyflow run --runtime local`).');
});
