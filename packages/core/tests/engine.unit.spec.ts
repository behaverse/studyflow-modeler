import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { Walk, draw, planOf, type Host, type Talk, type WalkOptions } from '@core/engine';
import { freshModdle } from '@tests/schemas';

/** The walk (packages/core/src/engine): what every runtime runs. Each case walks a study written inline with runners
 * scripted here, and reads what the walk leaves: the visit counts, the state tree, its log. */

type Runner = (values: Record<string, any>, talk?: Talk) => Record<string, unknown> | Promise<Record<string, unknown>>;

const HEAD = 'definitions:\n  targetNamespace: http://bpmn.io/schema/bpmn\n';

async function walked(study: string, runners: Record<string, Runner> = {}, options: WalkOptions = {}) {
  const plan = planOf(studyflowToDefinitions(`id: study\n${HEAD}${study}`, freshModdle()));
  const log: string[] = [];
  const host: Host = {
    claim: (id) => (runners[id] ? { name: 'test', live: true } : undefined),
    perform: async (id, values, talk) => ({ ...values, ...(await runners[id](values, talk)) }),
    log: (event, message) => log.push(`${event} ${message.trim()}`),
    now: () => new Date().toISOString(),
  };
  const walk = new Walk(plan, host, options);
  let error: Error | undefined;
  await walk.run().catch((caught) => { error = caught; });
  return { walk, plan, log, error, reached: walk.state._meta?.reached ?? {}, state: walk.state };
}

test('a parallel split is refused instead of walked along its first branch', async () => {
  const { error } = await walked(`S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Split: { type: ParallelGateway }
    A: { type: EndEvent }
    B: { type: EndEvent }
    F1: Start -> Split
    F2: Split -> A
    F3: Split -> B
`);
  expect(error?.message).toMatch(/Split.*parallel/);
});

test('a seeded draw is the same number in every runtime', () => {
  const rows: [number, string, number, number][] = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/draws.json'), 'utf8'));
  for (const [seed, gateway, visit, u] of rows) expect(draw(seed, gateway, visit)).toBe(u);
});

test('a seeded random gateway draws again at each visit', async () => {
  const fixture = fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/random-loop.studyflow.yaml'), 'utf8');
  const plan = planOf(studyflowToDefinitions(fixture, freshModdle()));
  const taken: string[] = [];
  const walk = new Walk(plan, {
    claim: () => undefined,
    perform: async () => ({}),
    log: (event, message) => { if (event === 'sequenceFlow.taken' && message.includes('drawn')) taken.push(message.trim().slice(-1)); },
    now: () => '',
  });
  await walk.run();
  expect(taken).toEqual(['A', 'A', 'B', 'A']);
});

// The cohort is walked whole, so a gateway can allocate in permuted blocks: four subjects (a pool of four participant
// instances) through a block of four split two and two, whatever the seed, or none.
for (const study of ['\n  extensionElements:\n    - type: studyflow:Study\n      seed: 15', '']) {
  test(`a gateway allocating in blocks of four splits four subjects two and two${study ? '' : ', unseeded'}`, async () => {
    const { reached } = await walked(`C:
  type: Collaboration${study}
  participants:
    Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 4
      processRef: S
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Allocate:
      type: ExclusiveGateway
      extensionElements:
        - type: cognitive:RandomGateway
          algorithm: block
          blockSize: 4
    A: { type: Task }
    B: { type: Task }
    S9: { type: EndEvent }
    SF0: S0 -> Allocate
    F_A: Allocate -> A
    F_B: Allocate -> B
    SF1: A -> S9
    SF2: B -> S9
`);
    expect(reached).toMatchObject({ Allocate: 4, F_A: 2, A: 2, F_B: 2, B: 2 });
  });
}

test('each sequence flow taken is counted, so a node is reached as often as its flows bring it in', async () => {
  // A gateway that loops back twice, a step that leaves at its conditional boundary event the second time, and a
  // default flow never taken.
  const { reached } = await walked(`S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Gate:
      type: ExclusiveGateway
      default: F_Skip
    Try: { type: Task }
    Enough:
      type: BoundaryEvent
      attachedToRef: Try
      eventDefinitions:
        Cond_Enough:
          type: ConditionalEventDefinition
          condition: state._meta.reached.Try >= 2
    Out: { type: EndEvent }
    Skipped: { type: EndEvent }
    F1: Start -> Gate
    F_Try:
      type: SequenceFlow
      sourceRef: Gate
      targetRef: Try
      conditionExpression: state._meta.reached.Gate < 3
    F_Skip: Gate -> Skipped
    F_Back: Try -> Gate
    F_Out: Enough -> Out
`);
  expect(reached).toEqual({ Start: 1, F1: 1, Gate: 2, F_Try: 2, Try: 2, F_Back: 1, Enough: 1, F_Out: 1, Out: 1 });
});

