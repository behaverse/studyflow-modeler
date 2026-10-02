import { expect, test } from '@playwright/test';

import { explore, planOf } from '@core/engine';
import { studyModel } from '@tests/schemas';

/** Soundness by exploring every way a study can go: each decision a free choice, every run walked dry. */

const plan = (study: string) => planOf(studyModel(`id: s\ndefinitions:\n  targetNamespace: http://bpmn.io/schema/bpmn\n${study}`));

/** Left decides whether to tell Right; Right always waits to be told, and once told, Left also says goodbye at a
 * boundary event Right has left by then. */
const TOLD = `C:
  type: Collaboration
  participants:
    Left: { name: Left, processRef: L }
    Right: { name: Right, processRef: R }
  messageFlows:
    M_Tell: { sourceRef: L_Tell, targetRef: R_Hear }
    M_Bye: { sourceRef: L_Bye, targetRef: R_Bye }
L:
  type: Process
  flowElements:
    L0: { type: StartEvent }
    Gate:
      type: ExclusiveGateway
      default: L_Skip
    L_Tell: { type: IntermediateThrowEvent }
    L_Bye: { type: IntermediateThrowEvent }
    L9: { type: EndEvent }
    L_Skip: Gate -> L9
    LF1: L0 -> Gate
    L_Told:
      sourceRef: Gate
      targetRef: L_Tell
      conditionExpression: ready
    LF3: L_Tell -> L_Bye
    LF4: L_Bye -> L9
R:
  type: Process
  flowElements:
    R0: { type: StartEvent }
    R_Hear: { type: ReceiveTask }
    R_Bye: { type: BoundaryEvent, attachedToRef: R_Hear, eventDefinitions: { R_ByeMessage: { type: MessageEventDefinition } } }
    R9: { type: EndEvent }
    RF1: R0 -> R_Hear
    RF2: R_Hear -> R9
    RF3: R_Bye -> R9
`;

test('every way a study can go is walked, and a wait no message will end, or a message nothing takes, is found with its path', async () => {
  const found = await explore(plan(TOLD));
  expect(found.complete).toBe(true);
  expect(found.runs).toBe(2);
  // The gateway's condition reads what no step binds: each of its flows is a way the study can go.
  expect(found.findings).toEqual([
    { message: 'R_Hear waits along M_Tell, and nothing is left to send', path: ['Gate → L_Skip'] },
    { message: 'a message along M_Bye is sent and nothing takes it', path: ['Gate → L_Told'] },
  ]);
});

/** A process of these flow elements. */
const inProcess = (elements: string): string => `S:\n  type: Process\n  flowElements:\n${elements}`;

// What the walk would decide by data, besides an exclusive gateway's flow, and the runs its choices make.
const CHOICES: [label: string, study: string, runs: number][] = [
  ['each set of flows an inclusive split may take', inProcess(`    Start: { type: StartEvent }
    Split: { type: InclusiveGateway }
    A: { type: Task }
    B: { type: Task }
    Join: { type: InclusiveGateway }
    End: { type: EndEvent }
    F0: Start -> Split
    F_A: { sourceRef: Split, targetRef: A, conditionExpression: a }
    F_B: { sourceRef: Split, targetRef: B, conditionExpression: b }
    F1: A -> Join
    F2: B -> Join
    F3: Join -> End
`), 3],
  ['each set of conditioned flows out of a step, or none, for its default', inProcess(`    Start: { type: StartEvent }
    Step: { type: Task, default: F_Else }
    A: { type: EndEvent }
    B: { type: EndEvent }
    Else: { type: EndEvent }
    F0: Start -> Step
    F_A: { sourceRef: Step, targetRef: A, conditionExpression: a }
    F_B: { sourceRef: Step, targetRef: B, conditionExpression: b }
    F_Else: Step -> Else
`), 4],
  ['another pass of a repeating step, or none', inProcess(`    Start: { type: StartEvent }
    Practice:
      type: Task
      loopCharacteristics: { type: StandardLoopCharacteristics, loopCondition: more }
    End: { type: EndEvent }
    F0: Start -> Practice
    F1: Practice -> End
`), 2],
  ['each conditional boundary event a finished step may leave by, or none', inProcess(`    Start: { type: StartEvent }
    Measure: { type: Task }
    Noisy: { type: BoundaryEvent, attachedToRef: Measure, eventDefinitions: { C_Noisy: { type: ConditionalEventDefinition, condition: noisy } } }
    Slow: { type: BoundaryEvent, attachedToRef: Measure, eventDefinitions: { C_Slow: { type: ConditionalEventDefinition, condition: slow } } }
    End: { type: EndEvent }
    Excluded: { type: EndEvent }
    F0: Start -> Measure
    F1: Measure -> End
    F2: Noisy -> Excluded
    F3: Slow -> Excluded
`), 3],
];

test('each way a run may go is a run of its own, whatever the data would decide', async () => {
  for (const [label, study, runs] of CHOICES) {
    expect(await explore(plan(study)), label).toEqual({ runs, complete: true, findings: [] });
  }
});
