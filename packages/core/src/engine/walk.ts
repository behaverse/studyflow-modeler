import { PLACEHOLDER } from '@core/model/state';
import { allocationOf, alternated, draw, minimized, permutedBlock, pick, withoutCohort, withoutConcealedSeed, type Allocation } from '@core/engine/allocation';
import { CONTAINER_TYPES, GATEWAY_TYPES, Graph, PASSTHROUGH_TYPES } from '@core/engine/graph';
import { Cancelled, HandoffError, Interrupted, keepRecord, logAt, type Handback, type Host, type Message, type Note, type StateTree, type Thread, type WalkOptions } from '@core/engine/host';
import type { Expression, Plan, PlanElement } from '@core/engine/plan';
import type { Happening, RunEvent } from '@core/engine/record';
import { Post, type Branch, type Exchange } from '@core/engine/post';
import { Steps, type Entry } from '@core/engine/steps';
import { cycleOf, timerDelay } from '@core/engine/timer';
import { Values } from '@core/engine/values';

/**
 * The walk: one study, walked as the notation says. It is the one engine behind every runtime: the local runtime
 * hosts it and hands each claimed element to a partial runner (packages/runtime-local/CONTRACT.md), the browser runtime hosts it
 * and shows each step as a screen, and the modeler hosts it as a dry run. It executes nothing itself and does no I/O:
 * a host says who claims an element and performs it, keeps the records, and decides what a re-run may reuse.
 *
 * Every pool with a process is walked at once, each as its own task. A pool walks one path until a split gives it
 * more: each walks on its own, and a join waits for the paths it joins. The pools talk only along message flows, and
 * the walk carries every message.
 */

const bpmnType = (element: PlanElement): string => `bpmn:${element.type.charAt(0).toUpperCase()}${element.type.slice(1)}`;

const has = (element: PlanElement, definition: string): boolean => (element.events ?? []).includes(definition);

/** Whether a boundary event ends its activity when it happens: every one but those with `cancelActivity` false, and
 * an error boundary event always (BPMN 2.0). */
const interrupts = (boundary: PlanElement): boolean => boundary.attributes.cancelActivity !== 'false' || has(boundary, 'errorEventDefinition');

/** A conditional event's condition, when it has one. */
const conditionOf = (element: PlanElement): Expression | undefined => (has(element, 'conditionalEventDefinition') ? element.condition : undefined);

/** A path walking a scope: the token, and the element it is at. */
type Path = { at: string; thread: Thread };

/** An ad-hoc sub-process's `completionCondition` as its scope reads it after each activity inside it: whether it holds
 * now, whether its holding stops what still runs (`cancelRemainingInstances`), and whether it has held. */
type Completion = { holds: () => boolean; cancel: boolean; held: boolean };

/** The paths a scope's walk runs, the tokens waiting at its joins, and what ends them all. */
type Scope = {
  depth: number;
  tasks: Promise<void>[];
  running: Set<Path>;
  /** The tokens that have come to each join and wait there, with the path the last came along. */
  joins: Map<string, { arrived: number; thread: Thread }>;
  cancel: AbortController;
  /** The thing that ended the scope, a path's failure or a boundary event outside it; the scope's walk throws it. */
  failure?: unknown;
  /** The completion condition of the ad-hoc sub-process the scope is the inside of. */
  completion?: Completion;
};

/** An error as a boundary event catches it: the error an error end event throws, or the code a failure carries. */
type Thrown = { ref?: string; code?: string };

/** Every non-empty subset of `items`, smallest first: which conditioned flows of a split may hold together. */
function subsets<T>(items: T[]): T[][] {
  const all: T[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask += 1) all.push(items.filter((_item, i) => mask & (1 << i)));
  return all.sort((a, b) => a.length - b.length);
}

/**
 * The flows an inclusive gateway takes, given its conditioned flows that hold: those, each flow without a condition, and
 * its default flow when no condition holds (BPMN 2.0), in the order of `flows`.
 */
function inclusiveTaken(flows: PlanElement[], held: PlanElement[], fallback: unknown): PlanElement[] {
  return flows.filter((flow) => held.includes(flow)
    || (!flow.condition && (flow.id !== fallback || held.length === 0)));
}

export class Walk {
  readonly graph: Graph;
  readonly steps: Steps;
  /** Every element that never skips or replays: a live runner's, one that exchanges messages, one that repeats. */
  readonly live = new Set<string>();
  readonly allocations = new Map<string, Allocation>();

  private readonly host: Host;
  private readonly seed: number | undefined;
  /** The seed each concealing gateway draws from in place of the run's. */
  private readonly concealed = new Map<string, string>();
  private readonly maxSteps: number;
  private readonly oneInstance: boolean;
  private readonly participant: number;
  /** How many instances of a pool walk at once. */
  private readonly concurrency: number;
  private readonly blocks = new Map<string, number[]>();
  /** The deals of each allocation sequence so far, in order: each participant's levels of its factors, and its arm. */
  private readonly dealt = new Map<string, { levels: string[]; arm: number }[]>();
  private readonly memory: Values;
  /** The values of each pool instance walking, by `<pool>#<instance>`: a pool of one walks the study's. */
  private readonly instances = new Map<string, Values>();
  private readonly post: Post;
  /** Tells the host what happened: the run's record. */
  private readonly record: (happened: Happening, thread?: Thread) => void;
  private early: RunEvent[] | undefined = [];
  private paths = 0;
  /** The events an event-based gateway saw happen, by `<path> <event>`: the path passes each without waiting again. */
  private readonly fired = new Set<string>();

  constructor(plan: Plan, host: Host, options: WalkOptions = {}) {
    this.host = host;
    this.graph = new Graph(plan);
    this.steps = new Steps(host.clock ? () => host.clock!() : undefined);
    // Each event goes to the host as it happens: the run's record (packages/core/src/engine/record.ts). An event
    // before the run begins waits for it, so the record starts where the host says the run started. An event a thread
    // records names the participant it walks for.
    const record = this.record = (happened: Happening, thread?: Thread): void => {
      const participant = thread && this.participantOf(thread);
      const event = { ...happened, ...(participant ? { participant } : {}), at: host.now() } as RunEvent;
      if (this.early) this.early.push(event);
      else host.record?.(event);
      // The change may make a condition a path waits for hold.
      this.post?.valuesChanged();
    };
    this.memory = new Values(this.graph, options.state ?? {}, record);
    this.post = new Post(this.graph, host, this.steps, (thread) => this.valuesOf(thread), record);
    this.maxSteps = options.maxSteps ?? 1000;
    this.oneInstance = options.oneInstance ?? false;
    this.participant = options.participant ?? 1;
    this.concurrency = Number.isInteger(options.concurrency) && options.concurrency! > 1 ? options.concurrency! : 1;
    const seed = Number((options.seed === undefined ? plan.study.seed : options.seed) ?? NaN);
    this.seed = Number.isInteger(seed) ? seed : undefined; // unseeded: `Math.random()`, and a re-run replays the recorded decision instead

    const { graph } = this;
    // Each random gateway's allocation, read before the walk: one it cannot apply stops the run here.
    for (const gateway of Object.values(graph.elements)) {
      if (GATEWAY_TYPES.has(gateway.type) && gateway.branching === 'random') {
        const allocation = allocationOf(gateway, (graph.outgoing.get(gateway.id) ?? []).length);
        this.allocations.set(gateway.id, allocation);
        // A concealed allocation draws from the seed the run was given for it. Unseeded on purpose (a simulation, an
        // exploration), it draws at random like every other gateway; otherwise a run without that seed cannot draw.
        const given = options.concealed?.[gateway.id];
        if (given !== undefined) this.concealed.set(gateway.id, given);
        else if (allocation.seedDigest && options.seed !== null) {
          throw new Error(withoutConcealedSeed(gateway, allocation.seedDigest));
        }
        // Strata and minimization deal by the participants before this one, which a session of one participant (a
        // browser's) does not walk; one that explores every way instead of drawing needs none of them.
        if (allocation.factors.length > 0 && this.oneInstance && !host.choose) {
          throw new Error(withoutCohort(gateway, allocation));
        }
      }
    }
    // Messages are interaction: an element that sends or takes them never skips or replays, nor does a gateway the
    // first message decides, nor an unclaimed step that asks along its pool's flows. Nor does what repeats, in an
    // activity with a loop or a multi-instance marker or in a pool of several instances: a record keeps an element's
    // last pass only, so replaying it would give every pass the last one's outcome.
    const repeats = (id: string): boolean => graph.scopeChain(id).some((scope) => graph.elements[scope]?.loop)
      || (!this.oneInstance && graph.instancesOf(graph.poolOf(id)).instances > 1);
    for (const id of graph.walked) {
      const element = graph.elements[id];
      const claim = host.claim(id);
      const talks = (): boolean => { const { outgoing, incoming } = graph.exchange(element); return outgoing.length + incoming.length > 0; };
      if (claim?.live || graph.flowsIn.has(id) || graph.flowsOut.has(id) || element.type === 'eventBasedGateway'
        || (!claim && talks()) || repeats(id)) {
        this.live.add(id);
      }
    }
    for (const id of graph.participants.keys()) if (host.claim(id)?.live) this.live.add(id);
    // A data store lives for the whole study, so only one the state lacks takes its `value`. A process's properties
    // live for one instance of it, so a run starts each from its `value`, never from what the last run left.
    const note = this.note({ pool: '', path: '', depth: 0, watching: [], cancels: [], heard: new Map(), participant: 1, visits: new Map() });
    this.memory.startStores(note);
    for (const process of plan.processes) this.memory.restartScope(process, note);
  }

