import { expect, test } from '@playwright/test';

import { checkRunnerPaths } from '@core/checks/runner-paths';
import { studyModel } from '@tests/schemas';

/** The constructs the walk reads otherwise than BPMN: a complex gateway, a second start event, an event of a kind it
 * does not read; a loop that nothing ends, an event-based gateway branch with nothing to wait for, and a call
 * activity's process. */

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
    ['EventBasedGateway', ['A', 'B'].map((task) => `error Split: "Split here" is an event-based gateway, which waits for the first event of its branches, and "${task}" has none to wait for, so the run stops here; start each branch with a catch event or a receive task a message flow reaches, a timer catch event, or a conditional catch event`)],
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

test('a standard loop that nothing ends is refused, saying what would end it', () => {
  /** The split's step A, repeating under a standard loop marker of `marker`, with `boundary` on it. */
  const looped = (marker: string, boundary = ''): string => split('ExclusiveGateway').replace('    A:\n      type: Task\n',
    `    A:\n      type: Task\n      name: Practice\n      loopCharacteristics: { type: StandardLoopCharacteristics${marker} }\n${boundary}`);
  const on = (definition: string): string => `    Out:\n      type: BoundaryEvent\n      attachedToRef: A\n      eventDefinitions:\n        - type: ${definition}\n`;
  const refused = ['error A: "Practice" repeats with neither a loopCondition nor a loopMaximum, and no boundary event to end it, so it never ends; give it a loopCondition or a loopMaximum'];
  const CASES: [label: string, study: string, issues: string[]][] = [
    ['neither a condition nor a maximum', looped(''), refused],
    ['a loopMaximum', looped(', loopMaximum: 3'), []],
    ['a loopCondition', looped(', loopCondition: score < 0.9'), []],
    ['a timer at its boundary', looped('', on('TimerEventDefinition')), []],
    ['only a timer that does not interrupt it', looped('', on('TimerEventDefinition').replace('      attachedToRef: A\n', '      attachedToRef: A\n      cancelActivity: false\n')), refused],
    ['only a condition at its boundary, which is read once the loop is done', looped('', on('ConditionalEventDefinition')), refused],
  ];
  for (const [label, study, issues] of CASES) {
    const found = checkRunnerPaths(studyModel(study));
    expect(found.map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`), label).toEqual(issues);
  }
});

test('an event-based gateway branch with no event to wait for is refused, where the run would stop', () => {
  /** Start, then an event-based gateway whose branches start at Yes, a catch event pool B's message reaches, and at `no`. */
  const race = (no: string, toNo = ''): string => `id: race
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
C:
  type: Collaboration
  participants:
    PA: { name: A, processRef: Study }
    PB: { name: B, processRef: Other }
  messageFlows:
    M_Yes: { sourceRef: Send, targetRef: Yes }
${toNo}Study:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Wait: { type: EventBasedGateway, name: Which first? }
    Yes: { type: IntermediateCatchEvent, name: Yes }
${no}    End: { type: EndEvent }
    F0: Start -> Wait
    F1: Wait -> Yes
    F2: Wait -> No
    F3: Yes -> End
    F4: No -> End
Other:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Send: { type: IntermediateThrowEvent }
    S9: { type: EndEvent }
    G0: S0 -> Send
    G1: Send -> S9
`;
  const CASES: [label: string, study: string, issues: string[]][] = [
    ['a message along each branch', race('    No: { type: IntermediateCatchEvent, name: No }\n', '    M_No: { sourceRef: Send, targetRef: No }\n'), []],
    ['a timer', race('    No: { type: IntermediateCatchEvent, name: Time out, timer: PT5M }\n'), []],
    ['a condition', race('    No: { type: IntermediateCatchEvent, name: Closed, condition: closed = true }\n'), []],
    ['a catch event nothing makes happen', race('    No: { type: IntermediateCatchEvent, name: Never }\n'), [
      'error Wait: "Which first?" is an event-based gateway, which waits for the first event of its branches, and "Never" has none to wait for, so the run stops here; start each branch with a catch event or a receive task a message flow reaches, a timer catch event, or a conditional catch event',
    ]],
  ];
  for (const [label, study, issues] of CASES) {
    const found = checkRunnerPaths(studyModel(study));
    expect(found.map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`), label).toEqual(issues);
  }
});

test('a call activity calls a process of the study, and one that calls a process it is inside is refused', () => {
  /** The study calling `called`, a process that itself holds `inside`. */
  const study = (called: string, inside = ''): string => `id: calls
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Call: { type: CallActivity, name: Screen, calledElement: ${called} }
    End: { type: EndEvent }
    F0: Start -> Call
    F1: Call -> End
Screening:
  type: Process
  name: Screening protocol
  flowElements:
    S0: { type: StartEvent }
${inside || '    Check: { type: Task }\n'}    S9: { type: EndEvent }
    SF0: S0 -> Check
    SF1: Check -> S9
`;
  const CASES: [label: string, study: string, issues: string[]][] = [
    ['a process of the study', study('Screening'), []],
    ['nothing the study holds', study('Elsewhere'), [
      'warning Call: "Screen" calls "Elsewhere", which is no process of this study, so it passes as a task a runner may claim; name a process the study holds in calledElement',
    ]],
    ['a process that calls itself', study('Screening', '    Check: { type: CallActivity, name: Again, calledElement: Screening }\n'), [
      'error Check: "Again" calls "Screening protocol", which it is inside, so the process would call itself without end; draw the repeat as a loop marker instead',
    ]],
    ['a process that calls back into the caller', study('Screening', '    Check: { type: CallActivity, name: Back, calledElement: Study }\n'), [
      'error Call: "Screen" calls "Screening protocol", which calls back into "Study", so the process would call itself without end; draw the repeat as a loop marker instead',
      'error Check: "Back" calls "Study", which calls back into "Screening protocol", so the process would call itself without end; draw the repeat as a loop marker instead',
    ]],
  ];
  for (const [label, text, issues] of CASES) {
    const found = checkRunnerPaths(studyModel(text));
    expect(found.map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`), label).toEqual(issues);
  }
});

test('an error boundary event marked as not interrupting is warned about: an error always ends its activity', () => {
  const study = split('ExclusiveGateway').replace('    End:\n', `    Failed:
      type: BoundaryEvent
      attachedToRef: A
      cancelActivity: false
      eventDefinitions:
        - type: ErrorEventDefinition
    End:
`).replace('    F_End: Join -> End\n', '    F_End: Join -> End\n    F_Failed: Failed -> End\n');
  expect(checkRunnerPaths(studyModel(study)).map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`)).toEqual([
    'warning Failed: "Failed" is an error boundary event marked as not interrupting, which BPMN does not allow: an error always ends its activity, so the walk leaves the activity at it all the same',
  ]);
});
