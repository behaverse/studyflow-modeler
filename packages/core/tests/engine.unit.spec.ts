import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { HandoffError, Walk, allocationOf, draw, dryHost, durationMs, permutedBlock, pick, planOf, stateOf, type Handback, type Host, type PlanElement, type RunEvent, type Talk, type WalkOptions } from '@core/engine';
import { studyModel } from '@tests/schemas';

/** The walk (packages/core/src/engine): what every runtime runs. Each case walks a study written inline with runners
 * scripted here, and reads what the walk leaves: the visit counts, the state tree, its log. */

type Runner = (values: Record<string, any>, talk?: Talk) => Handback | Promise<Handback>;

const HEAD = 'definitions:\n  targetNamespace: http://bpmn.io/schema/bpmn\n';

async function walked(study: string, runners: Record<string, Runner> = {}, options: WalkOptions = {}) {
  const plan = planOf(studyModel(`id: study\n${HEAD}${study}`));
  const log: string[] = [];
  const events: RunEvent[] = [];
  const start = structuredClone(options.state ?? {});
  const host: Host = {
    record: (event) => events.push(event),
    claim: (id) => (runners[id] ? { name: 'test', live: true } : undefined),
    perform: async (id, values, { talk, message, conversation }) => runners[id]({ ...values, message, conversation }, talk),
    log: (event, message) => log.push(`${event} ${message.trim()}`),
    now: () => new Date().toISOString(),
  };
  const walk = new Walk(plan, host, options);
  let error: Error | undefined;
  await walk.run().catch((caught) => { error = caught; });
  // The run's record is enough to recover the state it left, whatever the study.
  expect(stateOf(events, start)).toEqual(walk.state);
  return { walk, plan, log, error, events, reached: walk.state._meta?.reached ?? {}, state: walk.state };
}

test('a split walks each branch it takes as a path of its own, at once, and a join waits for the paths it joins', async () => {
  const process = (split: string, join: string, flows = 'F2: Split -> A\n    F3: Split -> B') => `S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Split: { type: ${split} }
    A: { type: Task }
    B: { type: Task }
    Join: { type: ${join} }
    After: { type: Task }
    End: { type: EndEvent }
    F1: Start -> Split
    ${flows}
    F4: A -> Join
    F5: B -> Join
    F6: Join -> After
    F7: After -> End
`;
  // A waits for B to have started: walked one after the other, the run would never end.
  let started: () => void = () => undefined;
  const bStarted = new Promise<void>((resolve) => { started = resolve; });
  const ran: string[] = [];
  const both = { A: async () => { await bStarted; ran.push('A'); return {}; }, B: () => { started(); ran.push('B'); return {}; }, After: () => { ran.push('After'); return {}; } };
  const parallel = await walked(process('ParallelGateway', 'ParallelGateway'), both);
  expect(parallel.error).toBeUndefined();
  expect(ran).toEqual(['B', 'A', 'After']);
  expect([parallel.reached.Join, parallel.reached.After], 'the join is reached by both tokens and passed once').toEqual([2, 1]);

  // An inclusive split takes each flow whose condition holds, and its join waits only for the paths that can come.
  const inclusive = await walked(process('InclusiveGateway', 'InclusiveGateway', "F2: { sourceRef: Split, targetRef: A, conditionExpression: 'true' }\n    F3: { sourceRef: Split, targetRef: B, conditionExpression: 'false' }"), {});
  expect(inclusive.error).toBeUndefined();
  expect([inclusive.reached.A, inclusive.reached.B, inclusive.reached.After]).toEqual([1, undefined, 1]);

  // So does an activity with several flows out and no conditions on them.
  const fanned = await walked(process('Task', 'ParallelGateway'), {});
  expect([fanned.error, fanned.reached.A, fanned.reached.B, fanned.reached.After]).toEqual([undefined, 1, 1, 1]);

  // A parallel join one of whose tokens can never come stops the run; a complex gateway is refused.
  const stuck = await walked(process('ExclusiveGateway', 'ParallelGateway', "F2: { sourceRef: Split, targetRef: A, conditionExpression: 'true' }\n    F3: Split -> B"), {});
  expect(stuck.error?.message).toMatch(/Join: a parallel join waits for a token along each of its 2 flows, and only 1 can come/);
  expect((await walked(process('ComplexGateway', 'ParallelGateway'), {})).error?.message).toMatch(/complex gateway/);
});

test('a path that fails stops the paths beside it, its hand-offs too, and a terminate end event ends them without failing', async () => {
  const study = (end: string) => `S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Split: { type: ParallelGateway }
    A: { type: Task }
    Slow: { type: Task }
    End_A: ${end}
    End_Slow: { type: EndEvent }
    F1: Start -> Split
    F2: Split -> A
    F3: Split -> Slow
    F4: A -> End_A
    F5: Slow -> End_Slow
`;
  // A's runner fails, or A goes on to a terminate end event; Slow's hand-off runs until it is told to stop.
  const run = async (end: string, a: () => Promise<Handback>) => {
    const stopped: string[] = [];
    const walk = new Walk(planOf(studyModel(`id: study\n${HEAD}${study(end)}`)), {
      claim: (id) => (id === 'Slow' || id === 'A' ? { name: 'test', live: true } : undefined),
      perform: (id, _values, { signal }) => (id === 'A' ? a() : new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { stopped.push(id); reject(new Error('stopped')); });
      })),
      log: () => undefined,
      now: () => new Date().toISOString(),
    });
    const error = await walk.run().then(() => undefined, (caught: Error) => caught.message);
    return { error, stopped, reached: walk.state._meta.reached };
  };
  const failing = await run('{ type: EndEvent }', () => Promise.reject(new Error('A broke')));
  expect([failing.error, failing.stopped]).toEqual(['A broke', ['Slow']]);
  const terminated = await run('{ type: EndEvent, eventDefinitions: { T: { type: TerminateEventDefinition } } }', () => Promise.resolve({}));
  expect([terminated.error, terminated.stopped, terminated.reached.End_A, terminated.reached.End_Slow]).toEqual([undefined, ['Slow'], 1, undefined]);
});