  // --- the run ---

  async run(): Promise<void> {
    const { graph, host } = this;
    // The events from before the run began go to the record now, after the host's `started`.
    const early = this.early ?? [];
    this.early = undefined;
    for (const happened of early) host.record?.(happened);
    // A name several elements share cites nothing, which matters only where a placeholder cites it: three questions
    // may each end at `Supported` and answer `yes` without a warning, as long as no `{Supported.…}` is written.
    const cited = citedNames(Object.values(graph.elements));
    const ambiguous = new Set(Object.values(graph.elements)
      .filter((element) => graph.walked.has(element.id) && element.name && /^[A-Za-z_]\w*$/.test(element.name) && !graph.plan.names[element.id])
      .map((element) => element.name!)
      .filter((name) => cited.has(name)));
    for (const name of [...ambiguous].sort()) {
      host.log('name.ambiguous', `  ${name} names more than one element, or is also an id: \`{${name}.…}\` cites nothing until it is unique`, { level: 'warning' });
    }
    const pools = graph.plan.processes;
    // Every pool runs at once, each on its own token; the message flows are where they wait for each other.
    await Promise.all(pools.map(async (pool) => {
      try {
        await this.runPool(pool);
      } catch (error) {
        this.post.failed ??= error; // the first pool to fail ends the run; the others notice while waiting
      } finally {
        this.post.ended(pool);
      }
    }));
    if (this.post.failed !== undefined) throw this.post.failed;
  }

