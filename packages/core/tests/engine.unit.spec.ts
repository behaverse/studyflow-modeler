import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { HandoffError, MINIMIZATION_PROBABILITY, Walk, allocationOf, alternated, draw, dryHost, durationMs, explore, minimized, permutedBlock, pick, planOf, stateOf, type Handback, type Host, type PlanElement, type RunEvent, type Talk, type WalkOptions } from '@core/engine';
import { studyModel, xmlOf } from '@tests/schemas';
import { exampleText } from '@tests/utils';

/** The walk (packages/core/src/engine): what every runtime runs. Each case walks a study written inline with runners
 * scripted here, and reads what the walk leaves: the visit counts, the state tree, its log. */

type Runner = (values: Record<string, any>, talk?: Talk) => Handback | Promise<Handback>;

const HEAD = 'definitions:\n  targetNamespace: http://bpmn.io/schema/bpmn\n';

async function walked(study: string, runners: Record<string, Runner> = {}, options: WalkOptions = {}, hosted: Partial<Host> = {}) {
  const plan = planOf(studyModel(`id: study\n${HEAD}${study}`));
  const log: string[] = [];
  const events: RunEvent[] = [];
  const start = structuredClone(options.state ?? {});
  const host: Host = {
    record: (event) => events.push(event),
    claim: (id) => (runners[id] ? { name: 'test', live: true } : undefined),
    perform: async (id, values, { talk, message, conversation, asker }) => runners[id]({ ...values, message, conversation, asker }, talk),
    log: (event, message) => log.push(`${event} ${message.trim()}`),
    now: () => new Date().toISOString(),
    ...hosted,
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
  // A flow without a condition is taken whatever else holds, the default flow only when no condition holds (BPMN 2.0).
  const split = async (holds: string, fallback: boolean) => (await walked(process(`InclusiveGateway${fallback ? ', default: F3' : ''}`, 'InclusiveGateway', `F2: { sourceRef: Split, targetRef: A, conditionExpression: '${holds}' }\n    F3: Split -> B`), {})).reached;
  expect([await split('true', false), await split('false', false), await split('true', true), await split('false', true)].map((reached) => [reached.A, reached.B, reached.After]))
    .toEqual([[1, 1, 1], [undefined, 1, 1], [1, undefined, 1], [undefined, 1, 1]]);

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

test('a name several elements share is warned about only where a placeholder cites it', async () => {
  const study = (label: string) => `S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Ask: { type: Task, name: "${label}" }
    Yes_A: { type: EndEvent, name: Supported }
    Yes_B: { type: EndEvent, name: Supported }
    G: { type: ExclusiveGateway, default: F3 }
    F1: Start -> Ask
    F2: Ask -> G
    F3: { name: "yes", sourceRef: G, targetRef: Yes_A }
    F4: { name: "yes", sourceRef: G, targetRef: Yes_B, conditionExpression: "false" }
`;
  const quiet = await walked(study('Ask'));
  expect(quiet.log.filter((line) => line.startsWith('name.ambiguous'))).toEqual([]);
  const cites = await walked(study('Ask {Supported.reached}'));
  expect(cites.log.filter((line) => line.startsWith('name.ambiguous'))).toEqual([
    'name.ambiguous Supported names more than one element, or is also an id: `{Supported.…}` cites nothing until it is unique',
  ]);
});

test('the plan spells a compact data association as the BPMN XML does: a data input its slot names, the selection alone', async () => {
  // A slot defaults to its source's name, and an unnamed data store reference's to its store's.
  const text = `id: study
${HEAD}Estimator: { type: DataStore, name: estimator }
S:
  type: Process
  flowElements:
    Digits: { type: DataObjectReference, name: digits }
    Model: { type: DataObjectReference, name: model }
    Estimator_Ref: { type: DataStoreReference, dataStoreRef: Estimator }
    Start: { type: StartEvent }
    Fit:
      type: Task
      dataInputAssociations:
        A1: { sourceRef: [Digits], transformation: 'table = x[1]' }
        A2: { sourceRef: [Digits] }
        A3: { sourceRef: [Digits], transformation: table }
        A5: { sourceRef: [Estimator_Ref] }
      dataOutputAssociations:
        A4: { targetRef: Model, transformation: result.model }
    F1: Start -> Fit
`;
  const plan = planOf(studyModel(text));
  const { ioSlots, inputs, outputs } = plan.elements.Fit;
  expect(ioSlots).toEqual({ Fit_in_table: 'table', Fit_in_digits: 'digits', Fit_in_table_2: 'table', Fit_in_estimator: 'estimator' });
  expect(inputs.map(({ target, transformation }) => [target, transformation])).toEqual([['Fit_in_table', 'x[1]'], ['Fit_in_digits', null], ['Fit_in_table_2', null], ['Fit_in_estimator', null]]);
  expect(await xmlOf(text)).toContain('<bpmn:dataInput id="Fit_in_estimator" name="estimator" />');
  expect(outputs).toEqual([{ target: 'Model', transformation: 'result.model', language: null }]);
});

test('a seeded draw, and a permuted block, is the same in every runtime', () => {
  const fixture: {
    draw: [number, string, number, number, number][];
    permutedBlock: [number, string, number, number[], number, number[]][];
  } = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/draws.json'), 'utf8'));
  for (const [seed, gateway, participant, visit, u] of fixture.draw) expect(draw(seed, gateway, participant, visit)).toBe(u);
  // A block's sequence is the gateway and the visit (`@`), or the participant inside a loop (`#`), then any stratum.
  for (const [seed, sequence, block, weights, size, arms] of fixture.permutedBlock) {
    expect(permutedBlock(seed, sequence, block, weights, size), `${sequence} block ${block}`).toEqual(arms);
  }
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

  // Alternation deals the arms in turn, each for its share of the ratio.
  expect([1, 2, 3, 4, 5, 6].map((n) => [alternated(n, [1, 1]), alternated(n, [2, 1])])).toEqual([[0, 0], [1, 0], [0, 1], [1, 0], [0, 0], [1, 1]]);

  // Minimization: the counts at this participant's level of each factor, the draw, and the arm taken. The arm of least
  // imbalance is taken four times in five; the others share the fifth.
  const MINIMIZED: [counts: number[][], u: number, arm: number][] = [
    [[[0, 0]], 0.3, 0], [[[0, 0]], 0.7, 1], // nobody before: every arm ties, and the draw picks among them all
    [[[2, 1]], 0.79, 1], [[[2, 1]], 0.8, 0], // B evens the factor; A only from MINIMIZATION_PROBABILITY up
    [[[1, 0, 0]], 0.2, 1], [[[1, 0, 0]], 0.6, 2], [[[1, 0, 0]], 0.9, 0], // B and C tie for least
    [[[1, 0, 2], [0, 1, 1]], 0.1, 0], [[[1, 0, 2], [0, 1, 1]], 0.85, 1], [[[1, 0, 2], [0, 1, 1]], 0.95, 2], // ranges 2, 3, 5 over two factors
  ];
  expect(MINIMIZATION_PROBABILITY).toBe(0.8);
  for (const [counts, u, arm] of MINIMIZED) expect(minimized(counts, u), `${JSON.stringify(counts)} at ${u}`).toBe(arm);

  const gateway = (attributes: Record<string, string> = {}): PlanElement => ({
    id: 'Draw', type: 'exclusiveGateway', name: 'Allocation', attributes: {}, additionalArguments: null, ioSlots: {}, inputs: [], outputs: [],
    participants: [], extensions: [{ namespace: '', type: 'randomGateway', attributes }],
  });
  expect(allocationOf(gateway(), 2)).toEqual({ algorithm: 'simple', weights: [1, 1], size: 4, factors: [] });
  expect(allocationOf(gateway({ algorithm: 'block', allocationRatio: '2:1', blockSize: '6' }), 2)).toMatchObject({ algorithm: 'block', weights: [2, 1], size: 6 });
  expect(allocationOf(gateway({ algorithm: 'minimization', stratifyBy: 'age_band, sex' }), 2)).toMatchObject({ algorithm: 'minimization', factors: ['age_band', 'sex'] });
  // An allocation the walk cannot apply as written stops it before it starts.
  const REFUSED: [Record<string, string>, number, RegExp][] = [
    [{ algorithm: 'block', allocationRatio: '2:1' }, 2, /blocks of 4/], [{ algorithm: 'block' }, 3, /blocks of 4/],
    [{ allocationRatio: '1:1' }, 3, /allocationRatio '1:1'/], [{ allocationRatio: '1:x' }, 2, /allocationRatio '1:x'/],
    [{ algorithm: 'blocks' }, 2, /algorithm 'blocks', which the walk does not know/],
    [{ stratifyBy: 'age_band' }, 2, /stratifies by age_band under simple randomization/],
    [{ algorithm: 'minimization' }, 2, /names none/],
    [{ algorithm: 'minimization', stratifyBy: 'sex', allocationRatio: '2:1' }, 2, /minimization balances equal arms/],
  ];
  for (const [attributes, arms, message] of REFUSED) {
    expect(() => allocationOf(gateway(attributes), arms), JSON.stringify(attributes)).toThrow(new RegExp(`^'Allocation' .*${message.source}`));
  }
});

// The cohort is walked whole, so a gateway can allocate in permuted blocks. Counterbalancing is such an allocation: the
// shipped example's arms are its two task orders, dealt in blocks of two, so its four participants take each order
// twice, whatever the seed, or none.
for (const seed of [undefined, null]) {
  test(`the counterbalanced example gives each task order to two of its four participants${seed === null ? ', unseeded' : ''}`, async () => {
    const plan = planOf(studyModel(exampleText('counterbalanced_order')));
    const walk = new Walk(plan, dryHost(plan), { seed });
    await walk.run();
    expect(walk.state._meta.reached).toMatchObject({ Allocate_Order: 4, Stroop_First: 2, Flanker_First: 2, End: 4 });
  });
}

// A participant draws for itself: the k-th instance of a pool of six takes the arm that a session walked as
// participant k takes (the browser's `?participant=k`), and a re-run takes the same arms again, drawn alone, in
// blocks, or in turn.
for (const algorithm of ['simple', 'block', 'alternation']) {
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
    if (algorithm === 'alternation') expect(arms(first.log)).toEqual(['A', 'B', 'A', 'B', 'A', 'B']);
  });
}