test('the plan spells a compact data association as the BPMN XML does: a data input its slot names, the selection alone', () => {
  const plan = planOf(studyModel(`id: study
${HEAD}S:
  type: Process
  flowElements:
    Digits: { type: DataObjectReference, name: digits }
    Model: { type: DataObjectReference, name: model }
    Start: { type: StartEvent }
    Fit:
      type: Task
      dataInputAssociations:
        A1: { sourceRef: [Digits], transformation: 'table = x[1]' }
        A2: { sourceRef: [Digits] }
        A3: { sourceRef: [Digits], transformation: table }
      dataOutputAssociations:
        A4: { targetRef: Model, transformation: result.model }
    F1: Start -> Fit
`));
  const { ioSlots, inputs, outputs } = plan.elements.Fit;
  expect(ioSlots).toEqual({ Fit_in_table: 'table', Fit_in_digits: 'digits', Fit_in_table_2: 'table' });
  expect(inputs.map(({ target, transformation }) => [target, transformation])).toEqual([['Fit_in_table', 'x[1]'], ['Fit_in_digits', null], ['Fit_in_table_2', null]]);
  expect(outputs).toEqual([{ target: 'Model', transformation: 'result.model', language: null }]);
});

test('a seeded draw is the same number in every runtime', () => {
  const rows: [number, string, number, number, number][] = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/draws.json'), 'utf8'));
  for (const [seed, gateway, participant, visit, u] of rows) expect(draw(seed, gateway, participant, visit)).toBe(u);
});

