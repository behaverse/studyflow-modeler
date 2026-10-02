import { expect, test } from '@playwright/test';

import { checkRunnerPaths } from '@core/checks/runner-paths';
import { studyModel } from '@tests/schemas';

/** What the walk reads otherwise than BPMN: a complex gateway, a second start event, an event of a kind it does not read. */

/** Start, then `node` (of `type`) splitting to A and B, which meet again at an end. */
const split = (type: string): string => `id: paths
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Split:
      type: ${type}
      name: Split here
    A:
      type: Task
    B:
      type: Task
    Join:
      type: ${type === 'ParallelGateway' ? type : 'ExclusiveGateway'}
    End:
      type: EndEvent
    F0: Start -> Split
    F_A:
      name: first
      sourceRef: Split
      targetRef: A
    F_B: Split -> B
    F_A2: A -> Join
    F_B2: B -> Join
    F_End: Join -> End
`;

test('a split and a join are walked as BPMN says, but for a complex gateway, whose activation rule the walk does not read', () => {
  // Each issue as `<severity> <element id>: <message>`.
  const CASES: [type: string, issues: string[]][] = [
    ['ParallelGateway', []],
    ['InclusiveGateway', []],
    ['Task', []],
    ['IntermediateThrowEvent', []],
    ['ExclusiveGateway', []],
    ['EventBasedGateway', []],
    ['ComplexGateway', ['error Split: "Split here" is a complex gateway with 2 outgoing flows; the walk reads no activation rule, so it stops here rather than take it as another kind of gateway']],
  ];
  for (const [type, issues] of CASES) {
    const found = checkRunnerPaths(studyModel(split(type)));
    expect(found.map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`), type).toEqual(issues);
  }
});

test('a scope walks from its first start event, and a second is warned about', () => {
  const study = split('ExclusiveGateway').replace('    End:\n', '    Later:\n      type: StartEvent\n    End:\n').replace('    F_End: Join -> End\n', '    F_End: Join -> End\n    F_Later: Later -> A\n');
  expect(checkRunnerPaths(studyModel(study)).map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`)).toEqual([
    'warning Later: "Study" has 2 start events; the walk starts it at the first, "Start", so a path from "Later" never runs',
  ]);
});

test('an event of a kind the walk does not read is refused, where BPMN would reach beyond it', () => {
  /** Start, then an event of `type` carrying `definition`, then an end. */
  const event = (type: string, definition: string): string => `id: events
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Event:
      type: ${type}
      name: Here
      eventDefinitions:
        - type: ${definition}
    End:
      type: EndEvent
    F0: Start -> Event
    F1: Event -> End
`;
  const refused = (named: string): string[] => [`error Event: "Here" is ${named} event, which the walk does not read, so it would pass as a plain event; draw what it does with sequence and message flows`];
  const CASES: [type: string, definition: string, issues: string[]][] = [
    ['IntermediateCatchEvent', 'MessageEventDefinition', []],
    ['IntermediateCatchEvent', 'TimerEventDefinition', []],
    ['IntermediateCatchEvent', 'ConditionalEventDefinition', []],
    ['EndEvent', 'ErrorEventDefinition', []],
    ['EndEvent', 'TerminateEventDefinition', []],
    ['IntermediateThrowEvent', 'SignalEventDefinition', refused('a signal')],
    ['IntermediateThrowEvent', 'EscalationEventDefinition', refused('an escalation')],
    ['IntermediateThrowEvent', 'CompensateEventDefinition', refused('a compensation')],
    ['IntermediateThrowEvent', 'LinkEventDefinition', refused('a link')],
    ['EndEvent', 'CancelEventDefinition', refused('a cancel')],
  ];
  for (const [type, definition, issues] of CASES) {
    const found = checkRunnerPaths(studyModel(event(type, definition)));
    expect(found.map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`), definition).toEqual(issues);
  }
});