test('a failing step takes its error boundary event, and an error end event ends its sub-process at that one', async () => {
  // Discontinuation, drawn: the trial task fails, its boundary event leads to an error end event, and the sub-process
  // around it ends at its own error boundary instead of ending normally. The run itself is not failed.
  const { reached, walk, error, log } = await walked(`S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Subject:
      type: SubProcess
      flowElements:
        S0: { type: StartEvent }
        Play: { type: ServiceTask }
        Missed:
          type: BoundaryEvent
          attachedToRef: Play
          eventDefinitions:
            Err_Missed: { type: ErrorEventDefinition }
        Discontinued:
          type: EndEvent
          eventDefinitions:
            Err_Discontinued: { type: ErrorEventDefinition }
        Played: { type: EndEvent }
        EF0: S0 -> Play
        EF1: Play -> Played
        EF2: Missed -> Discontinued
    Dropped:
      type: BoundaryEvent
      attachedToRef: Subject
      eventDefinitions:
        Err_Dropped: { type: ErrorEventDefinition }
    Analysis: { type: Task }
    Completed: { type: EndEvent }
    F1: Start -> Subject
    F2: Subject -> Completed
    F3: Dropped -> Analysis
    F4: Analysis -> Completed
`, { Play: () => { throw new Error('missed'); } });
  expect(error).toBeUndefined();
  expect(reached).toEqual({
    Start: 1, F1: 1, Subject: 1, S0: 1, EF0: 1, Play: 1, Missed: 1, EF2: 1, Discontinued: 1, Dropped: 1, F3: 1, Analysis: 1, F4: 1, Completed: 1,
  });
  // The failure is kept where it happened, and the run is not failed by it.
  expect(log.join('\n')).toMatch(/activity.failed Play: Error: missed/);
  expect(walk.steps.status).toBe('ok');
  expect(walk.steps.entries.find((entry) => entry.node === 'Play')).toMatchObject({ status: 'error', interruptedBy: 'Missed' });
});

// The other way off a finished step: a conditional boundary event, whose `condition` the walk reads once the step's
// result is in. Quality control the study states itself.
const RATES: [label: string, rate: number, reached: Record<string, number>][] = [
  ['above it, the boundary takes the walk on', 0.4, { Start: 1, F1: 1, Measure: 1, Noisy: 1, F3: 1, Excluded: 1 }],
  ['below it, the step\'s own flow carries on', 0.1, { Start: 1, F1: 1, Measure: 1, F2: 1, Completed: 1 }],
];
for (const [label, rate, expected] of RATES) {
  test(`a conditional boundary event reads the finished step's result: ${label}`, async () => {
    const { reached } = await walked(`S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Measure:
      type: ServiceTask
      dataOutputAssociations:
        Out_Quality: { targetRef: Quality }
    Quality: { type: DataObjectReference }
    Noisy:
      type: BoundaryEvent
      attachedToRef: Measure
      eventDefinitions:
        Cond_Noisy:
          type: ConditionalEventDefinition
          condition: "{Quality.failedTrialRate} > 0.2"
    Excluded: { type: EndEvent }
    Completed: { type: EndEvent }
    F1: Start -> Measure
    F2: Measure -> Completed
    F3: Noisy -> Excluded
`, { Measure: () => ({ Quality: { failedTrialRate: rate } }) });
    expect(reached).toEqual(expected);
  });
}

