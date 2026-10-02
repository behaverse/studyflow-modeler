import { PLACEHOLDER } from '@core/model/state';
import { allocationOf, draw, permutedBlock, pick, withoutConcealedSeed, type Allocation } from '@core/engine/allocation';
import { CONTAINER_TYPES, GATEWAY_TYPES, Graph, PASSTHROUGH_TYPES } from '@core/engine/graph';
import { Cancelled, HandoffError, Interrupted, keepRecord, logAt, type Handback, type Host, type Note, type StateTree, type Talk, type Thread, type WalkOptions } from '@core/engine/host';
import type { Plan, PlanElement } from '@core/engine/plan';
import type { Happening, RunEvent } from '@core/engine/record';
import { Post } from '@core/engine/post';
import { Steps, type Entry } from '@core/engine/steps';
import { timerDelay } from '@core/engine/timer';
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

/** A path walking a scope: the token, and the element it is at. */
type Path = { at: string; thread: Thread };

/** The paths a scope's walk runs, the tokens waiting at its joins, and what ends them all. */
type Scope = {
  depth: number;
  tasks: Promise<void>[];
  running: Set<Path>;
  /** The tokens that have come to each join and wait there, with the path the last came along. */
  joins: Map<string, { arrived: number; thread: Thread }>;
  cancel: AbortController;
  /** What ended the scope, a path's failure or a boundary event outside it: the scope's walk throws it. */
  failure?: unknown;
};

/** Every non-empty subset of `items`, smallest first: what an inclusive split may take. */
function subsets<T>(items: T[]): T[][] {
  const all: T[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask += 1) all.push(items.filter((_item, i) => mask & (1 << i)));
  return all.sort((a, b) => a.length - b.length);
}

export class Walk {
  readonly graph: Graph;
  readonly steps = new Steps();
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
  private readonly blocks = new Map<string, number[]>();
  private readonly memory: Values;
  private readonly post: Post;
  /** Tells the host what happened: the run's record. */
  private readonly record: (happened: Happening) => void;
  private early: RunEvent[] | undefined = [];
  private paths = 0;

  constructor(plan: Plan, host: Host, options: WalkOptions = {}) {
    this.host = host;
    this.graph = new Graph(plan);
    // What happens goes to the host as it happens: the run's record (packages/core/src/engine/record.ts). What happens
    // before the run begins waits for it, so the record starts where the host says the run started.
    const record = this.record = (happened: Happening): void => {
      const event = { ...happened, at: host.now() } as RunEvent;
      if (this.early) this.early.push(event);
      else host.record?.(event);
    };
    this.memory = new Values(this.graph, options.state ?? {}, record);
    this.post = new Post(this.graph, host, this.steps, this.memory, record);
    this.maxSteps = options.maxSteps ?? 1000;
    this.oneInstance = options.oneInstance ?? false;
    this.participant = options.participant ?? 1;
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
    // Study-scoped properties persist across runs, so only ones the tree lacks take their `value`; a plain element's
    // properties live with the study (`Excluded (n={count})` counts across runs).
    for (const scope of graph.properties.keys()) {
      if (!CONTAINER_TYPES.has(graph.elements[scope]?.type ?? 'process')) this.memory.startScope(scope, false, this.note({ pool: '', path: '', depth: 0, watching: [], cancels: [], heard: new Map(), participant: 1, visits: new Map() }));
    }
  }

  // --- the run ---