  /** A pool's process, once, or `participantMultiplicity/@maximum` times when its participant carries one: the
   * instances start in order, up to `concurrency` of them walking at once (one after another by default), each on a
   * token of its own and with values of its own over the study's (`Values.forInstance`). The first that fails ends the
   * pool once the instances walking have stopped, and no further instance starts. */
  private async runPool(pool: string): Promise<void> {
    const { graph } = this;
    const { participant, instances: drawn } = graph.instancesOf(pool);
    const instances = this.oneInstance ? 1 : drawn;
    const entries = graph.entriesOf(pool);
    const thread = (instance: number): Thread => ({ pool, path: '', depth: 0, watching: [], cancels: [], heard: new Map(), participant: this.oneInstance ? this.participant : instance, visits: new Map() });
    const walkInstance = async (instance: number): Promise<void> => {
      const own = thread(instance);
      const values = instances > 1 ? this.memory.forInstance(pool) : undefined;
      if (values) {
        this.instances.set(`${pool}#${instance}`, values);
        // Which instance this is, for whatever runs inside: `state._meta.instance.<pool id>`, 1-based.
        values.instance(participant, instance);
        values.startScope(pool, true, this.note(own));
      }
      try {
        for (const entry of entries) await this.host.moved?.(entry.id, undefined, pool);
        await this.walk(entries, 0, own);
      } finally {
        this.instances.delete(`${pool}#${instance}`);
      }
    };
    let next = 1;
    const failures: unknown[] = [];
    // Each lane takes the next instance not yet started, until none is left or one has failed.
    const lane = async (): Promise<void> => {
      while (next <= instances && failures.length === 0 && this.post.failed === undefined) {
        const instance = next;
        next += 1;
        try {
          await walkInstance(instance);
        } catch (error) {
          failures.push(error);
          this.post.failed ??= error; // the instances still walking notice at their next wait
          this.post.notify();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, instances) }, lane));
    if (failures.length > 0) throw failures[0];
    // The pool is one sender: a flow out of its participant to a step in another pool ("All subjects complete")
    // carries null once, when every instance has ended. A flow to another participant is the pool's talk instead,
    // which the steps inside exchange along, instance by instance.
    for (const flow of graph.flowsOut.get(participant) ?? []) {
      if (!graph.participants.has(flow.attributes.targetRef)) await this.post.send(flow, null, thread(instances));
    }
  }

  /**
   * A scope (a pool's process, a sub-process, a called process) walked one level in, a path from each of `entries`,
   * until no path is left in it. Values are not scoped with it (BPMN §10.4.7). A split starts a path for each branch
   * it takes; a join lets one path on once the paths it waits for have come. A path that fails, or leaves the scope at
   * a boundary event of an activity around it, stops the others, and the scope's walk throws what it met. Inside an
   * ad-hoc sub-process, `completion` is read after each activity.
   */
  private async walk(entries: PlanElement[], depth: number, thread: Thread, completion?: Completion): Promise<void> {
    const scope: Scope = { depth, tasks: [], running: new Set(), joins: new Map(), cancel: new AbortController(), completion };
    // The path walking into the scope waits for the paths inside it: they are its pool's walking paths meanwhile.
    if (thread.path) this.post.leave(thread.pool);
    try {
      for (const entry of entries) this.spawn(scope, entry, { ...thread, cancels: [...thread.cancels, scope.cancel.signal] });
      while (scope.tasks.length > 0) await Promise.all(scope.tasks.splice(0));
    } finally {
      if (thread.path) this.post.enter(thread.pool);
    }
    if (scope.failure !== undefined) throw scope.failure;
    if (thread.cancels.some((signal) => signal.aborted)) throw new Cancelled();
  }

  /** A path from `element`, in its own copy of `thread`: `joined` when it starts at a join its tokens have all come to. */
  private spawn(scope: Scope, element: PlanElement, thread: Thread, joined = false): void {
    const path: Path = { at: element.id, thread: { ...thread, path: `${thread.pool}#${this.paths += 1}`, watching: [...thread.watching] } };
    scope.running.add(path);
    this.post.enter(thread.pool);
    // It starts once the path that split has gone on, so the branches start in the order the flows are drawn.
    scope.tasks.push(Promise.resolve().then(() => this.walkPath(scope, path, element, joined))
      .catch((error) => this.end(scope, error))
      .finally(() => {
        scope.running.delete(path);
        this.post.leave(thread.pool);
        this.settle(scope);
      }));
  }

  /** Ends the scope's other paths: a path failed (`error`), left at a boundary event outside the scope, or ended it at a
   * terminate end event (no `error`). A path a sibling stopped says nothing. */
  private end(scope: Scope, error?: unknown): void {
    if (error instanceof Cancelled) return;
    if (scope.cancel.signal.aborted) return;
    if (error !== undefined) scope.failure = error;
    scope.cancel.abort();
    this.post.notify();
  }

  /** A token comes to a join: whether its path goes on. A parallel join lets the last of the tokens it joins on, an
   * inclusive one the last that can come, once no other path of the scope can still reach it. */
  private arrive(scope: Scope, join: PlanElement, path: Path): boolean {
    const waiting = scope.joins.get(join.id) ?? { arrived: 0, thread: path.thread };
    waiting.arrived += 1;
    waiting.thread = path.thread;
    const needed = (this.graph.incoming.get(join.id) ?? []).length;
    const done = join.type === 'parallelGateway'
      ? waiting.arrived >= needed
      : ![...scope.running].some((other) => other !== path && this.graph.reaches(other.at, join.id));
    if (!done) {
      scope.joins.set(join.id, waiting);
      return false;
    }
    if (join.type === 'parallelGateway' && waiting.arrived > needed) {
      waiting.arrived -= needed;
      scope.joins.set(join.id, waiting);
    } else {
      scope.joins.delete(join.id);
    }
    return true;
  }

  /** After a path moved or ended: an inclusive join no path can reach any more lets its tokens on, and a parallel join
   * some of whose tokens can no longer come stops the scope. */
  private settle(scope: Scope): void {
    if (scope.cancel.signal.aborted) return;
    for (const [id, waiting] of [...scope.joins]) {
      if ([...scope.running].some((path) => this.graph.reaches(path.at, id))) continue;
      const join = this.graph.elements[id];
      scope.joins.delete(id);
      if (join.type === 'inclusiveGateway') {
        this.spawn(scope, join, waiting.thread, true);
      } else {
        const needed = (this.graph.incoming.get(id) ?? []).length;
        this.end(scope, new Error(`${id}: a parallel join waits for a token along each of its ${needed} flows, and only ${waiting.arrived} can come`));
      }
    }
  }

  /** One path of a scope, from `first` until it ends, waits at a join, or meets what ends the scope. */
  private async walkPath(scope: Scope, path: Path, first: PlanElement, joined: boolean): Promise<void> {
    const { graph, host } = this;
    const { depth } = scope;
    const thread = path.thread;
    thread.depth = depth;
    let steps = 0;
    let arriving = !joined;
    let element: PlanElement | undefined = first;
    while (element) {
      steps += 1;
      if (steps > this.maxSteps) throw new Error('step budget exhausted — is the flow cycling without an exit?');
      const { id, type } = element;
      path.at = id;
      if (scope.joins.size > 0) this.settle(scope);
      if (arriving) {
        this.valuesOf(thread).trace.push(id);
        this.valuesOf(thread).count(id);
        // An event's properties live for one visit, an activity's for one pass (`perform`).
        if (graph.properties.has(id) && (type === 'endEvent' || PASSTHROUGH_TYPES.has(type))) this.valuesOf(thread).startScope(id, true, this.note(thread));
      }
      this.post.checkInterrupt(thread);
      if (arriving && graph.joins(element) && !this.arrive(scope, element, path)) {
        this.log(thread, 'gateway.waiting', `◇ ${id}  (waiting for the paths it joins)`, { level: 'debug' });
        return;
      }
      arriving = true;
      const name = graph.nameOf(id);

      if (type === 'endEvent') {
        const entry = this.steps.begin(id, name, bpmnType(element));
        try {
          // A runner may claim the end too: its chance to fold what it started for the study.
          if (host.claim(id)) await this.executeViaRunner(element, entry, thread);
          await this.post.throwFrom(element, thread);
        } catch (error) {
          this.stopped(id, entry, error, thread, 'event');
        }
        this.steps.end(entry);
        this.record({ event: 'executed', id, entry }, thread);
        this.log(thread, 'event.reached', `● ${id}`);
        host.passed?.(id);
        // An error end event throws its error out to the innermost activity around it whose error boundary event
        // catches it, ending every path of each scope it leaves. One nothing catches ends its own path, as BPMN
        // leaves an uncaught error to the engine.
        const caught = has(element, 'errorEventDefinition') ? this.catcher(thread, { ref: element.errorRef }) : undefined;
        if (caught) throw new Interrupted(caught.activity, caught.boundary);
        // A terminate end event ends every path of its scope; any other ends its own.
        if (has(element, 'terminateEventDefinition')) this.end(scope);
        return;
      }
      if (type === 'complexGateway' && (graph.outgoing.get(id) ?? []).length > 1) {
        // Taking one flow would walk it as an exclusive gateway, which it is not.
        throw new Error(`${id}: a complex gateway goes by an activation rule the walk does not read. `
          + 'Make it an exclusive, inclusive or parallel gateway.');
      }
      let from: PlanElement = element;
      const condition = conditionOf(element);
      if (GATEWAY_TYPES.has(type) || type === 'parallelGateway') {
        this.log(thread, 'gateway.reached', `◇ ${id}`);
      } else if (type === 'boundaryEvent') {
        // A path from a boundary event that does not interrupt its activity: the event has happened.
        this.record({ event: 'executed', id }, thread);
        await host.moved?.(id, undefined, thread.pool);
        this.log(thread, 'event.reached', `○ ${id}  (beside ${element.attributes.attachedToRef})`);
      } else if (PASSTHROUGH_TYPES.has(type)) {
        const entry = this.steps.begin(id, name, bpmnType(element));
        const runner = host.claim(id);
        try {
          if (this.fired.delete(`${thread.path} ${id}`)) {
            // An event-based gateway took this branch because its timer ran out or its condition held.
            this.log(thread, 'event.waiting', `◐ ${id}  (happened at the gateway)`, { level: 'debug' });
          } else if (runner) {
            // An event a runner executes waits in its runner: a catch event until sensed, a start until it may begin.
            this.log(thread, 'event.waiting', `◐ ${id}  (waiting via ${runner.name})`);
            this.adopt(id, await this.handOff(id, this.valuesOf(thread).json(), thread), entry, thread);
            // The values it recorded meanwhile (a rest's resting state) go out along its data outputs.
            this.noteOutputs(element, entry, thread);
          } else if (graph.flowsIn.has(id)) {
            // A catch event a message flow reaches waits for that message; its content is the result.
            this.log(thread, 'event.waiting', `◐ ${id}  (waiting for a message)`);
            this.valuesOf(thread).store(id, (await this.post.receive(id, graph.flowsIn.get(id)!, thread)).content);
          } else if (element.timer) {
            // A timer event waits for its time: a duration from now, or a date.
            const ms = this.timerMs(element, thread);
            this.log(thread, 'event.waiting', `◐ ${id}  (waiting ${ms}ms for its timer)`);
            await this.post.sleep(ms, id, thread);
          } else if (condition && !this.host.choose && !this.passes(element, condition, thread)) {
            // A conditional event waits until its condition holds, read again each time a value changes; exploring,
            // and in a dry run, where nothing binds what it reads, it passes.
            this.log(thread, 'event.waiting', `◐ ${id}  (waiting until ${condition.body} holds)`);
            const at = element;
            await this.post.until(id, () => this.holds(at, condition, thread), thread, `${id} waits until ${condition.body} holds`);
          }
          await this.post.throwFrom(element, thread);
        } catch (error) {
          this.stopped(id, entry, error, thread, 'event');
        }
        this.steps.end(entry);
        this.record({ event: 'executed', id, entry }, thread);
        this.log(thread, 'event.reached', `○ ${id}`);
      } else {
        // Once an ad-hoc sub-process's completion condition has held, what still runs inside it starts nothing new.
        if (scope.completion?.held) {
          this.log(thread, 'activity.skipped', `    ${id} does not start: the sub-process around it is complete`, { level: 'debug' });
          return;
        }
        const boundary = await this.perform(element, scope, thread);
        if (boundary) {
          // The activity ended at one of its boundary events: the walk goes on from there.
          this.valuesOf(thread).trace.push(boundary.id);
          this.valuesOf(thread).count(boundary.id);
          this.record({ event: 'executed', id: boundary.id }, thread);
          await host.moved?.(boundary.id, undefined, thread.pool);
          this.log(thread, 'event.reached', `○ ${boundary.id}  (ended ${id})`);
          from = boundary;
        } else if (scope.completion && !scope.completion.held && scope.completion.holds()) {
          // An activity of an ad-hoc sub-process ended and its completion condition holds: the sub-process is complete.
          scope.completion.held = true;
          this.log(thread, 'activity.completed', `    the completion condition holds after ${id}`);
          if (scope.completion.cancel) {
            this.end(scope);
            return;
          }
        }
      }
      // After `next`, so a gateway's decision is in its record entry too.
      const following = await this.next(from, thread);
      if (from === element) host.passed?.(id);
      // A split: each branch past the first is a path of its own.
      for (const branch of following.slice(1)) this.spawn(scope, branch, thread);
      element = following[0];
    }
  }

  // --- activities ---

  /**
   * An activity, pass after pass while its loop marker asks for another, or once per item of the list its
   * multi-instance marker names, until that marker's `completionCondition` holds: each such pass binds its item under
   * the `inputDataItem`'s name in the activity's own scope, and what that scope holds under the `outputDataItem`'s
   * name after the pass joins the list stored into `loopDataOutputRef`. A call activity walks the process it calls.
   *
   * Its boundary events are watched while it runs ({@link watch}): one that interrupts it ends it, stopping every
   * hand-off inside it, and is returned for the walk to go on from; one that does not starts a path beside it. Once it
   * is done, a conditional boundary event whose condition now holds is taken too.
   */
  private async perform(element: PlanElement, scope: Scope, thread: Thread): Promise<PlanElement | undefined> {
    const { graph } = this;
    const { id } = element;
    const { depth } = scope;
    const watched = this.watch(element, scope, thread);
    try {
      let passes = 0;
      const listed = this.host.choose ? undefined : this.loopList(element, thread);
      const outputs: unknown[] = [];
      const completion = element.loop?.kind === 'multiInstance' && !this.host.choose ? element.loop.completion : null;
      while (listed ? passes < listed.items.length : this.loopsAgain(element, passes, thread)) {
        // A boundary event that happened before this pass ends the activity here.
        this.post.checkInterrupt(thread);
        passes += 1;
        if (passes > this.maxSteps) throw new Error(`${id}: loop budget exhausted — does its loop ever end?`);
        // Which pass this is, for whatever runs inside: `state._meta.instance.<id>`, 1-based.
        if (element.loop) this.valuesOf(thread).instance(id, passes);
        // A task's properties start each pass again, as a sub-process's do (`walkContainer`).
        if (!CONTAINER_TYPES.has(element.type) && graph.properties.has(id)) this.valuesOf(thread).startScope(id, true, this.note(thread));
        if (listed) {
          // The pass's item in the activity's own scope, `{C}` to the steps inside, and no output yet.
          if (listed.item) this.valuesOf(thread).set(id, listed.item, listed.items[passes - 1]);
          if (listed.output && listed.output in (this.valuesOf(thread).state[id] ?? {})) this.valuesOf(thread).set(id, listed.output);
        }
        const called = graph.callee(element);
        if (CONTAINER_TYPES.has(element.type) || called) await this.walkContainer(element, depth, thread, called);
        else await this.runActivity(element, thread);
        if (listed) outputs.push(listed.output ? this.valuesOf(thread).state[id]?.[listed.output] ?? null : null);
        if (completion && this.completes(element, completion, passes, listed?.items.length, thread)) break;
      }
      if (listed?.into) {
        this.valuesOf(thread).store(listed.into, outputs);
        this.host.reuse?.remade(listed.into); // re-made each run, so a recorded step that reads it runs again
      }
      // The activity is done: an event at its boundary from now on no longer concerns it, and one that happened by now does.
      watched.close();
      this.post.checkInterrupt(thread, true);
    } catch (error) {
      if (error instanceof Interrupted && error.activity === id) {
        // A message that answers the activity along its own flows now answers nothing it still asks, so it is
        // discarded; the message the event caught, if one did, is its value.
        this.post.discard(id);
        if (error.caught) this.valuesOf(thread).store(error.boundary.id, error.caught.content);
        return error.boundary;
      }
      throw error;
    } finally {
      watched.close();
      thread.watching.pop();
    }
    return this.conditionalBoundary(element, scope, thread);
  }

  /**
   * Watches an activity's boundary events while it runs, from the moment it is entered: a timer that runs out,
   * a message that comes, taken as it comes whatever the activity is doing. An interrupting event is due at once and
   * stops every hand-off inside the activity, which then ends at it; one that does not interrupt (`cancelActivity`
   * false) starts a path from the event beside the activity each time it happens, a timer cycle at each firing up to
   * its repetitions, the message it caught its value. `close` ends the watch.
   */
  private watch(element: PlanElement, scope: Scope, thread: Thread): { close(): void } {
    const { graph } = this;
    const boundaries = graph.boundaries.get(element.id) ?? [];
    const outside: Thread = { ...thread, watching: [...thread.watching] };
    const watched: Thread['watching'][number] = {
      activity: element.id,
      flows: new Map(boundaries.filter(interrupts)
        .flatMap((boundary) => (graph.flowsIn.get(boundary.id) ?? []).map((flow): [string, PlanElement] => [flow.id, boundary]))),
      due: [],
      stop: new AbortController(),
    };
    thread.watching.push(watched);
    const closed = new AbortController();
    const happened = (boundary: PlanElement, message?: Message): void => {
      if (!interrupts(boundary)) {
        this.beside(scope, boundary, outside, message);
      } else if (watched.due.length === 0) {
        watched.due.push({ boundary, message });
        watched.stop.abort();
        this.post.notify(); // every wait inside the activity wakes to leave it
      }
    };
    const timers: AbortController[] = [];
    const arm = (boundary: PlanElement, fired: number): void => {
      timers.push(this.post.timer(this.timerMs(boundary, thread), boundary.id, () => {
        happened(boundary);
        // Exploring, one firing shows what a cycle does.
        const cycle = interrupts(boundary) || this.host.choose ? undefined : cycleOf(boundary.timer!);
        if (cycle && !closed.signal.aborted && fired + 1 < cycle.repeats) arm(boundary, fired + 1);
      }));
    };
    for (const boundary of boundaries) if (boundary.timer) arm(boundary, 0);
    const heard = boundaries.map((boundary) => ({ boundary, into: graph.flowsIn.get(boundary.id) ?? [] })).filter(({ into }) => into.length > 0);
    const listen = (): void => {
      for (const { boundary, into } of heard) {
        if (interrupts(boundary) && watched.due.length > 0) continue;
        for (let message = this.post.take(into, thread); message; message = interrupts(boundary) ? undefined : this.post.take(into, thread)) {
          happened(boundary, message);
        }
      }
    };
    if (heard.length > 0) {
      listen();
      void (async () => {
        while (!closed.signal.aborted) {
          await this.post.changed(closed.signal);
          if (!closed.signal.aborted) listen();
        }
      })();
    }
    return {
      close: () => {
        closed.abort();
        timers.forEach((timer) => timer.abort());
      },
    };
  }

  /** A boundary event that does not interrupt its activity happened: a path goes on from it, beside the activity, in
   * the activity's scope, with the message it caught, if one did, as its value. */
  private beside(scope: Scope, boundary: PlanElement, thread: Thread, message?: Message): void {
    if (scope.cancel.signal.aborted) return;
    if (message) this.valuesOf(thread).store(boundary.id, message.content);
    this.spawn(scope, boundary, thread);
  }

  /** Once an activity is done, its conditional boundary events whose `condition` now holds, with the activity's result
   * and bindings already adopted: each that does not interrupt starts a path beside the activity's own flow, and the
   * first that does is returned. Its `{placeholders}` read as FEEL paths, so `unanswered > max_unanswered` reads the
   * property the activity's data edge has just written. */
  private conditionalBoundary(element: PlanElement, scope: Scope, thread: Thread): PlanElement | undefined {
    const conditional = (this.graph.boundaries.get(element.id) ?? []).filter((boundary) => conditionOf(boundary));
    let held: PlanElement[];
    if (this.host.choose && conditional.length > 0) {
      const chosen = this.host.choose(`${element.id}:ends`, ['none', ...conditional.map((boundary) => boundary.id)]);
      held = conditional.filter((boundary) => boundary.id === chosen);
    } else {
      held = conditional.filter((boundary) => {
        const { body, language } = boundary.condition!;
        const verdict = this.valuesOf(thread).evaluate({ body, language }, element.id) === true;
        this.log(thread, 'conditionExpression.evaluated', `    ${body} → ${verdict}  [${boundary.id}]`, { level: 'debug' });
        return verdict;
      });
    }
    for (const boundary of held) if (!interrupts(boundary)) this.beside(scope, boundary, thread);
    return held.find(interrupts);
  }

  /** Whether a multi-instance marker's `completionCondition` holds after `passes` of `total`, BPMN's instance
   * attributes bound beside what the activity's scope holds, its output item among it: `loopCounter`,
   * `numberOfInstances`, `numberOfCompletedInstances`, `numberOfActiveInstances` and `numberOfTerminatedInstances`. */
  private completes(element: PlanElement, completion: Expression, passes: number, total: number | undefined, thread: Thread): boolean {
    const { loop } = element;
    if (loop?.kind !== 'multiInstance') return false;
    const values = this.valuesOf(thread);
    const instances = total ?? (loop.cardinality ? Math.trunc(Number(values.evaluate(loop.cardinality, element.id))) : passes);
    const output = loop.outputItem ? { [loop.outputItem]: values.state[element.id]?.[loop.outputItem] ?? null } : {};
    const verdict = values.evaluate(completion, element.id, {
      ...output, loopCounter: passes, numberOfInstances: instances, numberOfCompletedInstances: passes, numberOfActiveInstances: 0, numberOfTerminatedInstances: 0,
    }) === true;
    this.log(thread, 'conditionExpression.evaluated', `    ${completion.body} → ${verdict}  [${element.id}]`, { level: 'debug' });
    return verdict;
  }

  /** Whether a condition holds now, read at `element`. */
  private holds(element: PlanElement, condition: Expression, thread: Thread): boolean {
    return this.valuesOf(thread).evaluate(condition, element.id) === true;
  }

  /** Whether a conditional event passes now: its condition holds, or, where nothing bound what it reads, a host that
   * decides such things (a dry run) says it does. */
  private passes(element: PlanElement, condition: Expression, thread: Thread): boolean {
    try {
      if (this.holds(element, condition, thread)) return true;
    } catch (error) {
      if (!this.host.decide) throw error;
    }
    return this.host.decide?.(element.id, [element.id], new Error(`${element.id} waits until ${condition.body} holds`)) === element.id;
  }

  /** The list a multi-instance marker runs over when its `loopDataInputRef` names one, read once as the activity starts. */
  private loopList(element: PlanElement, thread: Thread): { items: unknown[]; item: string | null; output: string | null; into: string | null } | undefined {
    const { loop } = element;
    if (loop?.kind !== 'multiInstance' || !loop.input) return undefined;
    const declared = this.graph.propertyScope(loop.input);
    const store = this.graph.storeOf(loop.input);
    let items: unknown;
    if (store) {
      items = this.valuesOf(thread).state[store];
    } else if (declared) {
      const held = this.valuesOf(thread).state[declared.scope] ?? {};
      items = declared.name in held ? held[declared.name] : this.graph.properties.get(declared.scope)!.get(declared.name)!.value;
    } else {
      items = this.valuesOf(thread).held.get(loop.input);
    }
    if (!Array.isArray(items)) throw new Error(`${element.id} runs once per item of ${loop.input}, which holds no list this run`);
    return { items, item: loop.inputItem, output: loop.outputItem, into: loop.output };
  }

  /**
   * Whether an activity takes another pass after `passes`: once without a loop marker; with a standard loop marker,
   * while its `loopCondition` holds (tested first when `testBefore`), up to `loopMaximum`, and with no condition until
   * a boundary event ends it; with a multi-instance marker, `loopCardinality` times, one after another whichever way
   * `isSequential` reads.
   */
  private loopsAgain(element: PlanElement, passes: number, thread: Thread): boolean {
    const { loop } = element;
    if (!loop) return passes === 0;
    if (this.host.choose) {
      if (passes === 0 && !(loop.kind === 'standard' && loop.testBefore)) return true;
      if (loop.kind === 'standard' && loop.maximum && passes >= loop.maximum) return false;
      return this.host.choose(`${element.id}:again`, ['again', 'done']) === 'again';
    }
    if (loop.kind === 'multiInstance') {
      if (!loop.cardinality) return passes === 0;
      return passes < Math.trunc(Number(this.valuesOf(thread).evaluate(loop.cardinality, element.id)));
    }
    if (passes === 0 && !loop.testBefore) return true;
    if (loop.maximum && passes >= loop.maximum) return false;
    if (!loop.condition) return true;
    return this.valuesOf(thread).evaluate(loop.condition, element.id) === true;
  }

  /** A sub-process, walked one level in from its start event, or, with none, from every node nothing flows into; an
   * ad-hoc one round after round ({@link walkAdHoc}); or the process a call activity calls (`called`), in the
   * activity's place, its properties started afresh for each call. With nothing inside, it ends at once. */
  private async walkContainer(element: PlanElement, depth: number, thread: Thread, called?: string): Promise<void> {
    const { graph } = this;
    const { id } = element;
    const entry = this.steps.begin(id, graph.nameOf(id), bpmnType(element));
    this.log(thread, 'activity.started', called ? `⊞ ${id}  (calls ${called})` : `⊞ ${id}`);
    this.valuesOf(thread).startScope(id, true, this.note(thread));
    try {
      if (called) {
        // A process running around this call would call itself without end.
        if (thread.watching.slice(0, -1).some(({ activity }) => graph.callee(graph.get(activity)) === called)) {
          throw new Error(`${id} calls ${called}, which this path is already inside: a process cannot call itself`);
        }
        this.valuesOf(thread).startScope(called, true, this.note(thread));
      }
      const entries = graph.entriesOf(called ?? id);
      if (element.type === 'adHocSubProcess') await this.walkAdHoc(element, entries, depth, thread);
      else await this.enter(entries, depth, thread);
    } catch (error) {
      if (error instanceof Interrupted) {
        entry.interruptedBy = error.boundary.id;
        this.steps.end(entry);
      } else if (error instanceof Cancelled) {
        this.steps.end(entry);
      } else {
        this.steps.fail(entry, error);
      }
      throw error;
    } finally {
      thread.depth = depth;
    }
    this.noteOutputs(element, entry, thread);
    this.steps.end(entry);
    this.log(thread, 'activity.finished', `  ${id} done in ${entry.durationMs}ms`, { level: 'debug' });
    this.record({ event: 'executed', id, entry }, thread);
  }

  /** A scope one level below `depth`, entered at `entries`. */
  private async enter(entries: PlanElement[], depth: number, thread: Thread, completion?: Completion): Promise<void> {
    for (const entry of entries) await this.host.moved?.(entry.id, undefined, thread.pool);
    await this.walk(entries, depth + 1, thread, completion);
  }

  /**
   * An ad-hoc sub-process, whose activities BPMN leaves in no order. Each round starts every node nothing flows into
   * inside it, all at once, or one after another in the order drawn when its `ordering` is Sequential, each going on
   * along its flows (so a gateway after an agent's model call picks the tool it named). Its `completionCondition` is
   * read after each activity inside it ends: once it holds, the sub-process ends, stopping what still runs, or, with
   * `cancelRemainingInstances` false, letting that finish while nothing new starts. A round after which it does not
   * hold starts the next; with no condition, one round ends it.
   */
  private async walkAdHoc(element: PlanElement, entries: PlanElement[], depth: number, thread: Thread): Promise<void> {
    const { completion } = element;
    // Exploring, another round is a choice, as another pass of a loop is.
    const done: Completion | undefined = completion && !this.host.choose
      ? { holds: () => this.holds(element, completion, thread), cancel: element.attributes.cancelRemainingInstances !== 'false', held: false }
      : undefined;
    const groups = element.attributes.ordering === 'Sequential' ? entries.map((entry) => [entry]) : [entries];
    for (let round = 1; ; round += 1) {
      if (round > this.maxSteps) throw new Error(`${element.id}: loop budget exhausted — does its completionCondition ever hold?`);
      for (const group of groups) {
        await this.enter(group, depth, thread, done);
        if (done?.held) return;
      }
      if (!completion) return;
      if (this.host.choose ? this.host.choose(`${element.id}:again`, ['again', 'done']) !== 'again' : done!.holds()) return;
    }
  }

  private async runActivity(element: PlanElement, thread: Thread): Promise<void> {
    const { graph, host } = this;
    const { id } = element;
    // A live element (an interactive runner's) never skips from a prior record.
    const noted: Parameters<Note>[] = [];
    const verdict = host.reuse?.activity(id, this.live.has(id), (...line) => noted.push(line));
    const replay = (): void => noted.forEach(([event, message, detail]) => this.log(thread, event, message, detail));
    if (verdict?.skipped) {
      this.log(thread, 'activity.skipped', `↻ ${id}  (outputs from run ${verdict.run})`);
      replay();
      this.record({ event: 'reused', id, run: verdict.run ?? '' }, thread);
      return;
    }
    this.log(thread, 'activity.started', `□ ${id}`);
    replay();
    if (verdict?.superseded) this.log(thread, 'activity.invalidated', `    ${verdict.superseded}`);
    const entry = this.steps.begin(id, graph.nameOf(id), bpmnType(element));
    try {
      await this.executeActivity(element, entry, thread);
    } catch (error) {
      if (error instanceof Interrupted) entry.interruptedBy = error.boundary.id;
      this.stopped(id, entry, error, thread, 'activity');
    }
    this.steps.end(entry);
    host.reuse?.ran(id);
    this.log(thread, 'activity.finished', `    ${id} done in ${entry.durationMs}ms`, { level: 'debug' });
    this.record({ event: 'executed', id, entry }, thread);
  }

  /** A step, an activity, an event or a gateway, did not finish. One a boundary event ended, or another path
   * stopped, ends there. One that failed throws the error its runner names (`errorCode`), else one of no code: the innermost error
   * boundary event that catches it, on the step or on an activity around it, takes it. Then the record keeps the
   * error, the run is not failed, and the walk goes on from that event, ending each scope it leaves on the way.
   * With nothing to catch it, the failure stands, and so it does once the run is ending: a wait that fails because
   * a pool failed is no error of its step. */
  private stopped(id: string, entry: Entry, error: unknown, thread: Thread, kind: 'activity' | 'event' | 'gateway'): never {
    if (error instanceof Interrupted || error instanceof Cancelled) {
      this.steps.end(entry);
      throw error;
    }
    const caught = this.post.failed === undefined
      ? this.catcher(thread, { code: error instanceof HandoffError ? error.partial?.errorCode : undefined })
      : undefined;
    const { status } = this.steps;
    this.steps.fail(entry, error);
    this.log(thread, `${kind}.failed`, `    ${id}: ${(error as Error)?.name ?? 'Error'}: ${(error as Error)?.message ?? error}`, { level: 'error' });
    this.record({ event: 'failed', id, entry }, thread);
    if (!caught) throw error;
    entry.interruptedBy = caught.boundary.id;
    this.steps.status = status;
    throw new Interrupted(caught.activity, caught.boundary);
  }

  /** The innermost activity a path is inside (the step it performs first) whose error boundary event catches
   * `thrown`, with that event. */
  private catcher(thread: Thread, thrown: Thrown): { activity: string; boundary: PlanElement } | undefined {
    for (const { activity } of [...thread.watching].reverse()) {
      const boundary = (this.graph.boundaries.get(activity) ?? []).find((candidate) => has(candidate, 'errorEventDefinition') && this.catches(candidate, thrown));
      if (boundary) return { activity, boundary };
    }
    return undefined;
  }

  /** Whether an error boundary event catches `thrown`: one naming no error catches every error, one naming an error
   * catches that error and any other of its `errorCode`. A failure no runner gave a code is caught by the first. */
  private catches(boundary: PlanElement, thrown: Thrown): boolean {
    if (!boundary.errorRef || thrown.ref === boundary.errorRef) return true;
    const code = (ref: string | undefined): string | undefined => (ref ? this.graph.elements[ref]?.attributes.errorCode || undefined : undefined);
    const caught = code(boundary.errorRef);
    return caught !== undefined && caught === (thrown.code ?? code(thrown.ref));
  }

  private async executeActivity(element: PlanElement, entry: Entry, thread: Thread): Promise<void> {
    const { graph } = this;
    const { implementation } = element.attributes;
    if (implementation) entry.implementation = implementation;

    // A claimed element is its runner's whole job: the walk executes nothing itself.
    if (this.host.claim(element.id)) return this.executeViaRunner(element, entry, thread);
    const { scope, outgoing, incoming } = graph.exchange(element);
    if (outgoing.length + incoming.length > 0) {
      // Unclaimed, an activity exchanges messages itself: it sends its data inputs along each flow out of it, then
      // takes the next message along a flow into it as its result. A send, a receive, or both: a request.
      for (const flow of outgoing) await this.post.send(flow, this.valuesOf(thread).inputsOf(element), thread, { inReplyTo: this.post.answering(flow, thread), step: element.id });
      if (incoming.length > 0) this.valuesOf(thread).bind(element, (await this.post.receive(scope, incoming, thread)).content);
      return;
    }
    if (implementation) {
      const scheme = implementation.includes('://') ? implementation.split('://', 1)[0] : implementation;
      throw new Error(`no partial runner claims ${element.id} (${implementation}): `
        + `no skill in reach declares ${scheme}:// elements (or a studyflow-${scheme} on PATH)`);
    }
    this.log(thread, 'implementation.missing', '    (no implementation — nothing to call)', { level: 'warning' });
  }

  /** One hand-off: the values in, the updated values out; what the runner bound or changed is adopted here, and what
   * it says it ran with (`record`) joins the step's entry. */
  private async executeViaRunner(element: PlanElement, entry: Entry, thread: Thread): Promise<void> {
    const { graph, host } = this;
    const { id } = element;
    const runner = host.claim(id)!;
    entry.implementation = element.attributes.implementation || `runner://${runner.name}`;
    this.log(thread, 'runner.called', `    → the ${runner.name} runner takes this element`);
    const talking = graph.messageScope(id);
    const talks = graph.flowsIn.has(talking) || graph.flowsOut.has(talking);
    const talk = talks ? this.post.talk(id, talking, thread) : undefined;
    try {
      const handed = await this.handOff(id, this.valuesOf(thread).json(), thread, talk);
      await talk?.delivered(); // what it sent last is answered before the walk goes on
      this.adopt(id, handed, entry, thread);
    } catch (error) {
      // The values a failed hand-off had bound before it failed are kept: the step fails, its work is not lost.
      if (error instanceof HandoffError && error.partial) this.adopt(id, error.partial, entry, thread);
      // A pool it asked could not answer: its hand-off was stopped, and the step fails with the pool's failure.
      const unanswered = error instanceof Interrupted || error instanceof Cancelled ? undefined : talk?.failed();
      throw unanswered ?? error;
    }
    this.noteOutputs(element, entry, thread);
  }

  /** Take what a runner handed back: its record into the step's entry, the properties it wrote into their scopes
   * (`_meta` stays the walk's, and what the Parameters wired into a sub-process set stays as set), the values it
   * bound under their ids, and its result under the element's own. */
  private adopt(id: string, handed: Handback, entry: Entry, thread: Thread): void {
    const memory = this.valuesOf(thread);
    keepRecord(entry, handed);
    for (const [scope, written] of Object.entries(handed.state ?? {})) {
      // A data store is one value, under its own id.
      if (this.graph.storeOf(scope) === scope) {
        memory.setStore(scope, written);
        continue;
      }
      if (scope === '_meta' || !written || typeof written !== 'object') continue;
      const held = (memory.state[scope] ??= {});
      const fixed = [...(this.graph.readonly.get(scope) ?? [])].filter((name) => name in written && JSON.stringify(written[name]) !== JSON.stringify(held[name])).sort();
      if (fixed.length > 0) {
        throw new Error(`${id} writes ${fixed.join(', ')}, which the Parameters wired into ${scope} set, so nothing inside it writes them`);
      }
      for (const [name, value] of Object.entries(written)) memory.set(scope, name, value);
    }
    for (const [key, value] of Object.entries(handed.values ?? {})) memory.store(key, value);
    if (handed.result !== undefined) {
      memory.store(id, handed.result);
      // The properties its data edges target, which its runner left to the walk.
      const element = this.graph.get(id);
      if (element) memory.bindProperties(element, handed.result, new Set(Object.keys(handed.values ?? {})));
    }
  }

  /** One hand-off to the host, which an interrupting boundary event of an activity around it may stop (a timer that
   * runs out, a message that comes), and so may a path that ends its scope: the walk then leaves for that event, or
   * stops, whatever the hand-off had done. A pool it asked that could not answer stops it too. */
  private async handOff(id: string, values: Record<string, unknown>, thread: Thread, talk?: Exchange): Promise<Handback> {
    const handoff = new AbortController();
    const stops = [...thread.watching.map(({ stop }) => stop.signal), ...thread.cancels];
    const abort = (): void => handoff.abort();
    talk?.onFailure(abort);
    for (const signal of stops) {
      if (signal.aborted) handoff.abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    try {
      const attributes = this.valuesOf(thread).resolved(this.graph.get(id)!);
      return await this.host.perform(id, values, { attributes, talk, note: this.note(thread), signal: handoff.signal });
    } finally {
      for (const signal of stops) signal.removeEventListener('abort', abort);
      this.post.checkInterrupt(thread, true);
    }
  }

  /** How long a timer event waits, its `{placeholders}` read from the run's values. */
  private timerMs(element: PlanElement, thread: Thread): number {
    const read = (text: string | undefined): string | undefined =>
      text?.replace(PLACEHOLDER, (_cited, path: string) => String(this.valuesOf(thread).evaluate({ body: path, language: null }, element.id)));
    const { duration, date, cycle } = element.timer!;
    try {
      return timerDelay({ duration: read(duration), date: read(date), cycle: read(cycle) }, this.host.clock?.());
    } catch (error) {
      throw new Error(`${element.id}: ${(error as Error).message}`);
    }
  }

  /** Notes the targets of the activity's data output edges. A sub-process carries its own edges, so a dataset the steps
   * inside it fill is generated by the sub-process. */
  private noteOutputs(element: PlanElement, entry: Entry, thread: Thread): void {
    const targets = element.outputs.map((output) => output.target).filter((target): target is string => !!target);
    if (targets.length > 0) entry.generated = targets;
    this.host.outputs?.(element.id, targets, entry, this.note(thread));
  }

  // --- flows and gateways ---


  /** Take a sequence flow: counted like a visit, so a node is reached as often as its incoming flows are taken. */
  private async follow(flow: PlanElement, thread: Thread): Promise<PlanElement | undefined> {
    this.valuesOf(thread).count(flow.id);
    const target = this.graph.get(flow.attributes.targetRef);
    if (target) await this.host.moved?.(target.id, flow.id, thread.pool);
    return target;
  }

  /** Where the path goes from `element`: one element, or, at a split, the first element of each branch it takes. */
  private async next(element: PlanElement, thread: Thread): Promise<PlanElement[]> {
    const { graph, host } = this;
    const { id } = element;
    const flows = graph.outgoing.get(id) ?? [];
    const along = async (taken: PlanElement[]): Promise<PlanElement[]> => {
      const targets: PlanElement[] = [];
      for (const flow of taken) {
        const target = await this.follow(flow, thread);
        if (target) targets.push(target);
      }
      return targets;
    };
    if (flows.length === 0) return [];
    if (element.type === 'parallelGateway') return along(flows);
    if (!GATEWAY_TYPES.has(element.type)) {
      if (flows.length === 1) return along(flows);
      // Several flows out of an activity or an event: each without a condition is taken, each with one whose condition
      // holds, and the default flow when no condition does.
      const conditional = flows.filter((flow) => flow.condition);
      const held = host.choose
        ? (conditional.length > 0 ? this.chooseFlows(id, conditional, true) : [])
        : conditional.filter((flow) => this.valuesOf(thread).evaluate(flow.condition!, id) === true);
      const bare = flows.filter((flow) => !flow.condition && flow.id !== element.attributes.default);
      const fallback = held.length === 0 ? flows.filter((flow) => flow.id === element.attributes.default) : [];
      return along([...bare, ...held, ...fallback]);
    }

    // A clean gateway replays its recorded decision: same inputs, same seed, same verdict. A gateway a live runner
    // samples decides live, so its decision never replays; an inclusive one decides again each time.
    const prior = this.live.has(id) || element.type === 'inclusiveGateway' ? undefined : host.reuse?.decision(id);
    const replayed = prior && flows.find((flow) => flow.id === prior.flow);
    if (prior && replayed) {
      this.log(thread, 'gateway.replayed', `↻ ${id} → ${prior.flow}  (decision from run ${prior.run})`);
      this.record({ event: 'reused', id, run: prior.run, flow: prior.flow }, thread);
      return along([replayed]);
    }
    const entry = this.steps.begin(id, graph.nameOf(id), bpmnType(element));

    /** Record the decision and how it was made, then follow the flows taken. */
    const take = (taken: PlanElement[], how: string, marks: Record<string, unknown> = {}): Promise<PlanElement[]> => {
      entry.taken = taken.length === 1
        ? { sequenceFlow: taken[0].id, name: taken[0].name, how, ...marks }
        : { sequenceFlows: taken.map((flow) => flow.id), how, ...marks };
      this.steps.end(entry);
      this.log(thread, 'sequenceFlow.taken', `    ${how} → ${taken.map((flow) => flow.id).join(', ')}`);
      this.record({ event: 'executed', id, ...(taken.length === 1 ? { flow: taken[0].id } : {}), entry }, thread);
      return along(taken);
    };

    if (element.type === 'eventBasedGateway') {
      try {
        let branches = flows.map((flow) => this.branchOf(id, flow, thread));
        const at = (branch: Branch): Promise<PlanElement[]> => {
          // The branch's timer ran out or its condition held: its event has happened, and the path passes it.
          this.fired.add(`${thread.path} ${branch.at}`);
          return take([branch.flow], branch.ms === undefined ? 'condition' : 'timer', branch.ms === undefined ? { condition: true } : { timer: true });
        };
        // Exploring, a timer or a condition comes first, or the first message does.
        const quick = branches.filter((branch) => !branch.into);
        if (host.choose && quick.length > 0) {
          const chosen = host.choose(id, [...quick.map((branch) => branch.flow.id), ...(quick.length < branches.length ? ['message'] : [])]);
          const branch = quick.find((candidate) => candidate.flow.id === chosen);
          if (branch) return await at(branch);
          branches = branches.filter((candidate) => candidate.into);
        }
        this.log(thread, 'event.waiting', `    (waiting for the first event along ${flows.length} branches)`);
        const { flow, fired } = await this.post.race(id, branches, thread);
        if (fired) return await at(branches.find((branch) => branch.flow === flow)!);
        return await take([flow], 'first message', { message: true });
      } catch (error) {
        this.stopped(id, entry, error, thread, 'gateway');
      }
    }

    if (host.choose && flows.length > 1) {
      if (element.type === 'inclusiveGateway') {
        // Any set of its conditions may hold; none too, when a flow without a condition, or the default, is then taken.
        const conditional = flows.filter((flow) => flow.condition);
        const held = conditional.length > 0 ? this.chooseFlows(id, conditional, conditional.length < flows.length) : [];
        return take(inclusiveTaken(flows, held, element.attributes.default), 'chosen');
      }
      const chosen = host.choose(id, flows.map((flow) => flow.id));
      return take([flows.find((flow) => flow.id === chosen) ?? flows[0]], 'chosen');
    }

    const allocation = this.allocations.get(id);
    if (allocation) {
      // A participant's draw is its own: the seed, the gateway, which instance of the pool this is, and which of its
      // visits. So a participant draws the same in any runtime and on any re-run, whatever the others drew. Blocks and
      // alternation deal by its place in a sequence; strata and minimization by the participants before it as well.
      const visit = (thread.visits.get(id) ?? 0) + 1;
      thread.visits.set(id, visit);
      const seed = this.concealed.get(id) ?? this.seed;
      const u = (): number => (seed === undefined ? Math.random() : draw(seed, id, thread.participant, visit));
      // The sequence the gateway deals along, and this participant's place n in it: the participants, in the order they
      // arrive at the gateway, so one that left before it (excluded at screening) takes no place and those allocated
      // fill whole blocks; a gateway a participant passes again (along a cycle) deals each visit along a sequence of its
      // own; inside a loop, one participant's visits. A session of one participant (a browser's) sees no arrival but its
      // own, so its participant number stands in: its place when every participant before it reached the gateway.
      const visits = this.alongVisits(id);
      const along = visits ? `${id}#${thread.participant}` : `${id}@${visit}`;
      const dealt = this.dealt.get(along) ?? [];
      this.dealt.set(along, dealt);
      let [sequence, n] = [along, visits ? visit : this.oneInstance ? thread.participant : dealt.length + 1];
      // The participant's level of each factor it is stratified or minimized on, as it has them on reaching the gateway.
      let levels: string[];
      try {
        levels = allocation.factors.map((factor) => this.levelOf(factor, element, thread));
      } catch (error) {
        const chosen = host.decide?.(id, flows.map((flow) => flow.id), error as Error);
        const decided = flows.find((flow) => flow.id === chosen);
        if (decided) return take([decided], 'decided by the host');
        this.stopped(id, entry, error, thread, 'gateway');
      }
      if (levels.length > 0 && allocation.algorithm !== 'minimization') {
        // Within strata: the k-th participant of a stratum takes place k of the stratum's own sequence.
        n = dealt.filter((past) => past.levels.every((level, f) => level === levels[f])).length + 1;
        sequence = `${along}/${allocation.factors.map((factor, f) => `${factor}=${levels[f]}`).join(',')}`;
      }
      let arm: number;
      if (allocation.algorithm === 'block') {
        // Place n sits at (n - 1) % size in block (n - 1) // size.
        const block = Math.floor((n - 1) / allocation.size);
        const key = `${sequence}:${block}`;
        if (!this.blocks.has(key)) this.blocks.set(key, permutedBlock(seed, sequence, block, allocation.weights, allocation.size));
        arm = this.blocks.get(key)![(n - 1) % allocation.size];
      } else if (allocation.algorithm === 'alternation') {
        arm = alternated(n, allocation.weights);
      } else if (allocation.algorithm === 'minimization') {
        // How many before it, at its level of each factor, took each arm.
        const counts = levels.map((level, f) => allocation.weights.map((_weight, a) => dealt.filter((past) => past.levels[f] === level && past.arm === a).length));
        arm = minimized(counts, u());
      } else {
        arm = pick(u(), allocation.weights);
      }
      dealt.push({ levels, arm });
      // Which participant drew, and its place in the sequence: with instances walking at once, the order they arrive
      // in is the run's, so the record keeps it.
      return take([flows[arm]], 'drawn', { random: true, participant: thread.participant, place: n });
    }

    const held: PlanElement[] = [];
    try {
      let bindings: Record<string, unknown> = {};
      const runner = host.claim(id);
      if (runner) {
        // The runner samples what the conditions read (`face_count`).
        this.log(thread, 'runner.called', `    ${runner.name} samples for ${id}`);
        const sampled = await this.handOff(id, this.valuesOf(thread).json(), thread);
        keepRecord(entry, sampled);
        bindings = (sampled.result as Record<string, unknown>) || {};
        if (Object.keys(bindings).length > 0) entry.bindings = bindings;
      }
      for (const flow of flows) {
        if (!flow.condition) continue;
        const verdict = this.valuesOf(thread).evaluate(flow.condition, id, bindings);
        ((entry.conditionExpressions ??= []) as unknown[]).push({
          sequenceFlow: flow.id, conditionExpression: flow.condition.body, held: verdict === true,
        });
        this.log(thread, 'conditionExpression.evaluated', `    ${flow.condition.body} → ${verdict === true}  [${flow.id}]`, { level: 'debug' });
        if (verdict !== true) continue;
        // An exclusive gateway takes the first flow whose condition holds; an inclusive one, every one.
        if (element.type !== 'inclusiveGateway') return take([flow], flow.condition.body);
        held.push(flow);
      }
    } catch (error) {
      const chosen = host.decide?.(id, flows.map((flow) => flow.id), error as Error);
      const decided = flows.find((flow) => flow.id === chosen);
      if (decided) return take([decided], 'decided by the host');
      this.stopped(id, entry, error, thread, 'gateway');
    }
    if (element.type === 'inclusiveGateway') {
      const taken = inclusiveTaken(flows, held, element.attributes.default);
      const how = taken.map((flow) => flow.condition?.body ?? (flow.id === element.attributes.default ? 'default' : 'no condition'));
      if (taken.length > 0) return take(taken, how.join('; '), how.includes('default') ? { default: true } : {});
    } else {
      // No condition held: the default flow, else the one flow without a condition.
      const chosen = flows.find((flow) => flow.id === element.attributes.default);
      if (chosen) return take([chosen], 'default', { default: true });
      const bare = flows.filter((flow) => !flow.condition);
      if (bare.length === 1) return take(bare, 'otherwise', { otherwise: true });
    }
    const dead = new Error(`${id}: no condition held, and there is no default flow or single flow without a condition`);
    // With no flow to take the gateway has failed, and an error boundary event around it catches that as any failure.
    if (this.post.failed === undefined && this.catcher(thread, {})) this.stopped(id, entry, dead, thread, 'gateway');
    entry.status = 'stuck';
    this.steps.end(entry);
    this.steps.status = 'error';
    throw dead;
  }

  /** An event-based gateway's branch as its race reads it: the event it starts at, and what makes that event happen,
   * a message along a flow into it, its timer, or its condition. A branch none of them can start stops the run. */
  private branchOf(gateway: string, flow: PlanElement, thread: Thread): Branch {
    const target = this.graph.get(flow.attributes.targetRef);
    const at = target?.id ?? flow.attributes.targetRef ?? '';
    const into = this.graph.flowsIn.get(at);
    if (into?.length) return { flow, at, into };
    if (target?.timer) return { flow, at, ms: this.timerMs(target, thread) };
    const condition = target ? conditionOf(target) : undefined;
    if (target && condition) return { flow, at, holds: () => this.passes(target, condition, thread) };
    throw new Error(`${gateway}: an event-based gateway waits for the first event of its branches, and ${at} has none to wait for. `
      + 'Start each branch with a catch event or a receive task a message flow reaches, a timer catch event, or a conditional catch event.');
  }

  /** Whether a gateway deals along one participant's visits, inside a loop, rather than along the participants. */
  private alongVisits(id: string): boolean {
    return this.graph.scopeChain(id).some((scope) => this.graph.elements[scope]?.loop);
  }

  /** A participant's level of a factor its gateway stratifies or minimizes on: what `{factor}` cites at the gateway. */
  private levelOf(factor: string, gateway: PlanElement, thread: Thread): string {
    const value = this.valuesOf(thread).cite(factor, gateway.id);
    if (value === undefined) {
      throw new Error(`'${gateway.name || gateway.id}' balances its arms on '${factor}', which participant ${thread.participant} `
        + 'does not have on reaching it: a step before the gateway (a screening) writes it.');
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  /** The flows an exploring host picks at a split that takes each whose condition holds: any one or more of them, or
   * (`none`) none, for the default to take. */
  private chooseFlows(id: string, flows: PlanElement[], none: boolean): PlanElement[] {
    const options = subsets(flows).map((taken) => taken.map((flow) => flow.id).join('+'));
    const chosen = this.host.choose!(id, none ? ['none', ...options] : options);
    return chosen === 'none' ? [] : flows.filter((flow) => chosen.split('+').includes(flow.id));
  }

  /** The values a path reads and writes: its pool instance's, or the study's. */
  private valuesOf(thread: Thread): Values {
    return this.instances.get(`${thread.pool}#${thread.participant}`) ?? this.memory;
  }

  /** The participant a path walks for, as the record names it, `<pool>#<instance>`: one instance of a pool of several,
   * while it walks. A pool of one, and the pool's own message once its instances have ended, name none. */
  private participantOf(thread: Thread): string | undefined {
    if (!this.instances.has(`${thread.pool}#${thread.participant}`)) return undefined;
    return `${this.graph.instancesOf(thread.pool).participant}#${thread.participant}`;
  }

  private log(thread: Thread, event: string, message: string, detail?: Parameters<Note>[2]): void {
    logAt(this.host, thread, event, message, detail);
  }

  /** The log, at the depth a pool's walk is at. */
  private note(thread: Thread): Note {
    return (event, message, detail) => this.log(thread, event, message, detail);
  }

  /** Ends the run from outside (the person stopped it): every wait fails, and each pool stops at its next step. */
  abort(reason: Error): void {
    this.post.failed ??= reason;
    this.post.notify();
  }

  // --- what a host reads and writes of the run's values ---

  /** The flows whose messages were sent this run and never taken. */
  untaken(): string[] {
    return this.post.untaken();
  }

  /** The `state` tree: `state.<scope>.<property>`, and `state._meta`, the walk's own. */
  get state(): StateTree {
    return this.memory.state;
  }

  /** The value each element produced this run, by id. */
  get values(): ReadonlyMap<string, unknown> {
    return this.memory.held;
  }

  /** The JSON-able shadow of the run's values, with the state tree under `state`: what a runner is handed. */
  jsonValues(): Record<string, unknown> {
    return this.memory.json();
  }

  /** A value under an element's id, or under a name no scope declares. */
  store(id: string, value: unknown): void {
    this.memory.store(id, value);
  }

  /** A value under `name` in `scope`, declared there or not: what a host keeps that no scope declares. */
  set(scope: string, name: string, value: unknown): void {
    this.memory.set(scope, name, value);
  }

  /** A value under a property's name, into the innermost scope around `from` that declares it; that scope, if any. */
  write(name: string, value: unknown, from: string): string | undefined {
    return this.memory.write(name, value, from);
  }

  /** The properties in scope of an element, by name. */
  inScope(id: string): Record<string, unknown> {
    return this.memory.inScope(id);
  }
}

/** The first segment of every `{placeholder}` the elements write, in their names, attributes, arguments, extensions
 * and conditions: the names a study cites. */
function citedNames(elements: PlanElement[]): Set<string> {
  const cited = new Set<string>();
  const read = (text: unknown): void => {
    for (const value of Array.isArray(text) ? text : [text]) {
      if (typeof value !== 'string') continue;
      for (const match of value.matchAll(PLACEHOLDER)) cited.add(match[1].split('.')[0]);
    }
  };
  for (const element of elements) {
    read(element.name);
    Object.values(element.attributes).forEach(read);
    read(element.additionalArguments);
    for (const extension of element.extensions) Object.values(extension.attributes).forEach(read);
    read(element.condition?.body);
  }
  return cited;
}