// Three passes over the cohort, drawn two ways: BPMN's standard loop marker, and the multi-instance marker a cohort
// of independent subjects carries (`loopCardinality` instances, run in order).
const COHORT_MARKERS: [label: string, marker: string][] = [
  ['a standard loop marker, to its loopMaximum', 'type: StandardLoopCharacteristics\n        loopMaximum: 3'],
  ['a multi-instance marker, loopCardinality times', 'type: MultiInstanceLoopCharacteristics\n        loopCardinality: "3"'],
];
for (const [label, marker] of COHORT_MARKERS) {
  test(`a sub-process repeats under ${label}, resets its scope each pass, and its random gateway draws again each pass and each run`, async () => {
    const study = `S:
  type: Process
  extensionElements:
    - type: studyflow:Study
      seed: 15
  flowElements:
    Start: { type: StartEvent }
    Subject:
      type: SubProcess
      loopCharacteristics:
        ${marker}
      properties:
        P_Arm:
          name: arm
          value: none
      flowElements:
        S0: { type: StartEvent }
        Draw:
          type: ExclusiveGateway
          extensionElements:
            - type: cognitive:RandomGateway
        A: { type: Task }
        B: { type: Task }
        Check: { type: Task }
        E9: { type: EndEvent }
        EF_A: Draw -> A
        EF_B: Draw -> B
        EF0: S0 -> Draw
        EF1: A -> Check
        EF2: B -> Check
        EF3: Check -> E9
    Done: { type: EndEvent }
    F1: Start -> Subject
    F2: Subject -> Done
`;
    const seen: unknown[] = [];
    // One runner for Check: it records the property its scope holds on entry, then binds the property by its id, the
    // way a runner hands a data edge's value back.
    const runners = {
      Check: (values: Record<string, any>) => {
        seen.push([values.state.Subject.arm, values.state._meta.instance.Subject]);
        return { P_Arm: 'cautious', result: 1 };
      },
    };
    const drawn = (log: string[]) => log.flatMap((line) => line.match(/drawn → EF_([AB])/)?.[1] ?? []);

    const first = await walked(study, runners);
    // Three passes over the sub-process, three visits to every step inside it; the sub-process itself was reached once.
    expect(first.reached).toMatchObject({ Subject: 1, S0: 3, Draw: 3, Check: 3, E9: 3 });
    // A data edge into a declared property writes its scope's state, whoever bound it.
    expect(first.state.Subject).toEqual({ arm: 'cautious' });
    // A pass re-enters the scope, so a property with a `value` starts each pass at it, whatever the pass before wrote;
    // and `_meta.instance` says which pass it is.
    expect(seen).toEqual([['none', 1], ['none', 2], ['none', 3]]);
    // Seeded on the visit count, so the arms differ from pass to pass instead of repeating the first draw.
    expect(drawn(first.log)).toEqual(['A', 'B', 'A']);

    // The visit count is study-lifetime: the same study run again, from the state the first run left, draws on.
    const second = await walked(study, runners, { state: first.state });
    expect(drawn(second.log)).toEqual(['B', 'A', 'B']);
    expect(second.reached).toMatchObject({ Draw: 6, Check: 6 });
  });
}

test('a multi-instance marker over a list runs once per item, binds each in its scope, and collects the outputs', async () => {
  // BPMN's `loopDataInputRef`/`inputDataItem` and `loopDataOutputRef`/`outputDataItem`: the list decides the passes,
  // not `loopCardinality`. A condition reads the item as `word`, and the pass that writes no `shout` leaves a gap in
  // the list rather than the pass before's value.
  const { state, reached } = await walked(`S:
  type: Process
  properties:
    P_Words:
      name: words
      value: '["a", "b", "c"]'
    P_Loud:
      name: loud
  flowElements:
    Start: { type: StartEvent }
    Each:
      type: SubProcess
      loopCharacteristics:
        type: MultiInstanceLoopCharacteristics
        loopCardinality: "5"
        loopDataInputRef: P_Words
        loopDataOutputRef: P_Loud
        inputDataItem:
          id: Each_Word
          name: word
        outputDataItem:
          id: Each_Shout
          name: shout
      properties:
        P_Shout:
          name: shout
      flowElements:
        E0: { type: StartEvent }
        Quiet:
          type: ExclusiveGateway
          default: EF_Shout
        Shout:
          type: ServiceTask
          dataOutputAssociations:
            Out_Shout: { targetRef: P_Shout }
        E9: { type: EndEvent }
        EF0: E0 -> Quiet
        EF_Quiet:
          type: SequenceFlow
          sourceRef: Quiet
          targetRef: E9
          conditionExpression: word = "b"
        EF_Shout: Quiet -> Shout
        EF1: Shout -> E9
    Done: { type: EndEvent }
    F1: Start -> Each
    F2: Each -> Done
`, { Shout: (values) => ({ P_Shout: String(values.state.Each.word).toUpperCase() }) });
  expect(state.S.loud).toEqual(['A', null, 'C']);
  expect(reached).toMatchObject({ Each: 1, E0: 3, EF_Quiet: 1, Shout: 2 });
});

test('when no condition holds and there is no default, the one flow without a condition is taken', async () => {
  const { reached } = await walked(`S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Gate: { type: ExclusiveGateway }
    No: { type: EndEvent }
    Otherwise: { type: EndEvent }
    F1: Start -> Gate
    F_No:
      type: SequenceFlow
      sourceRef: Gate
      targetRef: No
      conditionExpression: 1 > 2
    F_Otherwise: Gate -> Otherwise
`);
  expect(reached).toEqual({ Start: 1, F1: 1, Gate: 1, F_Otherwise: 1, Otherwise: 1 });
});

test('a sub-process without a start event is stepped past', async () => {
  const { reached, log } = await walked(`S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Visit:
      type: SubProcess
      flowElements:
        Inside: { type: Task }
    Done: { type: EndEvent }
    F1: Start -> Visit
    F2: Visit -> Done
`);
  expect(reached).toEqual({ Start: 1, F1: 1, Visit: 1, F2: 1, Done: 1 });
  expect(log.join('\n')).toContain('Visit has no start event');
});
