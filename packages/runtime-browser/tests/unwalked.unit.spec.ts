import { expect, test } from '@playwright/test';

import { getRegisteredNodes, registerNode } from '@runner/nodes/registry';
import { Studyflow } from '@runner/studyflow';
import { validateUnwalked } from '@runner/unwalked';
import type { FlowNode } from '@runner/flow';
import { loadSchemaModels, schemaPackages } from '@tests/schemas';

const packages: Record<string, any> = schemaPackages(loadSchemaModels());

// A screen of its own for an instruction, the generic step every other task falls back to, and the screen a timer
// event's wait shows (a spec sharing this worker may have registered them already).
const registered = new Set(getRegisteredNodes().map((node) => node.type));
if (!registered.has('instruction')) registerNode({ type: 'instruction', match: { extensionType: 'cognitive:Instruction' }, toJob: (node: FlowNode) => ({ type: 'instruction', node, content: '' }), Component: () => null });
if (!registered.has('task')) registerNode({ type: 'task', match: { fallback: 'task' }, toJob: (node: FlowNode) => ({ type: 'task', node }), Component: () => null });
if (!registered.has('timer')) registerNode({ type: 'timer', match: { bpmnType: 'bpmn:IntermediateCatchEvent' }, toJob: (node: FlowNode) => ({ type: 'timer', node }), Component: () => null });

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

/** What a page cannot carry is refused before the first screen, not walked as another study. */
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
  // What a step no screen takes is warned about says what happens to it.
  const [passed] = validateUnwalked(await study('{ name: Model }', 'type: cognitive:Rest'));
  expect(passed.message).toBe('This runtime has no screen for a cognitive:Rest: the run passes over this step without one.');
});