  async run(): Promise<void> {
    const { graph, host } = this;
    // What happened before the run began goes to the record now, after the host's `started`.
    const early = this.early ?? [];
    this.early = undefined;
    for (const happened of early) host.record?.(happened);
    const ambiguous = new Set(Object.values(graph.elements)
      .filter((element) => graph.walked.has(element.id) && element.name && /^[A-Za-z_]\w*$/.test(element.name) && !graph.plan.names[element.id])
      .map((element) => element.name!));
    for (const name of [...ambiguous].sort()) {
      host.log('name.ambiguous', `  ${name} names more than one element, or is also an id: \`{${name}.…}\` cites nothing until it is unique`, { level: 'warning' });
    }
    for (const { unapplied } of this.allocations.values()) {
      if (unapplied) host.log('allocation.unapplied', `  ${unapplied}`, { level: 'warning' });
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
   * instances run one after another, as a multi-instance activity's passes do. */
  private async runPool(pool: string): Promise<void> {
    const { graph } = this;
    const thread: Thread = { pool, path: '', depth: 0, watching: [], cancels: [], heard: new Map(), participant: this.participant, visits: new Map() };
    const { participant, instances: drawn } = graph.instancesOf(pool);
    const instances = this.oneInstance ? 1 : drawn;
    const start = graph.entryOf(pool);
    for (let instance = 1; instance <= instances; instance += 1) {
      if (!this.oneInstance) thread.participant = instance;
      thread.visits = new Map();
      if (instances > 1) {
        // Which instance this is, for whatever runs inside: `state._meta.instance.<pool id>`, 1-based.
        this.memory.instance(participant, instance);
        this.memory.startScope(pool, true, this.note(thread));
      }
      await this.host.moved?.(start.id, undefined, pool);
      await this.walk(start, 0, thread);
    }
    // The pool is one sender: a flow out of its participant to a step in another pool ("All subjects complete")
    // carries null once, when every instance has ended. A flow to another participant is the pool's talk instead,
    // which the steps inside exchange along, instance by instance.
    for (const flow of graph.flowsOut.get(participant) ?? []) {
      if (!graph.participants.has(flow.attributes.targetRef)) await this.post.send(flow, null, thread);
    }
  }

  /**
   * A scope (a pool's process, a sub-process) walked one level in, from `first`, until no path is left in it. Values
   * are not scoped with it (BPMN §10.4.7). A split starts a path for each branch it takes; a join lets one path on
   * once the paths it waits for have come. A path that fails, or leaves the scope at a boundary event of an activity
   * around it, stops the others, and the scope's walk throws what it met.
   */
  private async walk(first: PlanElement, depth: number, thread: Thread): Promise<void> {
    const scope: Scope = { depth, tasks: [], running: new Set(), joins: new Map(), cancel: new AbortController() };
    // The path walking into the scope waits for the paths inside it: they are its pool's walking paths meanwhile.
    if (thread.path) this.post.leave(thread.pool);
    try {
      this.spawn(scope, first, { ...thread, cancels: [...thread.cancels, scope.cancel.signal] });
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
        this.memory.trace.push(id);
        this.memory.count(id);
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
        // A runner may claim the end too: its chance to fold what it started for the study.
        if (host.claim(id)) await this.executeViaRunner(element, entry, thread);
        await this.post.throwFrom(element, thread);
        this.steps.end(entry);
        this.record({ event: 'executed', id, entry });
        this.log(thread, 'event.reached', `● ${id}`);
        host.passed?.(id);
        const container = graph.get(element.parent);
        const boundary = has(element, 'errorEventDefinition') ? this.errorBoundary(container) : undefined;
        // An error end event ends the sub-process around it at that sub-process's error boundary event.
        if (boundary) throw new Interrupted(container!.id, boundary);
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
      if (GATEWAY_TYPES.has(type) || type === 'parallelGateway') {
        this.log(thread, 'gateway.reached', `◇ ${id}`);
      } else if (PASSTHROUGH_TYPES.has(type)) {
        const entry = this.steps.begin(id, name, bpmnType(element));
        const runner = host.claim(id);
        try {
          if (runner) {
            // An event a runner executes waits in its runner: a catch event until sensed, a start until it may begin.
            this.log(thread, 'event.waiting', `◐ ${id}  (waiting via ${runner.name})`);
            this.adopt(id, await this.handOff(id, this.memory.json(), thread), entry);
            // What it recorded meanwhile (a rest's resting state) goes out along its data outputs.
            this.noteOutputs(element, entry, thread);
          } else if (graph.flowsIn.has(id)) {
            // A catch event a message flow reaches waits for that message; its content is the result.
            this.log(thread, 'event.waiting', `◐ ${id}  (waiting for a message)`);
            this.memory.store(id, (await this.post.receive(id, graph.flowsIn.get(id)!, thread)).content);
          } else if (element.timer) {
            // A timer event waits for its time: a duration from now, or a date.
            const ms = this.timerMs(element);
            this.log(thread, 'event.waiting', `◐ ${id}  (waiting ${ms}ms for its timer)`);
            await this.post.sleep(ms, id, thread);
          }
        } catch (error) {
          if (error instanceof Interrupted || error instanceof Cancelled) this.steps.end(entry);
          else this.steps.fail(entry, error);
          throw error;
        }
        await this.post.throwFrom(element, thread);
        this.steps.end(entry);
        this.record({ event: 'executed', id, entry });
        this.log(thread, 'event.reached', `○ ${id}`);
      } else {
        const boundary = await this.perform(element, depth, thread);
        if (boundary) {
          // The activity ended at one of its boundary events: the walk goes on from there.
          this.memory.trace.push(boundary.id);
          this.memory.count(boundary.id);
          this.record({ event: 'executed', id: boundary.id });
          await host.moved?.(boundary.id, undefined, thread.pool);
          this.log(thread, 'event.reached', `○ ${boundary.id}  (ended ${id})`);
          from = boundary;
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
   * multi-instance marker names: each such pass binds its item under the `inputDataItem`'s name in the activity's own
   * scope, and what that scope holds under the `outputDataItem`'s name after the pass joins the list stored into
   * `loopDataOutputRef`. A message at one of its boundary events ends it at the next step, and once it is done a
   * conditional boundary event whose condition now holds ends it too; that event is returned for the walk to go on from.
   */
  private async perform(element: PlanElement, depth: number, thread: Thread): Promise<PlanElement | undefined> {
    const { graph } = this;
    const { id } = element;
    const due: PlanElement[] = [];
    const stop = new AbortController();
    thread.watching.push({
      activity: id,
      flows: new Map((graph.boundaries.get(id) ?? [])
        .flatMap((boundary) => (graph.flowsIn.get(boundary.id) ?? []).map((flow): [string, PlanElement] => [flow.id, boundary]))),
      due,
      stop,
    });
    // A timer at a boundary event runs from the moment the activity is entered; when its time comes it ends the
    // activity, stopping every hand-off inside it.
    const timers = (graph.boundaries.get(id) ?? []).filter((boundary) => boundary.timer)
      .map((boundary) => this.post.timer(this.timerMs(boundary), boundary.id, () => { due.push(boundary); stop.abort(); }));
    try {
      let passes = 0;
      const listed = this.host.choose ? undefined : this.loopList(element);
      const outputs: unknown[] = [];
      while (listed ? passes < listed.items.length : this.loopsAgain(element, passes)) {
        passes += 1;
        if (passes > this.maxSteps) throw new Error(`${id}: loop budget exhausted — does its loop ever end?`);
        // Which pass this is, for whatever runs inside: `state._meta.instance.<id>`, 1-based.
        if (element.loop) this.memory.instance(id, passes);
        if (listed) {
          // The pass's item in the activity's own scope, `{C}` to the steps inside, and no output yet.
          if (listed.item) this.memory.set(id, listed.item, listed.items[passes - 1]);
          if (listed.output && listed.output in (this.memory.state[id] ?? {})) this.memory.set(id, listed.output);
        }
        if (CONTAINER_TYPES.has(element.type)) await this.walkContainer(element, depth, thread);
        else await this.runActivity(element, thread);
        if (listed) outputs.push(listed.output ? this.memory.state[id]?.[listed.output] ?? null : null);
      }
      if (listed?.into) {
        this.memory.store(listed.into, outputs);
        this.host.reuse?.remade(listed.into); // re-made each run, so a recorded step that reads it runs again
      }
    } catch (error) {
      if (error instanceof Interrupted && error.activity === id) return error.boundary;
      throw error;
    } finally {
      timers.forEach((timer) => timer.abort());
      thread.watching.pop();
    }
    return this.conditionalBoundary(element, thread);
  }

  /** The first conditional boundary event of a finished activity whose `condition` holds, with the activity's result
   * and bindings already adopted; its `{placeholders}` read as FEEL paths, so `{Play.failedTrialRate} > 0.2` reads the
   * element's own result. */
  private conditionalBoundary(element: PlanElement, thread: Thread): PlanElement | undefined {
    const conditional = (this.graph.boundaries.get(element.id) ?? []).filter((boundary) => has(boundary, 'conditionalEventDefinition') && boundary.condition);
    if (this.host.choose && conditional.length > 0) {
      const chosen = this.host.choose(`${element.id}:ends`, ['none', ...conditional.map((boundary) => boundary.id)]);
      return conditional.find((boundary) => boundary.id === chosen);
    }
    for (const boundary of this.graph.boundaries.get(element.id) ?? []) {
      if (!has(boundary, 'conditionalEventDefinition') || !boundary.condition) continue;
      const { body, language } = boundary.condition;
      const verdict = this.memory.evaluate({ body, language }, element.id) === true;
      this.log(thread, 'conditionExpression.evaluated', `    ${body} → ${verdict}  [${boundary.id}]`, { level: 'debug' });
      if (verdict) return boundary;
    }
    return undefined;
  }

  /** What a multi-instance marker whose `loopDataInputRef` names a list runs over, read once as the activity starts. */
  private loopList(element: PlanElement): { items: unknown[]; item: string | null; output: string | null; into: string | null } | undefined {
    const { loop } = element;
    if (loop?.kind !== 'multiInstance' || !loop.input) return undefined;
    const declared = this.graph.propertyScope(loop.input);
    let items: unknown;
    if (declared) {
      const held = this.memory.state[declared.scope] ?? {};
      items = declared.name in held ? held[declared.name] : this.graph.properties.get(declared.scope)!.get(declared.name)!.value;
    } else {
      items = this.memory.held.get(loop.input);
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
  private loopsAgain(element: PlanElement, passes: number): boolean {
    const { loop } = element;
    if (!loop) return passes === 0;
    if (this.host.choose) {
      if (passes === 0 && !(loop.kind === 'standard' && loop.testBefore)) return true;
      if (loop.kind === 'standard' && loop.maximum && passes >= loop.maximum) return false;
      return this.host.choose(`${element.id}:again`, ['again', 'done']) === 'again';
    }
    if (loop.kind === 'multiInstance') {
      if (!loop.cardinality) return passes === 0;
      return passes < Math.trunc(Number(this.memory.evaluate(loop.cardinality, element.id)));
    }
    if (passes === 0 && !loop.testBefore) return true;
    if (loop.maximum && passes >= loop.maximum) return false;
    if (!loop.condition) return true;
    return this.memory.evaluate(loop.condition, element.id) === true;
  }

  private async walkContainer(element: PlanElement, depth: number, thread: Thread): Promise<void> {
    const { graph, host } = this;
    const { id } = element;
    const entry = this.steps.begin(id, graph.nameOf(id), bpmnType(element));
    this.log(thread, 'activity.started', `⊞ ${id}`);
    this.memory.startScope(id, true, this.note(thread));
    const start = graph.startEvent(id);
    try {
      if (!start) {
        // A sub-process without a start event only lists what it holds: the walk steps past it (the plan check asks
        // for one only where sequence flows run inside).
        this.log(thread, 'subProcess.unwalked', `    ${id} has no start event, so nothing inside it runs; stepping past it`, { level: 'warning' });
      } else {
        await host.moved?.(start.id, undefined, thread.pool);
        await this.walk(start, depth + 1, thread);
      }
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
    this.record({ event: 'executed', id, entry });
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
      this.record({ event: 'reused', id, run: verdict.run ?? '' });
      return;
    }
    this.log(thread, 'activity.started', `□ ${id}`);
    replay();
    if (verdict?.superseded) this.log(thread, 'activity.invalidated', `    ${verdict.superseded}`);
    const entry = this.steps.begin(id, graph.nameOf(id), bpmnType(element));
    try {
      await this.executeActivity(element, entry, thread);
    } catch (error) {
      if (error instanceof Interrupted) {
        entry.interruptedBy = error.boundary.id;
        this.steps.end(entry);
        throw error;
      }
      if (error instanceof Cancelled) {
        this.steps.end(entry);
        throw error;
      }
      const boundary = this.errorBoundary(element);
      const { status } = this.steps;
      this.steps.fail(entry, error);
      this.log(thread, 'activity.failed', `    ${id}: ${(error as Error)?.name ?? 'Error'}: ${(error as Error)?.message ?? error}`, { level: 'error' });
      this.record({ event: 'failed', id, entry });
      if (!boundary) throw error;
      // An error boundary event catches the failure: the record keeps the error, the run is not failed, and the walk
      // goes on from the event, as a message at a boundary event ends an activity.
      entry.interruptedBy = boundary.id;
      this.steps.status = status;
      throw new Interrupted(id, boundary);
    }
    this.steps.end(entry);
    host.reuse?.ran(id);
    this.log(thread, 'activity.finished', `    ${id} done in ${entry.durationMs}ms`, { level: 'debug' });
    this.record({ event: 'executed', id, entry });
  }

  /** The error boundary event an activity carries, if any: where a failure inside it goes on from. */
  private errorBoundary(element: PlanElement | undefined): PlanElement | undefined {
    return (this.graph.boundaries.get(element?.id ?? '') ?? []).find((boundary) => has(boundary, 'errorEventDefinition'));
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
      for (const flow of outgoing) await this.post.send(flow, this.memory.inputsOf(element), thread, { inReplyTo: this.post.answering(flow, thread) });
      if (incoming.length > 0) this.memory.bind(element, (await this.post.receive(scope, incoming, thread)).content);
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
      const handed = await this.handOff(id, this.memory.json(), thread, talk);
      await talk?.delivered(); // what it sent last is answered before the walk goes on
      this.adopt(id, handed, entry);
    } catch (error) {
      // What a failed hand-off had bound before it failed is kept: the step fails, its work is not lost.
      if (error instanceof HandoffError && error.partial) this.adopt(id, error.partial, entry);
      throw error;
    }
    this.noteOutputs(element, entry, thread);
  }

  /** Take what a runner handed back: its record into the step's entry, the properties it wrote into their scopes
   * (`_meta` stays the walk's, and what the Parameters wired into a sub-process set stays as set), the values it
   * bound under their ids, and its result under the element's own. */
  private adopt(id: string, handed: Handback, entry: Entry): void {
    keepRecord(entry, handed);
    for (const [scope, written] of Object.entries(handed.state ?? {})) {
      if (scope === '_meta' || !written || typeof written !== 'object') continue;
      const held = (this.memory.state[scope] ??= {});
      const fixed = [...(this.graph.readonly.get(scope) ?? [])].filter((name) => name in written && JSON.stringify(written[name]) !== JSON.stringify(held[name])).sort();
      if (fixed.length > 0) {
        throw new Error(`${id} writes ${fixed.join(', ')}, which the Parameters wired into ${scope} set, so nothing inside it writes them`);
      }
      for (const [name, value] of Object.entries(written)) this.memory.set(scope, name, value);
    }
    for (const [key, value] of Object.entries(handed.values ?? {})) this.memory.store(key, value);
    if (handed.result !== undefined) this.memory.store(id, handed.result);
  }

  /** One hand-off to the host, which a timer at a boundary event of an activity around it may stop, and so may a
   * path that ends its scope: the walk then leaves for that event, or stops, whatever the hand-off had done. */
  private async handOff(id: string, values: Record<string, unknown>, thread: Thread, talk?: Talk): Promise<Handback> {
    const handoff = new AbortController();
    const stops = [...thread.watching.map(({ stop }) => stop.signal), ...thread.cancels];
    const abort = (): void => handoff.abort();
    for (const signal of stops) {
      if (signal.aborted) handoff.abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    try {
      const attributes = this.memory.resolved(this.graph.get(id)!);
      return await this.host.perform(id, values, { attributes, talk, note: this.note(thread), signal: handoff.signal });
    } finally {
      for (const signal of stops) signal.removeEventListener('abort', abort);
      this.post.checkInterrupt(thread, true);
    }
  }

  /** How long a timer event waits, its `{placeholders}` read from the run's values. */
  private timerMs(element: PlanElement): number {
    const read = (text: string | undefined): string | undefined =>
      text?.replace(PLACEHOLDER, (_cited, path: string) => String(this.memory.evaluate({ body: path, language: null }, element.id)));
    const { duration, date, cycle } = element.timer!;
    try {
      return timerDelay({ duration: read(duration), date: read(date), cycle: read(cycle) });
    } catch (error) {
      throw new Error(`${element.id}: ${(error as Error).message}`);
    }
  }

  /** What the activity's data output edges targeted. A sub-process carries its own edges, so a dataset the steps
   * inside it fill is generated by the sub-process. */
  private noteOutputs(element: PlanElement, entry: Entry, thread: Thread): void {
    const targets = element.outputs.map((output) => output.target).filter((target): target is string => !!target);
    if (targets.length > 0) entry.generated = targets;
    this.host.outputs?.(element.id, targets, entry, this.note(thread));
  }

  // --- flows and gateways ---


  /** Take a sequence flow: counted like a visit, so a node is reached as often as its incoming flows are taken. */
  private async follow(flow: PlanElement, thread: Thread): Promise<PlanElement | undefined> {
    this.memory.count(flow.id);
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
        : conditional.filter((flow) => this.memory.evaluate(flow.condition!, id) === true);
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
      this.record({ event: 'reused', id, run: prior.run, flow: prior.flow });
      return along([replayed]);
    }
    const entry = this.steps.begin(id, graph.nameOf(id), bpmnType(element));

    /** Record the decision and how it was made, then follow the flows taken. */
    const take = (taken: PlanElement[], how: string, marks: Record<string, boolean> = {}): Promise<PlanElement[]> => {
      entry.taken = taken.length === 1
        ? { sequenceFlow: taken[0].id, name: taken[0].name, how, ...marks }
        : { sequenceFlows: taken.map((flow) => flow.id), how, ...marks };
      this.steps.end(entry);
      this.log(thread, 'sequenceFlow.taken', `    ${how} → ${taken.map((flow) => flow.id).join(', ')}`);
      this.record({ event: 'executed', id, ...(taken.length === 1 ? { flow: taken[0].id } : {}), entry });
      return along(taken);
    };

    if (element.type === 'eventBasedGateway') {
      this.log(thread, 'event.waiting', `    (waiting for the first message along ${flows.length} branches)`);
      try {
        return take([await this.post.race(id, flows, thread)], 'first message', { message: true });
      } catch (error) {
        if (error instanceof Interrupted || error instanceof Cancelled) this.steps.end(entry);
        else this.steps.fail(entry, error);
        throw error;
      }
    }

    if (host.choose && flows.length > 1) {
      if (element.type === 'inclusiveGateway') return take(this.chooseFlows(id, flows, false), 'chosen');
      const chosen = host.choose(id, flows.map((flow) => flow.id));
      return take([flows.find((flow) => flow.id === chosen) ?? flows[0]], 'chosen');
    }

    const allocation = this.allocations.get(id);
    if (allocation) {
      // A participant's draws are its own: the seed, the gateway, which instance of the pool this is, and which of
      // its visits. So a participant draws the same in any runtime and on any re-run, whatever the others drew.
      const visit = (thread.visits.get(id) ?? 0) + 1;
      thread.visits.set(id, visit);
      const seed = this.concealed.get(id) ?? this.seed;
      let arm: number;
      if (allocation.algorithm === 'block') {
        // Blocks over the participants, by number; a gateway a participant passes again (in a loop, or along a cycle)
        // allocates its visits in blocks of their own. Position n sits at (n - 1) % size in block (n - 1) // size.
        const within = this.graph.scopeChain(id).some((scope) => this.graph.elements[scope]?.loop);
        const [sequence, n] = within ? [`${id}#${thread.participant}`, visit] : [`${id}@${visit}`, thread.participant];
        const block = Math.floor((n - 1) / allocation.size);
        const key = `${sequence}:${block}`;
        if (!this.blocks.has(key)) this.blocks.set(key, permutedBlock(seed, sequence, block, allocation.weights, allocation.size));
        arm = this.blocks.get(key)![(n - 1) % allocation.size];
      } else {
        arm = pick(seed === undefined ? Math.random() : draw(seed, id, thread.participant, visit), allocation.weights);
      }
      return take([flows[arm]], 'drawn', { random: true });
    }

    const held: PlanElement[] = [];
    try {
      let bindings: Record<string, unknown> = {};
      const runner = host.claim(id);
      if (runner) {
        // The runner samples what the conditions read (`face_count`).
        this.log(thread, 'runner.called', `    ${runner.name} samples for ${id}`);
        const sampled = await this.handOff(id, this.memory.json(), thread);
        keepRecord(entry, sampled);
        bindings = (sampled.result as Record<string, unknown>) || {};
        if (Object.keys(bindings).length > 0) entry.bindings = bindings;
      }
      for (const flow of flows) {
        if (!flow.condition) continue;
        const verdict = this.memory.evaluate(flow.condition, id, bindings);
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
      this.steps.fail(entry, error);
      throw error;
    }
    if (held.length > 0) return take(held, held.map((flow) => flow.condition!.body).join('; '));

    // No condition held: the default flow, else the one flow without a condition.
    const chosen = flows.find((flow) => flow.id === element.attributes.default);
    if (chosen) return take([chosen], 'default', { default: true });
    const bare = flows.filter((flow) => !flow.condition);
    if (bare.length === 1) return take(bare, 'otherwise', { otherwise: true });
    entry.status = 'stuck';
    this.steps.end(entry);
    this.steps.status = 'error';
    throw new Error(`${id}: no condition held, and there is no default flow or single flow without a condition`);
  }

  /** The flows an exploring host picks at a split that takes each whose condition holds: any one or more of them, or
   * (`none`) none, for the default to take. */
  private chooseFlows(id: string, flows: PlanElement[], none: boolean): PlanElement[] {
    const options = subsets(flows).map((taken) => taken.map((flow) => flow.id).join('+'));
    const chosen = this.host.choose!(id, none ? ['none', ...options] : options);
    return chosen === 'none' ? [] : flows.filter((flow) => chosen.split('+').includes(flow.id));
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

  /** The `state` tree: `state.<scope>.<property>`, and `state._meta`, the walk's own. */
  /** The flows whose messages were sent this run and never taken. */
  untaken(): string[] {
    return this.post.untaken();
  }

  get state(): StateTree {
    return this.memory.state;
  }

  /** What each element produced this run, by id. */
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
