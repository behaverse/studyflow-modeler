import { expect, test } from '@playwright/test';

import { checkUnimplemented } from '@core/checks/unimplemented';
import { studyModel } from '@tests/schemas';

/** What the walk does not implement yet, named before a run reads it otherwise than BPMN. */

const HEAD = 'id: unread\ndefinitions:\n  targetNamespace: http://bpmn.io/schema/bpmn\n';

/** A process holding `elements` (YAML at four spaces under its `flowElements`), and `roots` beside it. */
const study = (elements: string, roots = ''): string => `${HEAD}Study:\n  type: Process\n  flowElements:\n${elements}${roots}`;

/** Start, Play, End, with `boundary` on Play (at four spaces) leading to End. */
const onPlay = (boundary: string, play = '    Play: { type: Task, name: Play }\n'): string => study(`    Start: { type: StartEvent }
${play}${boundary}    End: { type: EndEvent }
    F0: Start -> Play
    F1: Play -> End
    F2: Out -> End
`);

/** A boundary event `Out`, named `name`, on Play, with `lines` (at six spaces) after `attachedToRef`. */
const out = (name: string, lines: string): string => `    Out:\n      type: BoundaryEvent\n      name: ${name}\n      attachedToRef: Play\n${lines}`;

/** Start, `Visit` (a sub-process holding `inside`, at eight spaces, of `type`), End, and an error boundary event on it. */
const visit = (inside: string, type = 'SubProcess'): string => study(`    Start: { type: StartEvent }
    Visit:
      type: ${type}
      name: Visit
      flowElements:
${inside}    Dropped:
      type: BoundaryEvent
      name: Dropped
      attachedToRef: Visit
      eventDefinitions:
        - type: ErrorEventDefinition
    End: { type: EndEvent }
    F0: Start -> Visit
    F1: Visit -> End
    F2: Dropped -> End
`);

/** Start, then an event-based gateway whose branches start at Yes, a catch event pool B's message reaches, and at `no`. */
const race = (no: string, toNo: string): string => `${HEAD}C:
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

const PLAIN_END = '        V9: { type: EndEvent }\n';
const ERROR_END = '        V9:\n          type: EndEvent\n          eventDefinitions:\n            - type: ErrorEventDefinition\n';
const STEPS = `        V0: { type: StartEvent }\n        Test: { type: Task }\n`;
const FLOWS = '        VF0: V0 -> Test\n        VF1: Test -> V9\n';
const NEVER = 'warning Dropped: "Dropped" is never taken: the walk ends "Visit" at an error boundary event only for an error end event directly inside it, which it has none of, and a step that fails inside it fails the run; put the error boundary event on the step that may fail';
const CONDITIONAL = (kind: string): string => `is a conditional ${kind} event, whose condition the walk does not read yet: it passes at once, unless a runner claims it; put the condition on a conditional boundary event of the step that writes what it reads, or on an exclusive gateway after that step`;

test('a construct the walk does not implement yet is named, saying what a run does instead', () => {
  // Each issue as `<severity> <element id>: <message>`.
  const CASES: [label: string, study: string, issues: string[]][] = [
    ['an interrupting boundary event', onPlay(out('Too late', '      timer: PT5M\n')), []],
    ['a non-interrupting boundary event', onPlay(out('Too late', '      cancelActivity: false\n      timer: PT5M\n')), [
      'warning Out: "Too late" is a non-interrupting boundary event, which the walk does not implement yet: it ends "Play" as an interrupting one would; to keep the activity going, draw the wait as a catch event on a parallel path beside it',
    ]],
    ['an error boundary event on a task', onPlay(out('Failed', '      eventDefinitions:\n        - type: ErrorEventDefinition\n')), []],
    ['an error boundary event naming its error', onPlay(out('Failed', '      eventDefinitions:\n        - type: ErrorEventDefinition\n          errorRef: Err_Missed\n'))
      .concat('Err_Missed:\n  type: Error\n  name: missed\n'), [
      'warning Out: "Failed" names the error it catches, which the walk does not compare yet: it catches every failure of "Play"',
    ]],
    ['an error boundary event on a sub-process ending at an error end event', visit(STEPS + ERROR_END + FLOWS), []],
    ['an error boundary event on a sub-process with no error end event in it', visit(STEPS + PLAIN_END + FLOWS), [NEVER]],
    ['an error end event an outer sub-process should catch', visit(`        V0: { type: StartEvent }
        Inner:
          type: SubProcess
          name: Inner
          flowElements:
            I0: { type: StartEvent }
            Quit:
              type: EndEvent
              name: Quit
              eventDefinitions:
                - type: ErrorEventDefinition
            IF0: I0 -> Quit
        V9: { type: EndEvent }
        VF0: V0 -> Inner
        VF1: Inner -> V9