test('a random gateway allocates as it says, and what it cannot apply stops the run before the walk', () => {
  // Equal weights pick what every seed has always picked, `floor(u * n)`; a 2:1 ratio gives the first arm two thirds.
  for (const u of [0, 0.25, 0.49, 0.5, 0.74, 0.999]) {
    expect([pick(u, [1, 1]), pick(u, [1, 1, 1])]).toEqual([Math.floor(u * 2), Math.floor(u * 3)]);
  }
  expect([0, 0.66, 2 / 3, 0.99].map((u) => pick(u, [2, 1]))).toEqual([0, 0, 1, 1]);

  // Each block holds the arms in the ratio, its order is the seed's alone, and the blocks are not all alike.
  for (const seed of [1, 6, 15, 42]) {
    for (const [weights, size, arms] of [[[1, 1], 4, [0, 0, 1, 1]], [[2, 1], 6, [0, 0, 0, 0, 1, 1]]] as [number[], number, number[]][]) {
      const blocks = Array.from({ length: 8 }, (_, block) => permutedBlock(seed, 'Draw', block, weights, size));
      expect(blocks.map((block) => [...block].sort())).toEqual(blocks.map(() => arms));
      expect(blocks).toEqual(Array.from({ length: 8 }, (_, block) => permutedBlock(seed, 'Draw', block, weights, size)));
      expect(new Set(blocks.map(String)).size).toBeGreaterThan(1);
    }
  }
  expect(permutedBlock(undefined, 'Draw', 0, [1, 1], 4).sort()).toEqual([0, 0, 1, 1]); // unseeded, still balanced

  const gateway = (attributes: Record<string, string> = {}): PlanElement => ({
    id: 'Draw', type: 'exclusiveGateway', name: 'Allocation', attributes: {}, additionalArguments: null, ioSlots: {}, inputs: [], outputs: [],
    participants: [], extensions: [{ namespace: '', type: 'randomGateway', attributes }],
  });
  expect(allocationOf(gateway(), 2)).toEqual({ algorithm: 'simple', weights: [1, 1], size: 4, unapplied: undefined });
  expect(allocationOf(gateway({ algorithm: 'block', allocationRatio: '2:1', blockSize: '6' }), 2)).toMatchObject({ algorithm: 'block', weights: [2, 1], size: 6 });
  // A block the ratio cannot fill, a ratio that misses a branch.
  const REFUSED: [Record<string, string>, number][] = [
    [{ algorithm: 'block', allocationRatio: '2:1' }, 2], [{ algorithm: 'block' }, 3], [{ allocationRatio: '1:1' }, 3], [{ allocationRatio: '1:x' }, 2],
  ];
  for (const [attributes, arms] of REFUSED) expect(() => allocationOf(gateway(attributes), arms), JSON.stringify(attributes)).toThrow(/'Allocation'/);
  // What it does not apply is warned about, saying what it does instead.
  expect(allocationOf(gateway({ algorithm: 'minimization', stratifyBy: 'age_band' }), 2).unapplied).toMatch(
    /^'Allocation' specifies minimization assignment and stratification by 'age_band', which this runner does not apply: it draws one of the 2 outgoing branches/);
  expect(allocationOf(gateway({ algorithm: 'block', stratifyBy: 'age_band' }), 2).unapplied).toContain('in permuted blocks of 4');
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

// A participant draws for itself: the k-th instance of a pool of six takes the arm that a session walked as
// participant k takes (the browser's `?participant=k`), and a re-run takes the same arms again, in blocks or not.
for (const algorithm of ['simple', 'block']) {
  test(`participant k draws the same arm in its cohort, alone, and on a re-run (${algorithm})`, async () => {
    const cohort = `C:
  type: Collaboration
  extensionElements:
    - type: studyflow:Study
      seed: 3
  participants:
    Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 6
      processRef: S
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Allocate:
      type: ExclusiveGateway
      extensionElements:
        - type: cognitive:RandomGateway
          algorithm: ${algorithm}
          blockSize: 2
    A: { type: Task }
    B: { type: Task }
    S9: { type: EndEvent }
    SF0: S0 -> Allocate
    F_A: Allocate -> A
    F_B: Allocate -> B
    SF1: A -> S9
    SF2: B -> S9
`;
    const arms = (log: string[]): string[] => log.flatMap((line) => line.match(/drawn → F_([AB])/)?.[1] ?? []);
    const first = await walked(cohort);
    expect(new Set(arms(first.log))).toEqual(new Set(['A', 'B']));
    expect(arms((await walked(cohort, {}, { state: first.state })).log)).toEqual(arms(first.log));
    const alone: string[] = [];
    for (let participant = 1; participant <= 6; participant += 1) {
      alone.push(...arms((await walked(cohort, {}, { oneInstance: true, participant })).log));
    }
    expect(alone).toEqual(arms(first.log));
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
`, { Measure: () => ({ values: { Quality: { failedTrialRate: rate } } }) });
    expect(reached).toEqual(expected);
  });
}

test('a gateway a runner claims decides on what the runner samples, and its record keeps the sample as bindings', async () => {
  // A robot looks before it greets: the conditions read the face count it samples, which no step binds.
  const study = `S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Seated: { type: ExclusiveGateway, default: F_Greet }
    Ask: { type: EndEvent }
    Greet: { type: EndEvent }
    F1: Start -> Seated
    F_Ask:
      sourceRef: Seated
      targetRef: Ask
      conditionExpression: face_count = 0
    F_Greet: Seated -> Greet
`;
  for (const [faces, flow] of [[0, 'F_Ask'], [2, 'F_Greet']] as const) {
    const { walk } = await walked(study, { Seated: () => ({ result: { face_count: faces } }) });
    expect(walk.steps.entries.find((entry) => entry.node === 'Seated'), `${faces} faces`).toMatchObject({
      bindings: { face_count: faces }, taken: { sequenceFlow: flow },
    });
  }
});

// Three passes over the cohort, drawn two ways: BPMN's standard loop marker, and the multi-instance marker a cohort
// of independent subjects carries (`loopCardinality` instances, run in order).
const COHORT_MARKERS: [label: string, marker: string][] = [
  ['a standard loop marker, to its loopMaximum', 'type: StandardLoopCharacteristics\n        loopMaximum: 3'],
  ['a multi-instance marker, loopCardinality times', 'type: MultiInstanceLoopCharacteristics\n        loopCardinality: "3"'],
];
for (const [label, marker] of COHORT_MARKERS) {
  test(`a sub-process repeats under ${label}, resets its scope each pass, and its random gateway draws again each pass, the same each run`, async () => {
    const study = `S:
  type: Process
  extensionElements:
    - type: studyflow:Study
      seed: 1
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
        return { values: { P_Arm: 'cautious' }, result: 1 };
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
    // Seeded on the visit, so the arms differ from pass to pass instead of repeating the first draw.
    expect(drawn(first.log)).toEqual(['B', 'A', 'A']);

    // A participant's visits are counted in its run: the same study run again, from the state the first run left,
    // draws the same.
    const second = await walked(study, runners, { state: first.state });
    expect(drawn(second.log)).toEqual(['B', 'A', 'A']);
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
`, { Shout: (values) => ({ values: { P_Shout: String(values.state.Each.word).toUpperCase() } }) });
  expect(state.S.loud).toEqual(['A', null, 'C']);
  expect(reached).toMatchObject({ Each: 1, E0: 3, EF_Quiet: 1, Shout: 2 });
});

test('when no condition holds and there is no default, the one flow without a condition is taken, and two such flows stop the run', async () => {
  const gate = (condition: string) => `S:
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
      targetRef: No${condition}
    F_Otherwise: Gate -> Otherwise
`;
  const one = await walked(gate('\n      conditionExpression: 1 > 2'));
  expect(one.reached).toEqual({ Start: 1, F1: 1, Gate: 1, F_Otherwise: 1, Otherwise: 1 });
  const two = await walked(gate(''));
  expect(two.error?.message).toMatch(/Gate: no condition held/);
  expect(two.walk.steps.entries.at(-1)).toMatchObject({ node: 'Gate', status: 'stuck' });
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

// --- messages between pools ---

/** A runner that sends one message along `flow` and waits for what comes back. */
const asks = (flow: string, heard: unknown[]): Runner => async (_values, talk) => {
  talk!.send({ flow, id: 't1', content: { n: 1 } });
  heard.push(...await answers(talk!, 1));
  return { result: 1 };
};

/** The next `count` messages into a runner's element, waited for. */
async function answers(talk: Talk, count: number): Promise<any[]> {
  const taken: unknown[] = [];
  for (let waited = 0; taken.length < count; waited += 1) {
    expect(waited, 'an answer comes').toBeLessThan(2000);
    taken.push(...talk.take());
    if (taken.length < count) await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return taken;
}

// The robot's side of one exchange, drawn two ways: a loop that "over" ends at its boundary event, and a cycle an
// event-based gateway leaves when "over" comes before the next trial. Either way `Stop` takes "over".
const ROBOTS: [label: string, robot: string, reached: Record<string, number>][] = [
  ['a loop a message ends', `R:
  type: Process
  flowElements:
    R0: { type: StartEvent }
    Look: { type: ServiceTask }
    Ready: { type: IntermediateThrowEvent }
    Each:
      type: SubProcess
      loopCharacteristics: { type: StandardLoopCharacteristics }
      flowElements:
        E0: { type: StartEvent }
        Receive:
          type: ReceiveTask
          dataOutputAssociations: { Out_Seen: { targetRef: Seen } }
        Seen: { type: DataObjectReference }
        Ask:
          type: ServiceTask
          dataInputAssociations: { In_Seen: { sourceRef: [Seen] } }
          dataOutputAssociations: { Out_Choice: { targetRef: Choice, transformation: upper case(result) } }
        Choice: { type: DataObjectReference }
        Answer:
          type: SendTask
          dataInputAssociations: { In_Choice: { sourceRef: [Choice] } }
        E9: { type: EndEvent }
        EF1: E0 -> Receive
        EF2: Receive -> Ask
        EF3: Ask -> Answer
        EF4: Answer -> E9
    Stop: { type: BoundaryEvent, attachedToRef: Each }
    R9: { type: EndEvent }
    RF0: R0 -> Look
    RF1: Look -> Ready
    RF2: Ready -> Each
    RF3: Stop -> R9
`, { Receive: 4 }], // a fourth wait, which "over" ended
  ['a cycle an event-based gateway leaves', `R:
  type: Process
  flowElements:
    R0: { type: StartEvent }
    Look: { type: ServiceTask }
    Ready: { type: IntermediateThrowEvent }
    Next: { type: EventBasedGateway }
    Receive:
      type: ReceiveTask
      dataOutputAssociations: { Out_Seen: { targetRef: Seen } }
    Seen: { type: DataObjectReference }
    Ask:
      type: ServiceTask
      dataInputAssociations: { In_Seen: { sourceRef: [Seen] } }
      dataOutputAssociations: { Out_Choice: { targetRef: Choice, transformation: upper case(result) } }
    Choice: { type: DataObjectReference }
    Answer:
      type: SendTask
      dataInputAssociations: { In_Choice: { sourceRef: [Choice] } }
    Stop: { type: IntermediateCatchEvent }
    R9: { type: EndEvent }
    RF0: R0 -> Look
    RF1: Look -> Ready
    RF2: Ready -> Next
    RF3: Next -> Receive
    RF4: Receive -> Ask
    RF5: Ask -> Answer
    RF6: Answer -> Next
    RF7: Next -> Stop
    RF8: Stop -> R9
`, { Receive: 3, Next: 4 }], // "over" came first at the fourth visit
];

for (const [label, robot, reachedToo] of ROBOTS) {
  test(`the walk carries the messages between pools: a runner mid-run, a pool a runner plays, ${label}`, async () => {
    // The screen waits for the robot's "ready", then its task (a runner) sends three trials mid-run. The robot takes
    // each, asks the model (a pool with no process, which a runner plays), and sends the answer back; the task's end
    // sends "over", which ends the robot's trials. Look asks the same model first: each answer goes back along the
    // flow to the step that asked.
    const heard: unknown[] = [];
    const { reached, error } = await walked(`C:
  type: Collaboration
  participants:
    Screen: { name: Screen, processRef: S }
    Robot: { name: Robot, processRef: R }
    Model: { name: Model }
  messageFlows:
    M_Look: { sourceRef: Look, targetRef: Model }
    M_Seen: { sourceRef: Model, targetRef: Look }
    M_Ready: { sourceRef: Ready, targetRef: Seated }
    M_Trial: { sourceRef: Play, targetRef: Receive }
    M_Answer: { sourceRef: Answer, targetRef: Play }
    M_Ask: { sourceRef: Ask, targetRef: Model }
    M_Reply: { sourceRef: Model, targetRef: Ask }
    M_Over: { sourceRef: Over, targetRef: Stop }
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Seated: { type: IntermediateCatchEvent }
    Play: { type: Task }
    Over: { type: EndEvent }
    SF1: S0 -> Seated
    SF2: Seated -> Play
    SF3: Play -> Over
${robot}`, {
      // The task: each trial goes out, and it waits for the answer to that trial.
      Play: async (_values, talk) => {
        for (const n of [1, 2, 3]) {
          talk!.send({ flow: 'M_Trial', id: `t${n}`, content: { n } });
          const [answer] = await answers(talk!, 1);
          expect(answer.inReplyTo).toBe(`t${n}`);
          heard.push(answer.content);
        }
        return { result: 3 };
      },
      // The model: one hand-off per message sent to its pool; its result is the answer.
      Model: (values) => ({ result: `answer ${(values.message.content ?? { Seen: { n: 0 } }).Seen.n}` }),
    });
    expect(error).toBeUndefined();
    // Each answer is the send task's data input, narrowed by the edge from the model's reply, and answers its trial.
    expect(heard).toEqual([{ Choice: 'ANSWER 1' }, { Choice: 'ANSWER 2' }, { Choice: 'ANSWER 3' }]);
    // Three trials answered, and the walk went on from where "over" arrived.
    expect(reached).toMatchObject({ Look: 1, Ask: 3, Stop: 1, R9: 1, Over: 1, ...reachedToo });
  });
}

test('a pool that remembers keeps one conversation with each instance of the pool asking it', async () => {
  const study = (memory: string) => `C:
  type: Collaboration
  participants:
    Subjects: { name: Subjects, participantMultiplicity: { maximum: 2 }, processRef: S }
    Model: { type: studyflow:Actor, name: Model, actorType: llm, memory: ${memory} }
  messageFlows:
    M_First: { sourceRef: First, targetRef: Model }
    M_Then: { sourceRef: Then, targetRef: Model }
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    First: { type: SendTask }
    Then: { type: SendTask }
    S9: { type: EndEvent }
    SF1: S0 -> First
    SF2: First -> Then
    SF3: Then -> S9
`;
  const heard = async (memory: string): Promise<unknown[]> => {
    const conversations: unknown[] = [];
    await walked(study(memory), { Model: (values) => { conversations.push(values.conversation); return {}; } });
    return conversations;
  };
  expect(await heard('conversation')).toEqual([
    { id: 'Model with Subjects #1', turn: 0 }, { id: 'Model with Subjects #1', turn: 1 },
    { id: 'Model with Subjects #2', turn: 0 }, { id: 'Model with Subjects #2', turn: 1 },
  ]);
  expect(await heard('none')).toEqual([undefined, undefined, undefined, undefined]);
});

test('a pool of two participant instances runs its process twice, one instance after another', async () => {
  // BPMN's `participantMultiplicity`: N instances of the pool's process, run one after another, and the model pool
  // answers each instance in turn.
  const asked: unknown[] = [];
  const { reached } = await walked(`C:
  type: Collaboration
  participants:
    Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 2
      processRef: S
    Model: { name: Model }
  messageFlows:
    M_Ask: { sourceRef: Ask, targetRef: Model }
    M_Reply: { sourceRef: Model, targetRef: Ask }
S:
  type: Process
  properties:
    P_Seen:
      name: seen
      value: none
  flowElements:
    S0: { type: StartEvent }
    Ask:
      type: Task
      dataOutputAssociations: { Out_Seen: { targetRef: P_Seen } }
    S9: { type: EndEvent }
    SF1: S0 -> Ask
    SF2: Ask -> S9
`, {
    // The model answers with the instance it is serving, and records the pool's own scope as it finds it.
    Model: (values) => {
      const instance = values.state._meta.instance.Subjects;
      asked.push([instance, values.state.S.seen]);
      return { result: `answer ${instance}` };
    },
  });
  // Asked twice, once per instance: `_meta.instance.<pool id>` says which, and each instance re-enters the pool's
  // scope, so `seen` starts at its declared value again instead of carrying the first answer over.
  expect(asked).toEqual([[1, 'none'], [2, 'none']]);
  expect(reached).toMatchObject({ S0: 2, Ask: 2, S9: 2 });
});

// A collapsed sub-process is the only place BPMN can draw a message flow to a step inside it, and a pool's message
// flows belong to everything drawn in it: either way the step inside is what talks, out along that flow and back in.
// Each is divided into a lane too, which the walk reads through.
const TALKERS: [label: string, ends: string, process: string][] = [
  ['its sub-process\'s message flows', 'Subject', `S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Subject:
      type: SubProcess
      laneSets:
        LaneSet_Subject:
          lanes:
            Lane_Screen: { name: Screen, flowNodeRef: [Play] }
      flowElements:
        E0: { type: StartEvent }
        Play: { type: Task }
        E9: { type: EndEvent }
        EF0: E0 -> Play
        EF1: Play -> E9
    Done: { type: EndEvent }
    SF1: S0 -> Subject
    SF2: Subject -> Done
`],
  ['its pool\'s message flows', 'Screen', `S:
  type: Process
  laneSets:
    LaneSet_S:
      lanes:
        Lane_Screen: { name: Screen, flowNodeRef: [Play] }
  flowElements:
    S0: { type: StartEvent }
    Play: { type: Task }
    Done: { type: EndEvent }
    SF1: S0 -> Play
    SF2: Play -> Done
`],
];
for (const [label, ends, process] of TALKERS) {
  test(`a step with no message flow of its own talks along ${label}`, async () => {
    const heard: unknown[] = [];
    const { reached } = await walked(`C:
  type: Collaboration
  participants:
    Screen: { name: Screen, processRef: S }
    Model: { name: Model }
  messageFlows:
    M_Trial: { sourceRef: ${ends}, targetRef: Model }
    M_Answer: { sourceRef: Model, targetRef: ${ends} }
${process}`, { Play: asks('M_Trial', heard), Model: (values) => ({ result: `saw ${values.message.content.n}` }) });
    expect(heard).toMatchObject([{ flow: 'M_Answer', content: 'saw 1', inReplyTo: 't1' }]);
    expect(reached).toMatchObject({ Play: 1, Done: 1 });
  });
}

test('an unclaimed step with something to send asks along its pool\'s flows, never along the pool\'s once-only message', async () => {
  // A plain task no runner claims, a prompt wired into it, and the exchange with the model drawn once on the pool. It
  // sends its input along the pool's flow to the model and takes the answer as its result, which the gateway reads;
  // the debrief after it has nothing to send and asks nothing; and the flow from the pool to the analysis pool's
  // start is the pool's own message, sent once when the pool is done.
  const asked: string[] = [];
  const { reached, log } = await walked(`C:
  type: Collaboration
  participants:
    Cohort: { name: Cohort, processRef: S }
    Model: { name: Model }
    Analysis: { name: Analysis, processRef: A }
  messageFlows:
    M_Ask: { sourceRef: Cohort, targetRef: Model }
    M_Answer: { sourceRef: Model, targetRef: Cohort }
    M_Done: { sourceRef: Cohort, targetRef: A0 }
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Check: { type: DataObjectReference }
    Screen:
      type: Task
      dataInputAssociations:
        In_Check: { sourceRef: [Check] }
    Gate: { type: ExclusiveGateway, default: F_Out }
    Debrief: { type: Task }
    Out: { type: EndEvent }
    S9: { type: EndEvent }
    SF1: S0 -> Screen
    SF2: Screen -> Gate
    F_In:
      sourceRef: Gate
      targetRef: Debrief
      conditionExpression: Screen = "READY"
    F_Out: Gate -> Out
    SF3: Debrief -> S9
A:
  type: Process
  flowElements:
    A0: { type: StartEvent }
    A9: { type: EndEvent }
    AF1: A0 -> A9
`, { Model: (values) => { asked.push(values.message.flow); return { result: 'READY' }; } });
  // One question, along the pool's flow to the model: none from the debrief, none along the once-only message.
  expect(asked).toEqual(['M_Ask']);
  expect(reached).toMatchObject({ Screen: 1, F_In: 1, Debrief: 1, S9: 1, A0: 1, A9: 1 });
  expect(reached.Out).toBeUndefined();
  expect(log.filter((line) => /\[M_Done\.\d+\]/.test(line))).toHaveLength(1);
});

test('a pool of many instances sends its outgoing message once, after the last instance', async () => {
  // The whole pool is one sender: the flow out of the participant is the cohort's own, not each instance's, so the
  // analysis pool's message start event ("All subjects complete") starts once, when the third subject is done.
  const analysed: unknown[] = [];
  const { reached } = await walked(`C:
  type: Collaboration
  participants:
    Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 3
      processRef: S
    Analysis: { name: Analysis, processRef: A }
  messageFlows:
    M_Done: { sourceRef: Subjects, targetRef: A0 }
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Play: { type: Task }
    S9: { type: EndEvent }
    SF1: S0 -> Play
    SF2: Play -> S9
A:
  type: Process
  flowElements:
    A0: { type: StartEvent, name: All subjects complete }
    Analyze: { type: Task }
    A9: { type: EndEvent }
    AF1: A0 -> Analyze
    AF2: Analyze -> A9
`, { Analyze: (values) => { analysed.push([values.state._meta.instance.Subjects, values.state._meta.reached]); return { result: 'ok' }; } });
  // Once, and only after the cohort's third instance ran every step: the analysis pool waited on the message instead
  // of failing as a wait with nothing left to send it while the sender's instances were still running.
  expect(analysed).toEqual([[3, { S0: 3, SF1: 3, Play: 3, SF2: 3, S9: 3, A0: 1, AF1: 1, Analyze: 1 }]]);
  expect(reached).toEqual({ S0: 3, SF1: 3, Play: 3, SF2: 3, S9: 3, A0: 1, AF1: 1, Analyze: 1, AF2: 1, A9: 1 });
});

/** Two pools, each catching the other's message before it sends its own. */
const WAITING_FOR_EACH_OTHER = `C:
  type: Collaboration
  participants:
    Left: { name: Left, processRef: L }
    Right: { name: Right, processRef: R }
  messageFlows:
    M_LR: { sourceRef: L_Send, targetRef: R_Hear }
    M_RL: { sourceRef: R_Send, targetRef: L_Hear }
L:
  type: Process
  flowElements:
    L0: { type: StartEvent }
    L_Hear: { type: IntermediateCatchEvent }
    L_Send: { type: IntermediateThrowEvent }
    L9: { type: EndEvent }
    LF1: L0 -> L_Hear
    LF2: L_Hear -> L_Send
    LF3: L_Send -> L9
R:
  type: Process
  flowElements:
    R0: { type: StartEvent }
    R_Hear: { type: IntermediateCatchEvent }
    R_Send: { type: IntermediateThrowEvent }
    R9: { type: EndEvent }
    RF1: R0 -> R_Hear
    RF2: R_Hear -> R_Send
    RF3: R_Send -> R9
`;

test('pools that each wait for the other fail the run, saying what each waits at, rather than wait forever', async () => {
  const { error } = await walked(WAITING_FOR_EACH_OTHER);
  expect(error?.message).toBe('the pools wait for each other: L_Hear waits along M_RL; R_Hear waits along M_LR');
});

test('a step finds the read-only properties its sub-process takes from wired Parameters, and a write to one is refused', async () => {
  let found: unknown;
  const { error } = await walked(`P:
  type: Process
  flowElements:
    S: { type: StartEvent }
    Block:
      type: SubProcess
      dataInputAssociations:
        In_Knobs: { sourceRef: [Knobs] }
      flowElements:
        S1: { type: StartEvent }
        T: { type: Task }
        E1: { type: EndEvent }
        G1: S1 -> T
        G2: T -> E1
    Knobs:
      type: DataObjectReference
      extensionElements:
        - type: studyflow:Parameters
          values: "speed: 20"
    E: { type: EndEvent }
    F1: S -> Block
    F2: Block -> E
`, { T: (values) => { found = structuredClone(values.state.Block); return { state: { Block: { speed: 5 } } }; } });
  expect(found).toEqual({ speed: 20 });
  expect(error?.message).toMatch(/T writes speed.*Block/);
});

test('a study of one step and no flow starts at that step; two steps nothing leads to are refused, not guessed between', async () => {
  const one = await walked('S:\n  type: Process\n  flowElements:\n    Only: { type: Task }\n');
  expect([one.error, one.reached]).toEqual([undefined, { Only: 1 }]);
  const two = await walked('S:\n  type: Process\n  flowElements:\n    Only: { type: Task }\n    Second: { type: Task }\n');
  expect(two.error?.message).toMatch(/start/);
});

test('what repeats never skips or replays: a record keeps its last pass only', async () => {
  const plan = planOf(studyModel(`id: study\n${HEAD}C:
  type: Collaboration
  participants:
    Subjects: { name: Subjects, participantMultiplicity: { maximum: 2 }, processRef: S }
    Lab: { name: Lab, processRef: L }
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Step: { type: Task }
    Arm: { type: ExclusiveGateway, default: SF2 }
    S9: { type: EndEvent }
    SF0: S0 -> Step
    SF1: Step -> Arm
    SF2: Arm -> S9
L:
  type: Process
  flowElements:
    L0: { type: StartEvent }
    Once: { type: Task }
    Pick: { type: ExclusiveGateway, default: LF2 }
    Rounds:
      type: SubProcess
      loopCharacteristics: { type: StandardLoopCharacteristics, loopMaximum: 2 }
      flowElements:
        R0: { type: StartEvent }
        Inner: { type: Task }
        R9: { type: EndEvent }
        RF0: R0 -> Inner
        RF1: Inner -> R9
    L9: { type: EndEvent }
    LF0: L0 -> Once
    LF1: Once -> Pick
    LF2: Pick -> Rounds
    LF3: Rounds -> L9
`));
  // A host with records of an earlier run: what it is asked to reuse is what runs once a run.
  const asked = new Set<string>();
  const walk = new Walk(plan, {
    claim: () => undefined,
    perform: async () => ({}),
    log: () => undefined,
    now: () => '',
    reuse: {
      activity: (id, live) => { if (!live) asked.add(id); return { skipped: false }; },
      decision: (id) => { asked.add(id); return undefined; },
      ran: () => undefined,
      remade: () => undefined,
    },
  });
  await walk.run();
  expect([...asked].sort()).toEqual(['Once', 'Pick']);
  expect(walk.state._meta.reached).toMatchObject({ Step: 2, Arm: 2, Inner: 2 });
});

test('a participant\'s session walks one instance of its pool, and writes a value under the name a scope declares', async () => {
  const plan = planOf(studyModel(`id: study\n${HEAD}C:
  type: Collaboration
  participants:
    Subjects: { name: Subjects, participantMultiplicity: { maximum: 4 }, processRef: S }
S:
  type: Process
  properties:
    P_Arm: { name: arm }
  flowElements:
    S0: { type: StartEvent }
    Block:
      type: SubProcess
      properties:
        P_Failed: { name: failed }
      flowElements:
        B0: { type: StartEvent }
        Trial: { type: Task }
        B9: { type: EndEvent }
        BF0: B0 -> Trial
        BF1: Trial -> B9
    S9: { type: EndEvent }
    SF0: S0 -> Block
    SF1: Block -> S9
`));
  const seen: unknown[] = [];
  const walk: Walk = new Walk(plan, {
    claim: (id) => (id === 'Trial' ? { name: 'screen', live: true } : undefined),
    perform: async (id) => {
      // Inside the block, `failed` is its own and `arm` the study's; a name no scope declares is written nowhere.
      seen.push([walk.write('failed', 3, id), walk.write('arm', 'treatment', id), walk.write('stray', 1, id), walk.inScope(id)]);
      return {};
    },
    log: () => undefined,
    now: () => '',
  }, { oneInstance: true });
  await walk.run();
  expect(seen).toEqual([['Block', 'S', undefined, { arm: 'treatment', failed: 3 }]]);
  expect(walk.state._meta.reached.Trial).toBe(1);
  expect(walk.inScope('S9')).toEqual({ arm: 'treatment' });
});

test('a dry run walks the study and executes nothing: steps are done at once, a pool nobody plays answers, a gateway nothing can decide takes a flow', async () => {
  const plan = planOf(studyModel(`id: study\n${HEAD}C:
  type: Collaboration
  participants:
    Lab: { name: Lab, processRef: S }
    Model: { name: Model }
  messageFlows:
    M_Ask: { sourceRef: Ask, targetRef: Model }
    M_Reply: { sourceRef: Model, targetRef: Ask }
S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Fit: { type: ServiceTask, implementation: "python://m.fit" }
    Ask: { type: Task }
    Good: { type: ExclusiveGateway }
    Report: { type: EndEvent }
    Retry: { type: EndEvent }
    F1: Start -> Fit
    F2: Fit -> Ask
    F3: Ask -> Good
    F_Yes:
      sourceRef: Good
      targetRef: Report
      conditionExpression: Fit.accuracy > 0.9
    F_No:
      sourceRef: Good
      targetRef: Retry
      conditionExpression: Fit.accuracy <= 0.9
`));
  const moves: string[] = [];
  const walk = new Walk(plan, dryHost(plan, { moved: (to, along, pool) => { moves.push(`${pool}: ${along ?? 'at'} ${to}`); } }), { seed: null });
  await walk.run();
  // One token, the lab's: it starts at the start event and takes each flow in turn; the gateway's flow is the host's pick.
  expect(moves.slice(0, 4)).toEqual(['S: at Start', 'S: F1 Fit', 'S: F2 Ask', 'S: F3 Good']);
  expect(['S: F_Yes Report', 'S: F_No Retry']).toContain(moves[4]);
  expect(walk.steps.status).toBe('ok');
});

// --- timers ---

test('an ISO 8601 duration is read in milliseconds; anything else is not one', () => {
  const ROWS: [string, number | undefined][] = [
    ['PT5M', 300_000], ['PT1.5S', 1500], ['P1DT2H', 93_600_000], ['P2W', 1_209_600_000], ['P1M', 2_592_000_000],
    ['5 minutes', undefined], ['P', undefined], ['PT', undefined], ['', undefined],
  ];
  for (const [text, ms] of ROWS) expect(durationMs(text), text).toBe(ms);
});

/** A study with a rest its timer keeps, and a task with a timer at its boundary. */
const TIMED = `S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Rest:
      type: IntermediateCatchEvent
      eventDefinitions:
        Rest_Timer: { type: TimerEventDefinition, timeDuration: PT5M }
    Play: { type: Task }
    TooSlow:
      type: BoundaryEvent
      attachedToRef: Play
      eventDefinitions:
        Slow_Timer: { type: TimerEventDefinition, timeDuration: PT30S }
    Done: { type: EndEvent }
    TimedOut: { type: EndEvent }
    F1: Start -> Rest
    F2: Rest -> Play
    F3: Play -> Done
    F4: TooSlow -> TimedOut
`;

for (const [label, slow, ends] of [['runs out, the walk leaves by it and the hand-off is stopped', true, 'TimedOut'], ['does not, the step ends its own way', false, 'Done']] as const) {
  test(`a timer event waits for its time, by the host's clock; when a timer at a boundary event ${label}`, async () => {
    const plan = planOf(studyModel(`id: study\n${HEAD}${TIMED}`));
    const waited: [number, string][] = [];
    let stopped = false;
    const walk = new Walk(plan, {
      claim: (id) => (id === 'Play' ? { name: 'test', live: true } : undefined),
      // A slow step: it ends only when it is stopped.
      perform: (_id, _values, { signal }) => new Promise((resolve, reject) => {
        if (!slow) return resolve({});
        signal!.addEventListener('abort', () => { stopped = true; reject(new Error('stopped')); });
      }),
      // The rest's five minutes pass at once; the boundary's thirty seconds pass only for the slow step.
      wait: (ms, _signal, at) => {
        waited.push([ms, at]);
        return at === 'TooSlow' && !slow ? new Promise(() => undefined) : Promise.resolve();
      },
      log: () => undefined,
      now: () => '',
    });
    await walk.run();
    expect(waited).toEqual([[300_000, 'Rest'], [30_000, 'TooSlow']]);
    expect(stopped).toBe(slow);
    expect(Object.keys(walk.state._meta.reached)).toContain(ends);
    expect(walk.steps.entries.find((entry) => entry.node === 'Play')).toMatchObject(slow ? { interruptedBy: 'TooSlow' } : { status: 'ok' });
  });
}

test('a hand-off that fails after binding something keeps what it had bound, and the step still fails', async () => {
  const { walk, error } = await walked(`S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Collect:
      type: Task
      dataOutputAssociations:
        Out_Trials: { targetRef: Trials }
    Trials: { type: DataObjectReference }
    Done: { type: EndEvent }
    F1: Start -> Collect
    F2: Collect -> Done
`, { Collect: () => { throw new HandoffError('the screen closed', { values: { Trials: [1, 2] }, record: { build: '26.08' } }); } });
  expect(error?.message).toBe('the screen closed');
  expect(walk.values.get('Trials')).toEqual([1, 2]);
  expect(walk.steps.entries.find((entry) => entry.node === 'Collect')).toMatchObject({ status: 'error', build: '26.08' });
});

test('a step whose implementation no runner claims fails, naming the scheme no skill in reach declares', async () => {
  const { error, walk } = await walked(`S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Fit: { type: ServiceTask, implementation: "python://m.fit" }
    F1: Start -> Fit
`);
  expect(error?.message).toBe('no partial runner claims Fit (python://m.fit): no skill in reach declares python:// elements (or a studyflow-python on PATH)');
  expect(walk.steps.entries.find((entry) => entry.node === 'Fit')).toMatchObject({ status: 'error', implementation: 'python://m.fit' });
});

test('a rest a runner claims waits in its runner, and what it recorded goes out along its data outputs', async () => {
  const plan = planOf(studyModel(`id: study
${HEAD}S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Baseline:
      type: cognitive:Rest
      eyes: closed
      eventDefinitions:
        Baseline_Timer: { type: TimerEventDefinition, timeDuration: PT2M }
      dataOutputAssociations:
        Out_Resting: { targetRef: Resting }
    Resting: { type: DataObjectReference }
    End: { type: EndEvent }
    F1: Start -> Baseline
    F2: Baseline -> End
`));
  const made: [string, string[]][] = [];
  const walk = new Walk(plan, {
    claim: (id) => (id === 'Baseline' ? { name: 'eeg', live: true } : undefined),
    perform: async () => ({ values: { Resting: 'resting.fif' } }),
    outputs: (id, targets) => made.push([id, targets]),
    log: () => undefined,
    now: () => new Date().toISOString(),
  });
  await walk.run();
  expect([made, walk.values.get('Resting')]).toEqual([[['Baseline', ['Resting']]], 'resting.fif']);
});