// Blocks and alternation deal by arrival at the gateway: a participant excluded before it takes no place, so those
// allocated still fill whole blocks, each in the ratio. Eleven subjects, of whom the 2nd, 5th and 7th are excluded at
// screening: the eight allocated take two complete blocks of four, in the order they arrive.
for (const algorithm of ['block', 'alternation']) {
  test(`a participant excluded before the gateway takes no place in its sequence (${algorithm})`, async () => {
    const excluded = [2, 5, 7];
    const cohort = `C:
  type: Collaboration
  extensionElements:
    - type: studyflow:Study
      seed: 3
  participants:
    Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 11
      processRef: S
S:
  type: Process
  properties:
    P_Eligible: { name: eligible }
  flowElements:
    S0: { type: StartEvent }
    Screen: { type: Task }
    Eligible: { type: ExclusiveGateway, default: F_Out }
    Out: { type: EndEvent }
    Allocate:
      type: ExclusiveGateway
      extensionElements:
        - type: cognitive:RandomGateway
          algorithm: ${algorithm}
          blockSize: 4
    A: { type: Task }
    B: { type: Task }
    S9: { type: EndEvent }
    SF0: S0 -> Screen
    SF1: Screen -> Eligible
    F_In: { sourceRef: Eligible, targetRef: Allocate, conditionExpression: eligible }
    F_Out: Eligible -> Out
    F_A: Allocate -> A
    F_B: Allocate -> B
    SF2: A -> S9
    SF3: B -> S9
`;
    const screen = (values: Record<string, any>): Handback => ({ values: { P_Eligible: !excluded.includes(values.state._meta.instance.Subjects) } });
    const arms = (log: string[]): string[] => log.flatMap((line) => line.match(/drawn → F_([AB])/)?.[1] ?? []);
    const { log, reached } = await walked(cohort, { Screen: screen });
    expect(reached).toMatchObject({ Out: 3, Allocate: 8 });
    const expected = algorithm === 'block'
      ? [0, 1].flatMap((block) => permutedBlock(3, 'Allocate@1', block, [1, 1], 4))
      : Array.from({ length: 8 }, (_, k) => alternated(k + 1, [1, 1]));
    expect(arms(log)).toEqual(expected.map((arm) => 'AB'[arm]));
    for (const block of [arms(log).slice(0, 4), arms(log).slice(4)]) expect(block.sort()).toEqual(['A', 'A', 'B', 'B']);
  });
}