`), [
      NEVER,
      'warning Quit: "Quit" is an error end event "Inner" does not catch, and the walk does not carry an error out further yet, so "Visit" does not catch it either: it ends its path as a plain end event does; catch it on "Inner", and throw it on from there',
    ]],
    ['an error end event at the top of a process, which BPMN leaves to the engine', study(`    Start: { type: StartEvent }
    Quit:
      type: EndEvent
      eventDefinitions:
        - type: ErrorEventDefinition
    F0: Start -> Quit
`), []],
    ['a conditional boundary event', onPlay(out('Too noisy', '      condition: noisy = true\n')), []],
    ['a conditional catch event', study(`    Start: { type: StartEvent }
    Wait:
      type: IntermediateCatchEvent
      name: Ready
      condition: ready = true
    End: { type: EndEvent }
    F0: Start -> Wait
    F1: Wait -> End
`), [`warning Wait: "Ready" ${CONDITIONAL('catch')}`]],
    ['a conditional start event', study(`    Start:
      type: StartEvent
      name: Data in
      condition: ready = true
    End: { type: EndEvent }
    F0: Start -> End
`), [`warning Start: "Data in" ${CONDITIONAL('start')}`]],
    ['a multi-instance marker with a completionCondition', onPlay('', `    Play:
      type: Task
      name: Play
      loopCharacteristics:
        type: MultiInstanceLoopCharacteristics
        loopCardinality: "3"
        completionCondition: done = true
`).replace('    F2: Out -> End\n', ''), [
      'warning Play: "Play" carries a completionCondition, which the walk does not read yet: every instance runs; to stop early, use a standard loop marker whose loopCondition says when',
    ]],
    ['a call activity', study(`    Start: { type: StartEvent }
    Call: { type: CallActivity, name: Screen, calledElement: Screening }
    End: { type: EndEvent }
    F0: Start -> Call
    F1: Call -> End
`, `Screening:
  type: Process
  name: Screening protocol
  flowElements:
    S0: { type: StartEvent }
    S9: { type: EndEvent }
    SF0: S0 -> S9
`), [
      'warning Call: "Screen" is a call activity, which the walk does not implement yet: it calls nothing and passes as a task a runner may claim, and "Screening protocol" runs on its own, as a pool; draw the process as a sub-process here',
    ]],
    ['an empty sub-process', visit(''), [NEVER]],
    ['a sub-process holding a step and no start event', visit('        Test: { type: Task }\n'), [
      NEVER,
      'warning Visit: "Visit" has no start event, so the walk steps past it and nothing inside it runs; give it a start event and sequence flows',
    ]],
    ['an ad-hoc sub-process with no start event', visit('        Test: { type: Task }\n', 'AdHocSubProcess'), [
      NEVER,
      'warning Visit: "Visit" has no start event, so the walk steps past it and nothing inside it runs: it does not implement ad-hoc sub-processes yet; give it a start event and sequence flows',
    ]],
    ['an ad-hoc sub-process with a start event and a completionCondition', visit(STEPS + ERROR_END + FLOWS, 'AdHocSubProcess')
      .replace('      name: Visit\n', '      name: Visit\n      completionCondition: done = true\n'), [
      'warning Visit: "Visit" is an ad-hoc sub-process, which the walk does not implement yet: it walks it as a plain sub-process, from its start event',
      'warning Visit: "Visit" carries a completionCondition, which the walk does not read yet: it ends when its last path ends',
    ]],
    ['an event-based gateway whose branches a message reaches', race('    No: { type: IntermediateCatchEvent, name: No }\n', '    M_No: { sourceRef: Send, targetRef: No }\n'), []],
    ['an event-based gateway with a timer branch', race('    No: { type: IntermediateCatchEvent, name: Time out, timer: PT5M }\n', ''), [
      'error Wait: "Which first?" is an event-based gateway, which waits for messages only, and "Time out" takes none, so the run stops here; start each branch with a catch event or a receive task a message flow reaches, and draw a timeout as a timer boundary event on the receive task',
    ]],
  ];
  for (const [label, text, issues] of CASES) {
    const found = checkUnimplemented(studyModel(text));
    expect(found.map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`), label).toEqual(issues);
  }
});