// Strata and minimization deal by the participants before: eight subjects, screened into a band and a sex, reach the
// gateway in turn. Within strata, the k-th subject of a stratum takes place k of the stratum's own sequence
// (`Allocate@1/band=young,sex=f`); minimization takes the counts of the subjects before at each of its levels, and its
// own draw.
const BANDS = ['young', 'old', 'young', 'young', 'old', 'old', 'young', 'old'];
const SEXES = ['f', 'f', 'm', 'f', 'm', 'f', 'm', 'm'];
for (const [algorithm, refusal] of [['block', /deals its arms within each stratum of 'band', 'sex'/], ['alternation', /deals its arms within/], ['minimization', /minimizes imbalance on 'band', 'sex'/]] as const) {
  test(`a gateway allocates by the subjects before it, in the cohort and on a re-run, and a session of one refuses it (${algorithm})`, async () => {
    const cohort = `C:
  type: Collaboration
  extensionElements:
    - type: studyflow:Study
      seed: 3
  participants:
    Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 8
      processRef: S
S:
  type: Process
  properties:
    P_Band: { name: band }
    P_Sex: { name: sex }
  flowElements:
    S0: { type: StartEvent }
    Screen: { type: Task }
    Allocate:
      type: ExclusiveGateway
      extensionElements:
        - type: cognitive:RandomGateway
          algorithm: ${algorithm}
          blockSize: 2
          stratifyBy: band, sex
    A: { type: Task }
    B: { type: Task }
    S9: { type: EndEvent }
    SF0: S0 -> Screen
    SF1: Screen -> Allocate
    F_A: Allocate -> A
    F_B: Allocate -> B
    SF2: A -> S9
    SF3: B -> S9
`;
    const screen = (values: Record<string, any>): Handback => {
      const k = values.state._meta.instance.Subjects;
      return { values: { P_Band: BANDS[k - 1], P_Sex: SEXES[k - 1] } };
    };
    const expected: number[] = [];
    for (let k = 1; k <= 8; k += 1) {
      const same = (j: number): boolean => BANDS[j] === BANDS[k - 1] && SEXES[j] === SEXES[k - 1];
      const n = expected.filter((_arm, j) => same(j)).length + 1;
      const sequence = `Allocate@1/band=${BANDS[k - 1]},sex=${SEXES[k - 1]}`;
      const counts = [BANDS, SEXES].map((levels) => [0, 1].map((arm) => expected.filter((taken, j) => levels[j] === levels[k - 1] && taken === arm).length));
      expected.push(algorithm === 'block' ? permutedBlock(3, sequence, Math.floor((n - 1) / 2), [1, 1], 2)[(n - 1) % 2]
        : algorithm === 'alternation' ? alternated(n, [1, 1]) : minimized(counts, draw(3, 'Allocate', k, 1)));
    }
    const arms = (log: string[]): string[] => log.flatMap((line) => line.match(/drawn → F_([AB])/)?.[1] ?? []);
    const first = await walked(cohort, { Screen: screen });
    expect(arms(first.log)).toEqual(expected.map((arm) => 'AB'[arm]));
    // Each stratum holds two subjects, so blocks of two and alternation give each of them both arms.
    if (algorithm !== 'minimization') expect(new Set(['young,f', 'old,f', 'young,m', 'old,m'].map((stratum) => expected.filter((_arm, j) => `${BANDS[j]},${SEXES[j]}` === stratum).sort().join()))).toEqual(new Set(['0,1']));
    expect(arms((await walked(cohort, { Screen: screen }, { state: first.state })).log)).toEqual(arms(first.log));

    // A session of one subject cannot know the subjects before it, so it is refused before its first step; exploring
    // every way the study can go draws nothing, and is not.
    const plan = planOf(studyModel(`id: study\n${HEAD}${cohort}`));
    expect(() => new Walk(plan, dryHost(plan), { oneInstance: true, participant: 2 })).toThrow(refusal);
    expect(() => new Walk(plan, dryHost(plan), { oneInstance: true, participant: 2 })).toThrow(/a session of one participant does not know/);
    expect((await explore(plan)).complete).toBe(true);

    // A subject that reaches the gateway without its levels stops the run there; a dry run, where no step wrote them,
    // takes a flow at random instead.
    expect((await walked(cohort)).error?.message).toMatch(/^'Allocate' balances its arms on 'band', which participant 1 does not have on reaching it/);
    const dry = new Walk(plan, dryHost(plan), { seed: null });
    await dry.run();
    expect(dry.state._meta.reached).toMatchObject({ Allocate: 8, S9: 8 });
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

// A value a study reuses is a property. The walk writes a claimed step's result into the properties its data edges
// target, narrowed by FEEL over `result` and the properties in scope, whichever runner ran it (this one binds nothing);
// a condition reads them by name. The scored blocks are named once, and the practice block's misses never count.
const UNANSWERED: [label: string, missed: number, reached: Record<string, number>][] = [
  ['too many scored trials unanswered, the boundary takes the walk on', 3, { Start: 1, F1: 1, Play: 1, Quit: 1, F3: 1, Excluded: 1 }],
  ['few enough, the step\'s own flow carries on', 2, { Start: 1, F1: 1, Play: 1, F2: 1, Completed: 1 }],
];
for (const [label, missed, expected] of UNANSWERED) {
  test(`a step's data edge writes a property its boundary event reads: ${label}`, async () => {
    const { reached, state } = await walked(`S:
  type: Process
  properties:
    P_Scored: { name: scored_blocks, value: ["Test_A", "Test_B"] }
    P_Max: { name: max_unanswered, value: 0.2 }
    P_Unanswered: { name: unanswered }
  flowElements:
    Start: { type: StartEvent }
    Play:
      type: ServiceTask
      dataOutputAssociations:
        Out_Unanswered:
          targetRef: P_Unanswered
          transformation: sum(result.blocks[block in scored_blocks].unanswered) / sum(result.blocks[block in scored_blocks].trials)
    Quit:
      type: BoundaryEvent
      attachedToRef: Play
      eventDefinitions:
        Cond_Quit:
          type: ConditionalEventDefinition
          condition: unanswered > max_unanswered
    Excluded: { type: EndEvent }
    Completed: { type: EndEvent }
    F1: Start -> Play
    F2: Play -> Completed
    F3: Quit -> Excluded
`, { Play: () => ({ result: { blocks: [{ block: 'Practice', trials: 4, unanswered: 4 }, { block: 'Test_A', trials: 5, unanswered: 1 },
      { block: 'Test_B', trials: 5, unanswered: missed - 1 }] } }) });
    expect(reached).toEqual(expected);
    expect(state.S.unanswered).toBe(missed / 10);
  });
}

test('a property a sub-process declares with no initial value starts each pass unset, so a pass never reads the one before', async () => {
  const { reached } = await walked(`S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Pass:
      type: SubProcess
      loopCharacteristics: { type: StandardLoopCharacteristics, loopMaximum: 2 }
      properties:
        P_Seen: { name: seen }
      flowElements:
        In: { type: StartEvent }
        Check: { type: ExclusiveGateway, default: F_Write }
        Leaked: { type: EndEvent }
        Write:
          type: ServiceTask
          dataOutputAssociations:
            Out_Seen: { targetRef: P_Seen }
        Out: { type: EndEvent }
        F_In: In -> Check
        F_Leak:
          sourceRef: Check
          targetRef: Leaked
          conditionExpression: seen = 1
        F_Write: Check -> Write
        F_Out: Write -> Out
    Done: { type: EndEvent }
    F1: Start -> Pass
    F2: Pass -> Done
`, { Write: () => ({ result: 1 }) });
  expect(reached.Write).toBe(2);
  expect(reached.Leaked).toBeUndefined();
});

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
  // the list rather than the pass before's value. A list the file writes as YAML reaches the walk as that list.
  const { state, reached } = await walked(`S:
  type: Process
  properties:
    P_Words:
      name: words
      value: [a, b, c]
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

test('a sub-process without a start event starts at every node nothing flows into, and one with nothing in it ends at once', async () => {
  const visit = (inside: string) => `S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Visit:
      type: SubProcess
      flowElements:
${inside}    Done: { type: EndEvent }
    F1: Start -> Visit
    F2: Visit -> Done
`;
  const ran: string[] = [];
  const both = await walked(visit('        Survey: { type: Task }\n        Test: { type: Task }\n        Debrief: { type: Task }\n        VF1: Test -> Debrief\n'),
    { Survey: () => { ran.push('Survey'); return {}; }, Test: () => { ran.push('Test'); return {}; }, Debrief: () => { ran.push('Debrief'); return {}; } });
  expect(both.error).toBeUndefined();
  expect(ran.sort()).toEqual(['Debrief', 'Survey', 'Test']);
  expect([both.reached.Visit, both.reached.Done]).toEqual([1, 1]);
  const empty = await walked(visit(''));
  expect([empty.error, empty.reached]).toEqual([undefined, { Start: 1, F1: 1, Visit: 1, F2: 1, Done: 1 }]);
});

test('a boundary event that does not interrupt starts a path beside its activity, which carries on', async () => {
  // A reminder after a minute, while the task goes on: the task waits until the reminder has been sent.
  const study = (cancel: string, time = 'timeDuration: PT1M') => `S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Play: { type: Task }
    Remind:
      type: BoundaryEvent
      attachedToRef: Play
${cancel}      eventDefinitions:
        - type: TimerEventDefinition
          ${time}
    Nudge: { type: Task }
    Nudged: { type: EndEvent }
    Done: { type: EndEvent }
    F1: Start -> Play
    F2: Play -> Done
    F3: Remind -> Nudge
    F4: Nudge -> Nudged
`;
  const now = { wait: () => Promise.resolve() };
  // The task's runner ends once Nudge has run `times` times.
  const nudging = (times: number): Record<string, Runner> => {
    let nudged = 0;
    let done: () => void = () => undefined;
    const all = new Promise<void>((resolve) => { done = resolve; });
    return {
      Play: async () => { await all; return { result: 'played' }; },
      Nudge: () => { nudged += 1; if (nudged === times) done(); return {}; },
    };
  };
  const beside = await walked(study('      cancelActivity: false\n'), nudging(1), {}, now);
  expect(beside.error).toBeUndefined();
  expect(beside.reached).toMatchObject({ Play: 1, F2: 1, Done: 1, Remind: 1, F3: 1, Nudge: 1, Nudged: 1 });
  expect(beside.walk.steps.entries.find((entry) => entry.node === 'Play')?.interruptedBy).toBeUndefined();
  // A timer cycle starts a path at each firing, up to its repetitions, while the task runs.
  const cycle = await walked(study('      cancelActivity: false\n', 'timeCycle: R3/PT1M'), nudging(3), {}, now);
  expect([cycle.error, cycle.reached.Nudge, cycle.reached.Done]).toEqual([undefined, 3, 1]);
  // An interrupting one ends the task once its hand-off returns, and the task's own flow is not taken.
  const ended = await walked(study(''), { Play: () => new Promise((resolve) => setTimeout(() => resolve({}), 5)), Nudge: () => ({}) }, {}, now);
  expect([ended.error, ended.reached.Done, ended.reached.Nudged]).toEqual([undefined, undefined, 1]);
});

test('a message at a boundary event of a step a runner performs stops the hand-off, and the walk goes on from the event', async () => {
  // The supervisor stops the session: the step's runner is told to stop, and the walk leaves by the boundary event,
  // which holds what the message carried. One that does not interrupt starts a path for each message, the step going on.
  const study = (cancel: string) => `C:
  type: Collaboration
  participants:
    P_Subject: { name: Subject, processRef: S }
    P_Supervisor: { name: Supervisor, processRef: V }
  messageFlows:
    M_Stop: { sourceRef: Tell, targetRef: Stop }
S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Play: { type: Task }
    Stop:
      type: BoundaryEvent
      attachedToRef: Play
${cancel}      eventDefinitions:
        - type: MessageEventDefinition
    Stopped: { type: EndEvent }
    Done: { type: EndEvent }
    F1: Start -> Play
    F2: Play -> Done
    F3: Stop -> Stopped
V:
  type: Process
  flowElements:
    V0: { type: StartEvent }
    Later: { type: IntermediateCatchEvent, timer: PT1M }
    Tell:
      type: SendTask
      dataInputAssociations: { In_Why: { sourceRef: [Why] } }
    Why: { type: DataObjectReference }
    V9: { type: EndEvent }
    VF0: V0 -> Later
    VF1: Later -> Tell
    VF2: Tell -> V9
`;
  // The supervisor's minute passes once the session is under way.
  const later = { wait: () => new Promise<void>((resolve) => setTimeout(resolve, 5)) };
  const stopped: string[] = [];
  const perform: Host['perform'] = (id, _values, { signal }) => (id !== 'Play' ? Promise.resolve({}) : new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => { stopped.push(id); reject(new Error('stopped')); });
  }));
  const ended = await walked(study(''), { Play: () => ({}) }, {}, { ...later, perform });
  expect(ended.error).toBeUndefined();
  expect(stopped).toEqual(['Play']);
  expect([ended.reached.Stop, ended.reached.Stopped, ended.reached.Done]).toEqual([1, 1, undefined]);
  expect(ended.walk.values.get('Stop')).toEqual({ Why: null });
  expect(ended.walk.untaken()).toEqual([]);

  // Not interrupting, the message starts a path of its own, and the step ends as it would have.
  let hold: () => void = () => undefined;
  const heard = new Promise<void>((resolve) => { hold = resolve; });
  const beside = await walked(study('      cancelActivity: false\n').replace('    F3: Stop -> Stopped\n', '    F3: Stop -> Note\n    Note: { type: Task }\n    F4: Note -> Stopped\n'),
    { Play: async () => { await heard; return {}; }, Note: () => { hold(); return {}; } }, {}, later);
  expect(beside.error).toBeUndefined();
  expect([beside.reached.Stop, beside.reached.Note, beside.reached.Stopped, beside.reached.Done]).toEqual([1, 1, 1, 1]);
});

test('a conditional catch event waits until its condition holds, and a run that nothing can change any more is stuck', async () => {
  // The analysis waits until enough sessions are in; the sessions run on a path of their own.
  const study = (writes: string) => `S:
  type: Process
  properties:
    P_Sessions: { name: sessions, value: 0 }
  flowElements:
    Start: { type: StartEvent }
    Split: { type: ParallelGateway }
    Enough:
      type: IntermediateCatchEvent
      condition: sessions >= 2
    Analyse: { type: Task }
    Collect:
      type: Task
      loopCharacteristics: { type: StandardLoopCharacteristics, loopMaximum: 3 }
    Join: { type: ParallelGateway }
    End: { type: EndEvent }
    F1: Start -> Split
    F2: Split -> Enough
    F3: Enough -> Analyse
    F4: Analyse -> Join
    F5: Split -> Collect
    F6: Collect -> Join
    F7: Join -> End
${writes}`;
  const ran: string[] = [];
  const collect: Runner = (values) => { ran.push(`Collect ${values.state.S.sessions + 1}`); return { state: { S: { sessions: values.state.S.sessions + 1 } } }; };
  const waited = await walked(study(''), { Collect: async (values) => { await new Promise((resolve) => setTimeout(resolve, 1)); return collect(values); }, Analyse: (values) => { ran.push(`Analyse at ${values.state.S.sessions}`); return {}; } });
  expect(waited.error).toBeUndefined();
  expect(ran.indexOf('Analyse at 2')).toBe(2);
  expect([waited.reached.Enough, waited.reached.End]).toEqual([1, 1]);
  // Nothing writes `sessions`: once the other path is done, nothing can make the condition hold.
  const stuck = await walked(study(''), { Collect: () => ({}) });
  expect(stuck.error?.message).toBe('the pools wait for each other: Enough waits until sessions >= 2 holds');
  // A conditional start event starts the pool once its condition holds; a dry run passes it.
  const start = `S:
  type: Process
  properties:
    P_Go: { name: go, value: true }
  flowElements:
    Start: { type: StartEvent, condition: go = true }
    End: { type: EndEvent }
    F1: Start -> End
`;
  expect((await walked(start)).reached).toEqual({ Start: 1, F1: 1, End: 1 });
  expect((await walked(start.replace('value: true', 'value: false'))).error?.message).toBe('the pools wait for each other: Start waits until go = true holds');
  const dry = new Walk(planOf(studyModel(`id: study\n${HEAD}${start.replace('value: true', 'value: false')}`)), dryHost(planOf(studyModel(`id: study\n${HEAD}${start}`))));
  await dry.run();
  expect(dry.state._meta.reached).toEqual({ Start: 1, F1: 1, End: 1 });
});

test('an event-based gateway takes the branch whose event comes first: a message, a timer that runs out, a condition that holds', async () => {
  // The participant answers, or the reminder's time runs out first, or the session closes once the study says so.
  const study = (send: boolean) => `C:
  type: Collaboration
  participants:
    P_Study: { name: Study, processRef: S }
    P_Person: { name: Person, processRef: P }
  messageFlows:
    M_Answer: { sourceRef: Answer, targetRef: Answered }
S:
  type: Process
  properties:
    P_Closed: { name: closed, value: false }
  flowElements:
    Start: { type: StartEvent }
    Which: { type: EventBasedGateway }
    Answered: { type: IntermediateCatchEvent }
    Late: { type: IntermediateCatchEvent, timer: PT1H }
    Closed: { type: IntermediateCatchEvent, condition: closed = true }
    End: { type: EndEvent }
    F1: Start -> Which
    F2: Which -> Answered
    F3: Which -> Late
    F4: Which -> Closed
    F5: Answered -> End
    F6: Late -> End
    F7: Closed -> End
P:
  type: Process
  flowElements:
    P0: { type: StartEvent }
${send ? '    Answer: { type: IntermediateThrowEvent }\n    PF1: P0 -> Answer\n    PF2: Answer -> P9\n' : '    PF1: P0 -> P9\n    Answer: { type: IntermediateThrowEvent }\n'}    P9: { type: EndEvent }
`;
  const waits: string[] = [];
  const later = { wait: (_ms: number, _signal: AbortSignal, at: string) => { waits.push(at); return new Promise<void>((resolve) => setTimeout(resolve, 5)); } };
  const answered = await walked(study(true), {}, {}, later);
  expect([answered.error, answered.reached.Answered, answered.reached.Late, answered.reached.Closed]).toEqual([undefined, 1, undefined, undefined]);
  expect(answered.walk.steps.entries.find((entry) => entry.node === 'Which')?.taken).toMatchObject({ sequenceFlow: 'F2', how: 'first message' });
  // No answer comes: the timer runs out, and the timer event is passed, not waited at again.
  const late = await walked(study(false), {}, {}, later);
  expect([late.error, late.reached.Late, late.reached.End]).toEqual([undefined, 1, 1]);
  expect(waits).toEqual(['Late', 'Late']);
  expect(late.walk.steps.entries.find((entry) => entry.node === 'Which')?.taken).toMatchObject({ sequenceFlow: 'F3', how: 'timer', timer: true });
  // The condition holds before the timer runs out.
  const closed = await walked(study(false).replace('value: false', 'value: true'), {}, {}, later);
  expect([closed.error, closed.reached.Closed, closed.reached.Late]).toEqual([undefined, 1, undefined]);
  // Every way it can go: the answer first, the timer, or the condition; once the timer is first, the answer goes
  // untaken.
  expect(await explore(planOf(studyModel(`id: study\n${HEAD}${study(true)}`)))).toEqual({
    complete: true, runs: 3, findings: [{ message: 'a message along M_Answer is sent and nothing takes it', path: ['Which → F3'] }],
  });
});

test('an error goes out to the innermost activity whose error boundary event catches it, by its error or its code', async () => {
  // A visit ends at an error end event, or a step in it fails; which boundary event takes it depends on the error.
  const study = (inside: string, boundaries: string) => `Err_Quit: { type: Error, name: quit, errorCode: quit }
Err_Quit_Too: { type: Error, name: also quit, errorCode: quit }
Err_Other: { type: Error, name: other, errorCode: other }
S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Visit:
      type: SubProcess
      flowElements:
        V0: { type: StartEvent }
        Inner:
          type: SubProcess
          flowElements:
            I0: { type: StartEvent }
${inside}        V9: { type: EndEvent }
        VF1: V0 -> Inner
        VF2: Inner -> V9
${boundaries}    Done: { type: EndEvent }
    Caught: { type: EndEvent }
    F1: Start -> Visit
    F2: Visit -> Done
`;
  const on = (id: string, error?: string) => `    ${id}:
      type: BoundaryEvent
      attachedToRef: Visit
      eventDefinitions:
        - type: ErrorEventDefinition${error ? `\n          errorRef: ${error}` : ''}
    F_${id}: ${id} -> Caught
`;
  const quits = `            Quit:
              type: EndEvent
              eventDefinitions:
                - type: ErrorEventDefinition
                  errorRef: Err_Quit
            IF1: I0 -> Quit
`;
  // The error end event's error, two scopes in, goes out past Inner, which catches nothing, to Visit's boundary event
  // naming another error of its code; the one naming another code does not catch it.
  const coded = await walked(study(quits, on('Other', 'Err_Other') + on('Also', 'Err_Quit_Too')));
  expect(coded.error).toBeUndefined();
  expect([coded.reached.Other, coded.reached.Also, coded.reached.Caught, coded.reached.Done, coded.reached.V9]).toEqual([undefined, 1, 1, undefined, undefined]);
  // One naming no error catches any; nothing catching it, it ends its path.
  expect((await walked(study(quits, on('Any')))).reached.Any).toBe(1);
  const uncaught = await walked(study(quits, on('Other', 'Err_Other')));
  expect([uncaught.error, uncaught.reached.Other, uncaught.reached.Done]).toEqual([undefined, undefined, 1]);

  // A step that fails two scopes in is caught by Visit's boundary event that names no error; its record keeps the
  // failure, and the run is not failed.
  const fails = '            Play: { type: Task }\n            I9: { type: EndEvent }\n            IF1: I0 -> Play\n            IF2: Play -> I9\n';
  const failed = await walked(study(fails, on('Other', 'Err_Other') + on('Any')), { Play: () => { throw new Error('missed'); } });
  expect([failed.error, failed.reached.Any, failed.reached.Other, failed.walk.steps.status]).toEqual([undefined, 1, undefined, 'ok']);
  expect(failed.walk.steps.entries.find((entry) => entry.node === 'Play')).toMatchObject({ status: 'error', interruptedBy: 'Any' });
  // A runner that names the error's code is caught by the event naming that code; with no event to catch it, the run fails.
  const named = await walked(study(fails, on('Other', 'Err_Other') + on('Also', 'Err_Quit_Too')), { Play: () => { throw new HandoffError('no time left', { errorCode: 'quit' }); } });
  expect([named.error, named.reached.Also, named.reached.Other]).toEqual([undefined, 1, undefined]);
  expect((await walked(study(fails, on('Other', 'Err_Other')), { Play: () => { throw new Error('missed'); } })).error?.message).toBe('missed');
  // An event that fails goes the same way: a catch event its runner fails, two scopes in, is caught by Visit's
  // boundary event, and with none to catch it the run fails.
  const senses = '            Sense: { type: IntermediateCatchEvent }\n            I9: { type: EndEvent }\n            IF1: I0 -> Sense\n            IF2: Sense -> I9\n';
  const deaf: Record<string, Runner> = { Sense: () => { throw new Error('nothing sensed'); } };
  const sensed = await walked(study(senses, on('Any')), deaf);
  expect([sensed.error, sensed.reached.Any, sensed.reached.Caught, sensed.walk.steps.status]).toEqual([undefined, 1, 1, 'ok']);
  expect(sensed.walk.steps.entries.find((entry) => entry.node === 'Sense')).toMatchObject({ status: 'error', interruptedBy: 'Any' });
  expect((await walked(study(senses, on('Other', 'Err_Other')), deaf)).error?.message).toBe('nothing sensed');
  // A gateway that fails goes the same way: one its runner cannot sample for, and one none of whose conditions holds,
  // which with nothing to catch it stays where the run got stuck.
  const gate = `            Gate: { type: ExclusiveGateway }
            IA: { type: EndEvent }
            IB: { type: EndEvent }
            IF1: I0 -> Gate
            IF2: { sourceRef: Gate, targetRef: IA, conditionExpression: seen > 0 }
            IF3: { sourceRef: Gate, targetRef: IB, conditionExpression: seen < 0 }
`;
  const blind: Record<string, Runner> = { Gate: () => { throw new Error('nothing seen'); } };
  const unseen = await walked(study(gate, on('Any')), blind);
  expect([unseen.error, unseen.reached.Any, unseen.reached.Caught, unseen.walk.steps.status]).toEqual([undefined, 1, 1, 'ok']);
  expect(unseen.walk.steps.entries.find((entry) => entry.node === 'Gate')).toMatchObject({ status: 'error', interruptedBy: 'Any' });
  expect((await walked(study(gate, on('Other', 'Err_Other')), blind)).error?.message).toBe('nothing seen');
  const neither: Record<string, Runner> = { Gate: () => ({ result: { seen: 0 } }) };
  const undecided = await walked(study(gate, on('Any')), neither);
  expect([undecided.error, undecided.reached.Any, undecided.walk.steps.status]).toEqual([undefined, 1, 'ok']);
  const stuck = await walked(study(gate, on('Other', 'Err_Other')), neither);
  expect(stuck.error?.message).toMatch(/Gate: no condition held/);
  expect(stuck.walk.steps.entries.find((entry) => entry.node === 'Gate')).toMatchObject({ status: 'stuck' });
  // Once the run is ending, because another pool failed, a wait that fails for it is no error of its step: nothing
  // catches it, and the path does not go on from the boundary event.
  const resting = `C:
  type: Collaboration
  participants:
    Lab: { name: Lab, processRef: L }
    Home: { name: Home, processRef: H }
L:
  type: Process
  flowElements:
    L0: { type: StartEvent }
    Break: { type: Task }
    L9: { type: EndEvent }
    LF1: L0 -> Break
    LF2: Break -> L9
H:
  type: Process
  flowElements:
    H0: { type: StartEvent }
    Stay:
      type: SubProcess
      flowElements:
        S0: { type: StartEvent }
        Rest:
          type: IntermediateCatchEvent
          eventDefinitions:
            - { type: TimerEventDefinition, timeDuration: PT1H }
        S9: { type: EndEvent }
        SF1: S0 -> Rest
        SF2: Rest -> S9
    Woken:
      type: BoundaryEvent
      attachedToRef: Stay
      eventDefinitions:
        - type: ErrorEventDefinition
    H9: { type: EndEvent }
    HF1: H0 -> Stay
    HF2: Stay -> H9
    HF3: Woken -> H9
`;
  const never = (_ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => signal.addEventListener('abort', () => resolve()));
  const ended = await walked(resting, { Break: () => { throw new Error('the lab closed'); } }, {}, { wait: never });
  expect([ended.error?.message, ended.reached.Rest, ended.reached.Woken, ended.reached.H9]).toEqual(['the lab closed', 1, undefined, undefined]);
  // Exploring, the step's failure is one way the study can go: the boundary event's path is walked too.
  expect(await explore(planOf(studyModel(`id: study\n${HEAD}${study(fails, on('Any'))}`)))).toMatchObject({ complete: true, runs: 2, findings: [] });
});

test('an ad-hoc sub-process runs its activities round after round until its completion condition holds', async () => {
  // An agent loop: the model is asked, and a gateway after it runs the tool it named; the loop is done once the model
  // says so. One after another (Sequential), the steps of a round run in the order drawn.
  const study = (ordering: string, completion: string) => `S:
  type: Process
  properties:
    P_Asked: { name: asked, value: 0 }
  flowElements:
    Start: { type: StartEvent }
    Agent:
      type: AdHocSubProcess
${ordering}${completion}      flowElements:
        Ask: { type: Task }
        Pick:
          type: ExclusiveGateway
          default: AF_Search
        Search: { type: Task }
        Log: { type: Task }
        AF1: Ask -> Pick
        AF_Search: Pick -> Search
    Done: { type: EndEvent }
    F1: Start -> Agent
    F2: Agent -> Done
`;
  const ran: string[] = [];
  const steps: Record<string, Runner> = {
    Ask: (values) => { ran.push('Ask'); return { state: { S: { asked: values.state.S.asked + 1 } } }; },
    Search: () => { ran.push('Search'); return {}; },
    Log: () => { ran.push('Log'); return {}; },
  };
  const sequential = await walked(study('      ordering: Sequential\n', '      completionCondition: asked >= 2\n'), steps);
  expect(sequential.error).toBeUndefined();
  // The second Ask makes it hold: the Search the gateway would start next does not run, nor does the round's Log.
  expect(ran).toEqual(['Ask', 'Search', 'Log', 'Ask']);
  expect(sequential.reached.Done).toBe(1);
  // No condition: one round, every activity nothing flows into at once.
  ran.length = 0;
  const once = await walked(study('', ''), steps);
  expect([once.error, [...ran].sort()]).toEqual([undefined, ['Ask', 'Log', 'Search']]);
  // Exploring, another round is a choice.
  expect(await explore(planOf(studyModel(`id: study\n${HEAD}${study('', '      completionCondition: asked >= 2\n')}`)))).toMatchObject({ complete: true, runs: 2, findings: [] });
});

test('a multi-instance marker stops once its completion condition holds, keeping what the passes that ran left', async () => {
  const { error, state, walk } = await walked(`S:
  type: Process
  properties:
    P_Words: { name: words, value: [red, green, blue, pink] }
    P_Shouts: { name: shouts }
  flowElements:
    Start: { type: StartEvent }
    Shout:
      type: Task
      loopCharacteristics:
        type: MultiInstanceLoopCharacteristics
        loopDataInputRef: P_Words
        loopDataOutputRef: P_Shouts
        inputDataItem: { id: Shout_Word, name: word }
        outputDataItem: { id: Shout_Out, name: shout }
        completionCondition: shout = "GREEN" or numberOfCompletedInstances = numberOfInstances
      properties:
        P_Shout: { name: shout }
    End: { type: EndEvent }
    F1: Start -> Shout
    F2: Shout -> End
`, { Shout: (values) => ({ state: { Shout: { shout: String(values.state.Shout.word).toUpperCase() } } }) });
  expect(error).toBeUndefined();
  expect(state.S.shouts).toEqual(['RED', 'GREEN']);
  expect(walk.steps.entries.filter((entry) => entry.node === 'Shout')).toHaveLength(2);
});

test('a call activity walks the process it calls in its place, which is no pool of its own', async () => {
  const study = (calls: string) => `S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Screen: { type: CallActivity, calledElement: Screening }
    Unsuitable:
      type: BoundaryEvent
      attachedToRef: Screen
      eventDefinitions:
        - type: ErrorEventDefinition
    Excluded: { type: EndEvent }
    Done: { type: EndEvent }
    F1: Start -> Screen
    F2: Screen -> Done
    F3: Unsuitable -> Excluded
Screening:
  type: Process
  name: Screening protocol
  flowElements:
    C0: { type: StartEvent }
    Check: { type: Task }
    Fit:
      type: ExclusiveGateway
      default: CF_Fit
    Unfit:
      type: EndEvent
      eventDefinitions:
        - type: ErrorEventDefinition
    C9: { type: EndEvent }
    CF1: C0 -> Check
    CF2: Check -> Fit
    CF_Fit: Fit -> ${calls}
    CF_Unfit: { sourceRef: Fit, targetRef: Unfit, conditionExpression: Check.score < 3 }
`;
  const fine = await walked(study('C9'), { Check: () => ({ result: { score: 5 } }) });
  expect(fine.plan.processes).toEqual(['S']);
  expect(fine.plan.called).toEqual(['Screening']);
  expect([fine.error, fine.reached.Screen, fine.reached.Check, fine.reached.C9, fine.reached.Done]).toEqual([undefined, 1, 1, 1, 1]);
  // The error the called process throws is caught at the call activity's boundary event.
  const unfit = await walked(study('C9'), { Check: () => ({ result: { score: 1 } }) });
  expect([unfit.error, unfit.reached.Unfit, unfit.reached.Unsuitable, unfit.reached.Excluded, unfit.reached.Done]).toEqual([undefined, 1, 1, 1, undefined]);
  // A process that calls itself is refused when it does.
  const again = study('Again\n    Again: { type: CallActivity, calledElement: Screening }\n    CF9: Again -> C9');
  expect((await walked(again, { Check: () => ({ result: { score: 5 } }) })).error?.message).toMatch(/Again calls Screening, which this path is already inside/);
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
  // Whatever it remembers, a pool hears who asks and how many messages that instance had sent it before.
  const askers: unknown[] = [];
  await walked(study('none'), { Model: (values) => { askers.push(values.asker); return {}; } });
  expect(askers).toEqual([
    { id: 'Model with Subjects #1', n: 0, step: 'First' }, { id: 'Model with Subjects #1', n: 1, step: 'Then' },
    { id: 'Model with Subjects #2', n: 0, step: 'First' }, { id: 'Model with Subjects #2', n: 1, step: 'Then' },
  ]);
  // A window is the same conversation, with how many of its latest exchanges the pool remembers: the actor's
  // `memoryWindow`, else 20.
  expect((await heard('window, memoryWindow: 5'))[1]).toEqual({ id: 'Model with Subjects #1', turn: 1, window: 5 });
  expect((await heard('window'))[3]).toEqual({ id: 'Model with Subjects #2', turn: 1, window: 20 });
});

test('a sub-process says what a pool remembers of the messages its steps send, in place of the actor', async () => {
  // Two arms of one study: the actor keeps the conversation of the steps inside Arm_Memory, and none inside Arm_None.
  const study = (actor: string) => `C:
  type: Collaboration
  participants:
    Subjects: { name: Subjects, processRef: S }
    Model: { type: studyflow:Actor, name: Model, actorType: llm, memory: ${actor} }
  messageFlows:
    M_A1: { sourceRef: A1, targetRef: Model }
    M_A2: { sourceRef: A2, targetRef: Model }
    M_B1: { sourceRef: B1, targetRef: Model }
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Arm_Memory:
      type: SubProcess
      memory: conversation
      flowElements:
        A0: { type: StartEvent }
        A1: { type: SendTask }
        A2: { type: SendTask }
        A9: { type: EndEvent }
        AF1: A0 -> A1
        AF2: A1 -> A2
        AF3: A2 -> A9
    Arm_None:
      type: SubProcess
      memory: none
      flowElements:
        B0: { type: StartEvent }
        B1: { type: SendTask }
        B9: { type: EndEvent }
        BF1: B0 -> B1
        BF2: B1 -> B9
    S9: { type: EndEvent }
    SF1: S0 -> Arm_Memory
    SF2: Arm_Memory -> Arm_None
    SF3: Arm_None -> S9
`;
  const heard = async (actor: string): Promise<unknown[]> => {
    const conversations: unknown[] = [];
    await walked(study(actor), { Model: (values) => { conversations.push(values.conversation); return {}; } });
    return conversations;
  };
  const kept = [{ id: 'Model with Subjects', turn: 0 }, { id: 'Model with Subjects', turn: 1 }, undefined];
  expect(await heard('none')).toEqual(kept);
  expect(await heard('conversation')).toEqual(kept);
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

test('each instance of a pool holds its own values over the study\'s, and the run ends with the last instance\'s', async () => {
  // The result of one instance's step is that instance's: the next instance finds none before its own step runs.
  // A data object and the counts stay the study's, shared by every instance.
  const seen: unknown[] = [];
  const { state, walk } = await walked(`C:
  type: Collaboration
  participants:
    Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 2
      processRef: S
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Look: { type: Task }
    Answer:
      type: Task
      dataOutputAssociations: { Out_Log: { targetRef: Log } }
    Log: { type: DataObjectReference }
    S9: { type: EndEvent }
    SF1: S0 -> Look
    SF2: Look -> Answer
    SF3: Answer -> S9
`, {
    Look: (values) => {
      seen.push([values.state._meta.instance.Subjects, values.Answer ?? null, values.Log ?? null]);
      return {};
    },
    Answer: (values) => ({ result: `answer ${values.state._meta.instance.Subjects}`, values: { Log: `log ${values.state._meta.instance.Subjects}` } }),
  });
  expect(seen).toEqual([[1, null, null], [2, null, 'log 1']]);
  expect(state._meta?.instance).toEqual({ Subjects: 2 });
  expect(state._meta?.reached).toMatchObject({ Look: 2, Answer: 2 });
  expect(walk.values.get('Answer')).toBe('answer 2');
});

test('a data store is the study\'s, kept from run to run; a process\'s properties start each instance and each run from their value, a task\'s each pass', async () => {
  // Each subject counts itself into the store through a reference to it, and the gateway reads the store by name.
  const study = `C:
  type: Collaboration
  participants:
    Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 3
      processRef: S
Tally:
  type: DataStore
  name: tally
  value: "0"
S:
  type: Process
  properties:
    P_Mark: { name: mark, value: fresh }
  flowElements:
    S0: { type: StartEvent }
    Tally_Ref: { type: DataStoreReference, dataStoreRef: Tally }
    Count:
      type: Task
      properties:
        P_Here: { name: here }
      dataInputAssociations: { In_Tally: { sourceRef: [Tally_Ref] } }
      dataOutputAssociations: { Out_Tally: { targetRef: Tally_Ref, transformation: tally + 1 } }
    Gate: { type: ExclusiveGateway, default: F_Small }
    Big: { type: EndEvent }
    Small: { type: EndEvent }
    SF1: S0 -> Count
    SF2: Count -> Gate
    F_Big: { sourceRef: Gate, targetRef: Big, conditionExpression: tally > 2 }
    F_Small: Gate -> Small
`;
  const seen: unknown[] = [];
  const runners: Record<string, Runner> = {
    Count: (values) => {
      seen.push([values.state._meta.instance.Subjects, values.state.Tally, values.state.S.mark, values.state.Count?.here ?? null]);
      return { result: 1, state: { S: { mark: 'used' }, Count: { here: 'yes' } } };
    },
  };
  const first = await walked(study, runners);
  expect(first.error).toBeUndefined();
  expect(seen).toEqual([[1, 0, 'fresh', null], [2, 1, 'fresh', null], [3, 2, 'fresh', null]]);
  expect([first.state.Tally, first.reached.Big, first.reached.Small]).toEqual([3, 1, 2]);
  expect(first.events.filter((event) => event.event === 'wrote' && 'store' in event).map((event) => 'value' in event && event.value)).toEqual([0, 1, 2, 3]);

  // A run of the executed copy goes on from the store, while the properties start again from their values.
  seen.length = 0;
  const second = await walked(study, runners, { state: first.state });
  expect(seen).toEqual([[1, 3, 'fresh', null], [2, 4, 'fresh', null], [3, 5, 'fresh', null]]);
  expect([second.state.Tally, second.reached.Big]).toEqual([6, 4]);

  // A study without pools: its one walk is one instance, the next run starts its properties again, and each pass of
  // a step finds the step's own property unset.
  const visits: unknown[] = [];
  const once = `S:
  type: Process
  properties:
    P_Mark: { name: mark, value: fresh }
  flowElements:
    S0: { type: StartEvent }
    Count:
      type: Task
      loopCharacteristics: { type: StandardLoopCharacteristics, loopMaximum: 2 }
      properties:
        P_Here: { name: here }
    S9: { type: EndEvent }
    SF1: S0 -> Count
    SF2: Count -> S9
`;
  const looping = { Count: (values: Record<string, any>) => {
    visits.push([values.state.S.mark, values.state.Count?.here ?? null]);
    return { state: { S: { mark: 'used' }, Count: { here: 'yes' } } };
  } };
  const looped = await walked(once, looping);
  await walked(once, looping, { state: looped.state });
  expect([looped.error, visits]).toEqual([undefined, [['fresh', null], ['used', null], ['fresh', null], ['used', null]]]);
});

// `concurrency`: the instances of a pool start in order, up to that many walking at once. Each keeps its own values
// and takes only the answers to what it sent, whichever instance asked first or reads its mail last.
const CONCURRENT = `C:
  type: Collaboration
  extensionElements:
    - type: studyflow:Study
      seed: 3
  participants:
    Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 4
      processRef: S
    Model: { name: Model }
  messageFlows:
    M_Trial: { sourceRef: Play, targetRef: Model }
    M_Answer: { sourceRef: Model, targetRef: Play }
S:
  type: Process
  properties:
    P_Mine: { name: mine }
  flowElements:
    S0: { type: StartEvent }
    Allocate:
      type: ExclusiveGateway
      extensionElements:
        - type: cognitive:RandomGateway
          algorithm: block
          blockSize: 2
    Play:
      type: Task
      dataOutputAssociations: { Out_Mine: { targetRef: P_Mine } }
    Check: { type: Task }
    S9: { type: EndEvent }
    SF0: S0 -> Allocate
    F_A: Allocate -> Play
    F_B: Allocate -> Play
    SF1: Play -> Check
    SF2: Check -> S9
`;

for (const concurrency of [1, 2]) {
  test(`instances walk ${concurrency === 1 ? 'one after another by default' : 'at once, up to the concurrency'}, each with its own values and answers`, async () => {
    let walking = 0;
    let most = 0;
    const checked: unknown[] = [];
    const { error, events } = await walked(CONCURRENT, {
      // An earlier instance waits longer before it reads its answer, so a later one reads its mail first.
      Play: async (values, talk) => {
        const instance = values.state._meta.instance.Subjects;
        walking += 1;
        most = Math.max(most, walking);
        talk!.send({ flow: 'M_Trial', id: `t${instance}`, content: { instance } });
        await new Promise((resolve) => setTimeout(resolve, (5 - instance) * 10));
        const taken = await answers(talk!, 1);
        walking -= 1;
        return { result: [instance, ...taken.map((answer) => answer.content)] };
      },
      Model: (values) => ({ result: `answer ${values.message.content.instance}` }),
      Check: (values) => {
        checked.push(values.state.S.mine);
        return {};
      },
    }, { concurrency });
    expect(error).toBeUndefined();
    expect(most).toBe(concurrency);
    expect(checked.sort()).toEqual([1, 2, 3, 4].map((n) => [n, `answer ${n}`]).sort());
    // Each draw keeps which participant drew and its place: the order the instances arrived at the gateway.
    const drawn = events.flatMap((event) => (event.event === 'executed' && event.id === 'Allocate' ? [event.entry!.taken as Record<string, unknown>] : []));
    expect(drawn.map(({ place }) => place)).toEqual([1, 2, 3, 4]);
    expect(drawn.map(({ participant }) => participant).sort()).toEqual([1, 2, 3, 4]);
    // Every event an instance's steps record names it, however the instances interleave: each step and decision, the
    // trial it sent, the model's answer and the answer's message back.
    const named = (n: number): RunEvent[] => events.filter((event) => event.participant === `Subjects#${n}`);
    for (const n of [1, 2, 3, 4]) {
      expect(named(n).map((event) => (event.event === 'sent' ? `sent ${event.message.inReplyTo ?? event.message.id}` : `${event.event} ${'id' in event ? event.id : ''}`)))
        .toEqual(['executed S0', 'executed Allocate', `sent t${n}`, 'answered Model', `sent t${n}`, 'executed Play', 'executed Check', 'executed S9']);
    }
    expect(events.filter((event) => event.participant === undefined).map((event) => event.event)).not.toContain('executed');
  });
}

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

/** Two subjects, each screened by a questionnaire whose band names who answers it; `boundary` is drawn on it. */
const BANDED = (actor: string, boundary = '') => `C:
  type: Collaboration
  participants:
    Subjects:
      name: Subjects
      participantMultiplicity:
        maximum: 2
      processRef: S
    Model: { type: studyflow:Actor, name: Model, ${actor} }
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Check: { type: DataObjectReference }
    Screen:
      type: cognitive:Questionnaire
      instrument: comprehension-check
      participantRef: [Model]
      dataInputAssociations:
        In_Check: { sourceRef: [Check] }
    Back: { type: EndEvent }
    SF1: S0 -> Screen
    SF2: Screen -> Back
${boundary}`;

const LATE = `    Late:
      type: BoundaryEvent
      attachedToRef: Screen
      eventDefinitions:
        Late_Timer: { type: TimerEventDefinition, timeDuration: P7D }
    Gone: { type: EndEvent }
    SF3: Late -> Gone
`;

test('a typed choreography task exchanges with the pool its band names, as a pair of message flows would carry it', async () => {
  // A pool a program answers on the band: the plan carries the exchange as two message flows, out of the task and back.
  const plan = planOf(studyModel(`id: study\n${HEAD}${BANDED('actorType: software')}`));
  expect([plan.elements.Screen_to_Model?.attributes, plan.elements.Model_to_Screen?.attributes]).toEqual([
    { sourceRef: 'Screen', targetRef: 'Model', band: 'Screen' }, { sourceRef: 'Model', targetRef: 'Screen', band: 'Screen' }]);
  // Each subject's questionnaire asks the model along it and takes the answer as its result, the step that asks named.
  const asked: unknown[] = [];
  const { reached, error, walk } = await walked(BANDED('actorType: software'), {
    Model: (values) => { asked.push([values.message.flow, values.asker.step, values.asker.id]); return { result: 'READY' }; },
  });
  expect(error).toBeUndefined();
  expect(asked).toEqual([['Screen_to_Model', 'Screen', 'Model with Subjects #1'], ['Screen_to_Model', 'Screen', 'Model with Subjects #2']]);
  expect([reached.Screen, reached.Back, walk.values.get('Screen')]).toEqual([2, 2, 'READY']);
  // A step with nothing to send asks nothing, as along the flows it would inherit.
  const silent = await walked(BANDED('actorType: software').replace(/      dataInputAssociations:\n        In_Check: \{ sourceRef: \[Check\] \}\n/, ''), {
    Model: () => { throw new Error('asked'); },
  });
  expect([silent.error, silent.reached.Back]).toEqual([undefined, 2]);
  // A pool that names the program playing it is one too, whatever its kind; a person on the band is no such pool, and
  // neither is a task with message flows of its own, which it exchanges along whatever its band says.
  expect(planOf(studyModel(`id: study\n${HEAD}${BANDED('implementation: ollama://some-model')}`)).elements.Screen_to_Model).toBeDefined();
  expect(planOf(studyModel(`id: study\n${HEAD}${BANDED('actorType: human')}`)).elements.Screen_to_Model).toBeUndefined();
  const own = BANDED('actorType: software').replace('    Model: { type: studyflow:Actor', '    Other: { name: Other }\n    Model: { type: studyflow:Actor')
    .replace('S:\n  type: Process', '  messageFlows:\n    M_Own: { sourceRef: Screen, targetRef: Other }\nS:\n  type: Process');
  expect(planOf(studyModel(`id: study\n${HEAD}${own}`)).elements.Screen_to_Model).toBeUndefined();
});

test('a message a pool\'s runner leaves unanswered is waited for, until a timer at a boundary event ends the wait', async () => {
  // The second subject never replies: its questionnaire waits until its timer runs out, and it leaves by the boundary
  // event; the first, answered, goes on. Neither fails, and the run is not stuck while the timer runs.
  const model: Runner = (values) => (values.asker.id.endsWith('#2') ? { noReply: true } : { result: 'READY' });
  const timers: string[] = [];
  const wait = (_ms: number, signal: AbortSignal, at: string): Promise<void> => new Promise((resolve) => {
    timers.push(at);
    const timer = setTimeout(resolve, 20);
    signal.addEventListener('abort', () => clearTimeout(timer));
  });
  const { reached, error, walk } = await walked(BANDED('actorType: software', LATE), { Model: model }, {}, { wait });
  expect(error).toBeUndefined();
  expect(timers).toEqual(['Late', 'Late']);
  expect([reached.Back, reached.Late, reached.Gone]).toEqual([1, 1, 1]);
  expect(walk.steps.status).toBe('ok');
  expect(walk.steps.entries.filter((entry) => entry.node === 'Screen').map((entry) => entry.interruptedBy ?? entry.status)).toEqual(['ok', 'Late']);
  expect(walk.steps.entries.filter((entry) => entry.node === 'Model').map((entry) => entry.unanswered ?? false)).toEqual([false, true]);
  // Every way it can go ends properly: an answer that comes for a step its timer has ended is not left untaken.
  expect((await explore(planOf(studyModel(`id: study\n${HEAD}${BANDED('actorType: software', LATE)}`)))).findings).toEqual([]);
  // With no timer to end the wait, nothing else can happen: the run fails as stuck rather than wait forever.
  const stuck = await walked(BANDED('actorType: software'), { Model: model });
  expect(stuck.error?.message).toBe('the pools wait for each other: Screen waits along Model_to_Screen');
});

const BROKE = `    Broke:
      type: BoundaryEvent
      attachedToRef: Screen
      eventDefinitions:
        - type: ErrorEventDefinition
    Gone: { type: EndEvent }
    SF3: Broke -> Gone
`;

test('a pool whose runner fails a message fails the step that asked, which an error boundary event on it catches', async () => {
  // The model cannot answer the second subject: that subject's questionnaire fails with the model's failure and leaves
  // by the boundary event; the first, answered, goes on. The run is not failed, and the model's record keeps the error.
  const model: Runner = (values) => {
    if (values.asker.id.endsWith('#2')) throw new Error('no such model');
    return { result: 'READY' };
  };
  const { reached, error, walk } = await walked(BANDED('actorType: software', BROKE), { Model: model });
  expect([error, reached.Back, reached.Broke, reached.Gone, walk.steps.status]).toEqual([undefined, 1, 1, 1, 'ok']);
  expect(walk.steps.entries.filter((entry) => entry.node === 'Screen').map((entry) => entry.interruptedBy ?? entry.status)).toEqual(['ok', 'Broke']);
  expect(walk.steps.entries.filter((entry) => entry.node === 'Model').map((entry) => entry.status)).toEqual(['ok', 'error']);
  // Exploring, the failed answer is one way the study can go: the boundary event's path is walked too.
  expect(await explore(planOf(studyModel(`id: study\n${HEAD}${BANDED('actorType: software', BROKE)}`)))).toMatchObject({ complete: true, runs: 2, findings: [] });
  // With no event to catch it, the run fails with the model's failure.
  expect((await walked(BANDED('actorType: software'), { Model: model })).error?.message).toMatch(/^Model could not answer Screen_to_Model\.\d+: no such model$/);
  // A step a runner is running is stopped when the pool it asked fails, and fails the same way, keeping what it had bound.
  const stopped: string[] = [];
  const perform: Host['perform'] = (id, _values, { talk, signal }) => (id === 'Model' ? Promise.reject(new Error('no such model')) : new Promise((_resolve, reject) => {
    talk!.send({ flow: 'Screen_to_Model', id: 't1', content: null });
    signal!.addEventListener('abort', () => { stopped.push(id); reject(new HandoffError('Screen was stopped', { values: { Check: 'seen' } })); });
  }));
  const run = await walked(BANDED('actorType: software'), { Model: () => ({}), Screen: () => ({}) }, {}, { perform });
  expect([run.error?.message, stopped, run.walk.values.get('Check')]).toEqual(['Model could not answer t1: no such model', ['Screen'], 'seen']);
  // An event that asks is no different: a throw event whose message the model cannot take fails, and the error
  // boundary event of the sub-process around it catches that.
  const told = await walked(`C:
  type: Collaboration
  participants:
    Subjects: { name: Subjects, processRef: S }
    Model: { type: studyflow:Actor, name: Model, actorType: software }
  messageFlows:
    M_Tell: { sourceRef: Tell, targetRef: Model }
S:
  type: Process
  flowElements:
    S0: { type: StartEvent }
    Visit:
      type: SubProcess
      flowElements:
        V0: { type: StartEvent }
        Tell: { type: IntermediateThrowEvent }
        V9: { type: EndEvent }
        VF1: V0 -> Tell
        VF2: Tell -> V9
    Broke:
      type: BoundaryEvent
      attachedToRef: Visit
      eventDefinitions:
        - type: ErrorEventDefinition
    Back: { type: EndEvent }
    Gone: { type: EndEvent }
    SF1: S0 -> Visit
    SF2: Visit -> Back
    SF3: Broke -> Gone
`, { Model: () => { throw new Error('no such model'); } });
  expect([told.error, told.reached.Broke, told.reached.Gone, told.reached.Back]).toEqual([undefined, 1, 1, undefined]);
});

test('a pool of many instances sends its outgoing message once, after the last instance', async () => {
  // The whole pool is one sender: the flow out of the participant is the cohort's own, not each instance's, so the
  // analysis pool's message start event ("All subjects complete") starts once, when the third subject is done.
  const analysed: unknown[] = [];
  const { reached, events } = await walked(`C:
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
  // The message is the pool's, and the analysis pool is one: neither names a participant.
  const pools = events.filter((event) => event.event === 'sent' || (event.event === 'executed' && ['A0', 'Analyze'].includes(event.id)));
  expect(pools.map((event) => [event.event, event.participant])).toEqual([['sent', undefined], ['executed', undefined], ['executed', undefined]]);
  expect(events.filter((event) => event.event === 'executed' && event.id === 'Play').map((event) => event.participant)).toEqual(['Subjects#1', 'Subjects#2', 'Subjects#3']);
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

test('a study of steps and no flow starts at each, as BPMN starts every node nothing flows into', async () => {
  const one = await walked('S:\n  type: Process\n  flowElements:\n    Only: { type: Task }\n');
  expect([one.error, one.reached]).toEqual([undefined, { Only: 1 }]);
  const two = await walked('S:\n  type: Process\n  flowElements:\n    Only: { type: Task }\n    Second: { type: Task }\n');
  expect([two.error, two.reached]).toEqual([undefined, { Only: 1, Second: 1 }]);
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
