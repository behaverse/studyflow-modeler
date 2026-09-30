import { PLACEHOLDER } from '@core/document/state';
import { evaluateFeel } from '@core/expression/feel';
import { allocationOf, draw, permutedBlock, pick, type Allocation } from '@core/engine/allocation';
import { CONTAINER_TYPES, GATEWAY_TYPES, Graph, PASSTHROUGH_TYPES } from '@core/engine/graph';
import type { Expression, Plan, PlanElement } from '@core/engine/plan';
import { Steps, type Entry } from '@core/engine/steps';

/**
 * The walk: one study, walked as the notation says. It is the one engine behind every runtime: the local runtime
 * hosts it and hands each claimed element to a partial runner (skills/local/SKILL.md), the browser runtime hosts it
 * and shows each step as a screen, and the modeler hosts it as a dry run. It executes nothing itself and does no I/O:
 * a host says who claims an element and performs it, keeps the records, and decides what a re-run may reuse.
 *
 * Every pool with a process is walked at once, each as its own task, one path per pool. The pools talk only along
 * message flows, and the walk carries every message.
 */

export type StateTree = Record<string, any>;

/** A message along a message flow. */
export type Message = { id: string; flow: string; content: unknown; inReplyTo?: string };

/** What a claimed element's runner exchanges while it runs: a message out along one of its flows, the messages in. */
export type Talk = {
  send(line: { flow?: unknown; content?: unknown; id?: string; inReplyTo?: string }): void;
  /** The messages that have arrived along the flows into it since the last take. */
  take(): Message[];
};

export type Level = 'debug' | 'info' | 'warning' | 'error';

/** A line for the run's log, written at the depth of the step it is about. */
export type Note = (event: string, message: string, detail?: { level?: Level; data?: Record<string, unknown> }) => void;

/** What a re-run may reuse of an earlier run's records; a host without one runs every step. */
export type Reuse = {
  /** Before an activity runs: `skipped` when its record stands, else what to say about the record it supersedes. A
   * `live` activity never skips. What it notes is logged under the step's own line. */
  activity(id: string, live: boolean, note: Note): { skipped: boolean; run?: string; superseded?: string };
  /** A gateway's recorded decision, when it may be replayed: the flow it took, and the run that took it. */
  decision(id: string): { flow: string; run: string } | undefined;
  /** An activity ran: what it made is re-made, so what reads it runs again. */
  ran(id: string): void;
  /** A value the walk itself re-made (a list pass's collected outputs). */
  remade(id: string): void;
};

export type Host = {
  /** The runner that claims an element, by name, and whether its claim is live: a live element never skips or replays. */
  claim(id: string): { name: string; live: boolean } | undefined;
  /** Hands a claimed element, or one message to a pool a runner plays, to its runner: the run's values in, what the
   * runner hands back out (`result`, `durationMs`, `record`, the values and scopes it changed). A failure rejects. */
  perform(id: string, values: Record<string, unknown>, step: { talk?: Talk; note: Note }): Promise<Record<string, unknown>>;
  log: Note;
  /** A timestamp for a record, as the host writes them. */
  now(): string;
  reuse?: Reuse;
  /** A step settled: the host checkpoints its records. */
  settled?(what: { action: 'executed' | 'failed' | 'reused'; id: string; flow?: string; when: string; run?: string }): void;
  /** An activity's data outputs, once it is done: the host notes what it made. */
  outputs?(id: string, targets: string[], entry: Entry, note: Note): void;
  /** The walk is about to leave an element. */
  passed?(id: string): void;
};

export type WalkOptions = {
  /** The run's seed: the study's, unless the run was given another. */
  seed?: string | number | null;
  /** The `state` tree the study carries from earlier runs. */
  state?: StateTree;
  maxSteps?: number;
  /** Walk each pool once, whatever its `participantMultiplicity`: a participant's session is one instance of its pool. */
  oneInstance?: boolean;
};

/** A message reached a boundary event of a running activity, or a failure its error boundary event: the walk leaves
 * the activity for the event. */
class Interrupted extends Error {
  readonly activity: string;
  readonly boundary: PlanElement;

  constructor(activity: string, boundary: PlanElement) {
    super(`${activity} ended by ${boundary.id}`);
    this.name = 'Interrupted';
    this.activity = activity;
    this.boundary = boundary;
  }
}

/** One pool's walk: where it is, what it watches, what it last heard. */
type Thread = {
  depth: number;
  /** The activities it is inside, outermost first, each with the message flows that end it and their boundary events. */
  watching: { activity: string; flows: Map<string, PlanElement> }[];
  /** The message this pool last took from each other pool: what it sends back answers it. */
  heard: Map<string, string>;
};

const bpmnType = (element: PlanElement): string => `bpmn:${element.type.charAt(0).toUpperCase()}${element.type.slice(1)}`;

const has = (element: PlanElement, definition: string): boolean => (element.events ?? []).includes(definition);

/** Whether two JSON values are the same, whatever the order of their keys. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a as object);
  if (left.length !== Object.keys(b as object).length) return false;
  return left.every((key) => Object.hasOwn(b as object, key) && same((a as any)[key], (b as any)[key]));
}

const HANDED_BACK = new Set(['result', 'durationMs', 'error', 'record']);

export class Walk {
  readonly graph: Graph;
  readonly steps = new Steps();
  /** The `state` tree: `state.<scope>.<property>`, and `state._meta`, the walk's own. */
  readonly state: StateTree;
  readonly trace: string[] = [];
  /** What each element produced this run, by id. */
  readonly values = new Map<string, unknown>();
  /** When each activity finished, each event was reached, and which flow each gateway took. */
  readonly completed = new Map<string, string>();
  readonly reached = new Map<string, string>();
  readonly decisions = new Map<string, { flow: string; when: string }>();
  /** Every element that never skips or replays: a live runner's, one that exchanges messages, a pass over a list. */
  readonly live = new Set<string>();
  readonly allocations = new Map<string, Allocation>();

  private readonly host: Host;
  private readonly seed: number | undefined;
  private readonly maxSteps: number;
  private readonly oneInstance: boolean;
  private readonly blocks = new Map<string, number[]>();
  private readonly mail = new Map<string, Message[]>();
  private readonly waiting = new Set<() => void>();
  private readonly poolsDone = new Set<string>();
  private readonly serving = new Map<string, Promise<unknown>>();
  private sent = 0;
  private failed: unknown;

  constructor(plan: Plan, host: Host, options: WalkOptions = {}) {
    this.host = host;
    this.graph = new Graph(plan);
    this.state = options.state ?? {};
    this.maxSteps = options.maxSteps ?? 1000;
    this.oneInstance = options.oneInstance ?? false;
    const seed = Number(options.seed ?? plan.study.seed ?? NaN);
    this.seed = Number.isInteger(seed) ? seed : undefined; // unseeded: `Math.random()`, and a re-run replays the recorded decision instead

    const { graph } = this;
    // Each random gateway's allocation, read before the walk: one it cannot apply stops the run here.
    for (const gateway of Object.values(graph.elements)) {
      if (GATEWAY_TYPES.has(gateway.type) && gateway.branching === 'random') {
        this.allocations.set(gateway.id, allocationOf(gateway, (graph.outgoing.get(gateway.id) ?? []).length));
      }
    }
    // Messages are interaction: an element that sends or takes them never skips or replays, nor does a gateway the
    // first message decides, nor an unclaimed step that asks along its pool's flows. Nor does a pass over a list: a
    // record keeps an element's last pass only, and each pass binds another item.
    const overLists = new Set(Object.values(graph.elements)
      .filter((element) => element.loop?.kind === 'multiInstance' && element.loop.input)
      .map((element) => element.id));
    for (const id of graph.walked) {
      const element = graph.elements[id];
      const claim = host.claim(id);
      const talks = (): boolean => { const { outgoing, incoming } = graph.exchange(element); return outgoing.length + incoming.length > 0; };
      if (claim?.live || graph.flowsIn.has(id) || graph.flowsOut.has(id) || element.type === 'eventBasedGateway'
        || (!claim && talks()) || graph.scopeChain(id).some((scope) => overLists.has(scope))) {
        this.live.add(id);
      }
    }
    for (const id of graph.participants.keys()) if (host.claim(id)?.live) this.live.add(id);
    // Study-scoped properties persist across runs, so only ones the tree lacks take their `value`; a plain element's
    // properties live with the study (`Excluded (n={count})` counts across runs).
    for (const scope of graph.properties.keys()) {
      if (!CONTAINER_TYPES.has(graph.elements[scope]?.type ?? 'process')) this.startScope(scope, false, { depth: 0, watching: [], heard: new Map() });
    }
  }

  // --- the run ---

  async run(): Promise<void> {
    const { graph, host } = this;
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
        this.failed ??= error; // the first pool to fail ends the run; the others notice while waiting
      } finally {
        this.poolsDone.add(pool);
        this.notify();
      }
    }));
    if (this.failed !== undefined) throw this.failed;
  }

  /** A pool's process, once, or `participantMultiplicity/@maximum` times when its participant carries one: the
   * instances run one after another, as a multi-instance activity's passes do. */
  private async runPool(pool: string): Promise<void> {
    const { graph } = this;
    const thread: Thread = { depth: 0, watching: [], heard: new Map() };
    const { participant, instances: drawn } = graph.instancesOf(pool);
    const instances = this.oneInstance ? 1 : drawn;
    const start = graph.entryOf(pool);
    for (let instance = 1; instance <= instances; instance += 1) {
      if (instances > 1) {
        // Which instance this is, for whatever runs inside: `state._meta.instance.<pool id>`, 1-based.
        this.meta('instance')[participant] = instance;
        this.startScope(pool, true, thread);
      }
      await this.walk(start, 0, thread);
    }
    // The pool is one sender: a flow out of its participant to a step in another pool ("All subjects complete")
    // carries null once, when every instance has ended. A flow to another participant is the pool's talk instead,
    // which the steps inside exchange along, instance by instance.
    for (const flow of graph.flowsOut.get(participant) ?? []) {
      if (!graph.participants.has(flow.attributes.targetRef)) await this.send(flow, null, thread);
    }
  }

  /** A sub-process is walked one level in, but values are not scoped with it (BPMN §10.4.7). */
  private async walk(first: PlanElement, depth: number, thread: Thread): Promise<void> {
    const { graph, host } = this;
    const outer = thread.depth;
    try {
      let steps = 0;
      let element: PlanElement | undefined = first;
      while (element) {
        steps += 1;
        if (steps > this.maxSteps) throw new Error('step budget exhausted — is the flow cycling without an exit?');
        thread.depth = depth;
        const { id, type } = element;
        this.trace.push(id);
        this.count(id);
        this.checkInterrupt(thread);
        const name = graph.nameOf(id);

        if (type === 'endEvent') {
          const entry = this.steps.begin(id, name, bpmnType(element));
          // A runner may claim the end too: its chance to fold what it started for the study.
          if (host.claim(id)) await this.executeViaRunner(element, entry, thread);
          await this.throwMessages(element, thread);
          this.steps.end(entry);
          this.reached.set(id, host.now());
          this.log(thread, 'event.reached', `● ${id}`);
          host.passed?.(id);
          const container = graph.get(element.parent);
          const boundary = has(element, 'errorEventDefinition') ? this.errorBoundary(container) : undefined;
          // An error end event ends the sub-process around it at that sub-process's error boundary event.
          if (boundary) throw new Interrupted(container!.id, boundary);
          return;
        }
        if (type === 'parallelGateway' && (graph.outgoing.get(id) ?? []).length > 1) {
          // Each pool is one path; walking on would run the first branch only.
          throw new Error(`${id}: a parallel split, and a pool walks one path. `
            + 'Put the steps in sequence, or give each branch a pool of its own.');
        }
        if (GATEWAY_TYPES.has(type) || type === 'parallelGateway') {
          this.log(thread, 'gateway.reached', `◇ ${id}`);
        } else if (PASSTHROUGH_TYPES.has(type)) {
          const entry = this.steps.begin(id, name, bpmnType(element));
          const runner = host.claim(id);
          try {
            if (runner) {
              // An event a runner executes waits in its runner: a catch event until sensed, a start until it may begin.
              this.log(thread, 'event.waiting', `◐ ${id}  (waiting via ${runner.name})`);
              const sensed = await host.perform(id, this.jsonValues(), { note: this.note(thread) });
              entry._runnerMs = sensed.durationMs;
              keepRecord(entry, sensed);
              this.store(id, sensed.result);
            } else if (graph.flowsIn.has(id)) {
              // A catch event a message flow reaches waits for that message; its content is the result.
              this.log(thread, 'event.waiting', `◐ ${id}  (waiting for a message)`);
              this.store(id, (await this.receive(id, graph.flowsIn.get(id)!, thread)).content);
            }
          } catch (error) {
            if (error instanceof Interrupted) this.steps.end(entry);
            else this.steps.fail(entry, error);
            throw error;
          }
          await this.throwMessages(element, thread);
          this.steps.end(entry);
          this.reached.set(id, host.now());
          this.log(thread, 'event.reached', `○ ${id}`);
        } else {
          const boundary = await this.perform(element, depth, thread);
          if (boundary) {
            // The activity ended at one of its boundary events: the walk goes on from there.
            this.trace.push(boundary.id);
            this.count(boundary.id);
            this.reached.set(boundary.id, host.now());
            this.log(thread, 'event.reached', `○ ${boundary.id}  (ended ${id})`);
            element = await this.next(boundary, thread);
            continue;
          }
        }
        // After `next`, so a gateway's decision is in its record entry too.
        const following = await this.next(element, thread);
        host.passed?.(id);
        element = following;
      }
    } finally {
      thread.depth = outer;
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
    thread.watching.push({
      activity: id,
      flows: new Map((graph.boundaries.get(id) ?? [])
        .flatMap((boundary) => (graph.flowsIn.get(boundary.id) ?? []).map((flow): [string, PlanElement] => [flow.id, boundary]))),
    });
    try {
      let passes = 0;
      const listed = this.loopList(element);
      const outputs: unknown[] = [];
      while (listed ? passes < listed.items.length : this.loopsAgain(element, passes)) {
        passes += 1;
        if (passes > this.maxSteps) throw new Error(`${id}: loop budget exhausted — does its loop ever end?`);
        // Which pass this is, for whatever runs inside: `state._meta.instance.<id>`, 1-based.
        if (element.loop) this.meta('instance')[id] = passes;
        if (listed) {
          // The pass's item in the activity's own scope, `{C}` to the steps inside, and no output yet.
          const held = (this.state[id] ??= {});
          if (listed.item) held[listed.item] = listed.items[passes - 1];
          if (listed.output) delete held[listed.output];
        }
        if (CONTAINER_TYPES.has(element.type)) await this.walkContainer(element, depth, thread);
        else await this.runActivity(element, thread);
        if (listed) outputs.push(listed.output ? this.state[id]?.[listed.output] ?? null : null);
      }
      if (listed?.into) {
        this.store(listed.into, outputs);
        this.host.reuse?.remade(listed.into); // re-made each run, so a recorded step that reads it runs again
      }
    } catch (error) {
      if (error instanceof Interrupted && error.activity === id) return error.boundary;
      throw error;
    } finally {
      thread.watching.pop();
    }
    return this.conditionalBoundary(element, thread);
  }

  /** The first conditional boundary event of a finished activity whose `condition` holds, with the activity's result
   * and bindings already adopted; its `{placeholders}` read as FEEL paths, so `{Play.failedTrialRate} > 0.2` reads the
   * element's own result. */
  private conditionalBoundary(element: PlanElement, thread: Thread): PlanElement | undefined {
    for (const boundary of this.graph.boundaries.get(element.id) ?? []) {
      if (!has(boundary, 'conditionalEventDefinition') || !boundary.condition) continue;
      const { body, language } = boundary.condition;
      const verdict = this.evaluate({ body: body.replace(PLACEHOLDER, '$1'), language }, element.id) === true;
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
      const held = this.state[declared.scope] ?? {};
      items = declared.name in held ? held[declared.name] : this.graph.properties.get(declared.scope)!.get(declared.name)!.value;
    } else {
      items = this.values.get(loop.input);
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
    if (loop.kind === 'multiInstance') {
      if (!loop.cardinality) return passes === 0;
      return passes < Math.trunc(Number(this.evaluate(loop.cardinality, element.id)));
    }
    if (passes === 0 && !loop.testBefore) return true;
    if (loop.maximum && passes >= loop.maximum) return false;
    if (!loop.condition) return true;
    return this.evaluate(loop.condition, element.id) === true;
  }

  private async walkContainer(element: PlanElement, depth: number, thread: Thread): Promise<void> {
    const { graph, host } = this;
    const { id } = element;
    const entry = this.steps.begin(id, graph.nameOf(id), bpmnType(element));
    this.log(thread, 'activity.started', `⊞ ${id}`);
    this.startScope(id, true, thread);
    const start = graph.startEvent(id);
    try {
      if (!start) {
        // A sub-process without a start event only lists what it holds: the walk steps past it (the plan check asks
        // for one only where sequence flows run inside).
        this.log(thread, 'subProcess.unwalked', `    ${id} has no start event, so nothing inside it runs; stepping past it`, { level: 'warning' });
      } else {
        await this.walk(start, depth + 1, thread);
      }
    } catch (error) {
      if (error instanceof Interrupted) {
        entry.interruptedBy = error.boundary.id;
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
    const when = host.now();
    this.completed.set(id, when);
    this.log(thread, 'activity.finished', `  ${id} done in ${entry.durationMs}ms`, { level: 'debug' });
    host.settled?.({ action: 'executed', id, when });
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
      const when = host.now();
      host.settled?.({ action: 'reused', id, when, run: verdict.run });
      return;
    }
    this.log(thread, 'activity.started', `□ ${id}`, { data: { element: id } });
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
      const boundary = this.errorBoundary(element);
      const { status } = this.steps;
      this.steps.fail(entry, error);
      this.log(thread, 'activity.failed', `    ${id}: ${(error as Error)?.name ?? 'Error'}: ${(error as Error)?.message ?? error}`, { level: 'error' });
      host.settled?.({ action: 'failed', id, when: host.now() });
      if (!boundary) throw error;
      // An error boundary event catches the failure: the record keeps the error, the run is not failed, and the walk
      // goes on from the event, as a message at a boundary event ends an activity.
      entry.interruptedBy = boundary.id;
      this.steps.status = status;
      throw new Interrupted(id, boundary);
    }
    this.steps.end(entry);
    const when = host.now();
    this.completed.set(id, when);
    host.reuse?.ran(id);
    this.log(thread, 'activity.finished', `    ${id} done in ${entry.durationMs}ms`, { level: 'debug' });
    host.settled?.({ action: 'executed', id, when });
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
      for (const flow of outgoing) await this.send(flow, this.inputsOf(element), thread, { inReplyTo: this.answering(flow, thread) });
      if (incoming.length > 0) this.bindResult(element, (await this.receive(scope, incoming, thread)).content);
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
    const sent = this.jsonValues();
    const talking = graph.messageScope(id);
    const talks = graph.flowsIn.has(talking) || graph.flowsOut.has(talking);
    const talk = talks ? this.talk(id, talking, thread) : undefined;
    const reported = await host.perform(id, sent, { talk, note: this.note(thread) });
    await talk?.delivered(); // what it sent last is answered before the walk goes on
    entry._runnerMs = reported.durationMs;
    keepRecord(entry, reported);
    for (const [key, value] of Object.entries(reported)) {
      if (key === 'state' && value && typeof value === 'object') {
        // Properties the runner wrote (a data edge into a property): scope by scope, `_meta` stays the walk's.
        for (const [scope, held] of Object.entries(value as StateTree)) {
          const before = (sent.state as StateTree)?.[scope] ?? {};
          if (scope === '_meta' || !held || typeof held !== 'object' || same(held, before)) continue;
          const written = [...(graph.readonly.get(scope) ?? [])].filter((name) => name in held && !same(held[name], before[name])).sort();
          if (written.length > 0) {
            throw new Error(`${id} writes ${written.join(', ')}, which the Parameters wired into ${scope} set, so nothing inside it writes them`);
          }
          Object.assign((this.state[scope] ??= {}), held);
        }
      } else if (!HANDED_BACK.has(key) && key !== 'state' && !(key in sent && same(sent[key], value))) {
        this.store(key, value);
      }
    }
    this.noteOutputs(element, entry, thread);
  }

  /** What the activity's data output edges targeted. A sub-process carries its own edges, so a dataset the steps
   * inside it fill is generated by the sub-process. */
  private noteOutputs(element: PlanElement, entry: Entry, thread: Thread): void {
    const targets = element.outputs.map((output) => output.target).filter((target): target is string => !!target);
    if (targets.length > 0) entry.generated = targets;
    this.host.outputs?.(element.id, targets, entry, this.note(thread));
  }

  // --- flows and gateways ---

  /** One more token at an element, or along a sequence flow: `state._meta.reached.<id>`, study-lifetime. */
  private count(id: string): void {
    const reached = this.meta('reached');
    reached[id] = (reached[id] ?? 0) + 1;
  }

  private meta(quantity: string): Record<string, any> {
    return ((this.state._meta ??= {})[quantity] ??= {});
  }

  /** Take a sequence flow: counted like a visit, so a node is reached as often as its incoming flows are taken. */
  private follow(flow: PlanElement): PlanElement | undefined {
    this.count(flow.id);
    return this.graph.get(flow.attributes.targetRef);
  }

  private async next(element: PlanElement, thread: Thread): Promise<PlanElement | undefined> {
    const { graph, host } = this;
    const { id } = element;
    const flows = graph.outgoing.get(id) ?? [];
    if (flows.length === 0) return undefined;
    if (!GATEWAY_TYPES.has(element.type)) return this.follow(flows[0]);

    // A clean gateway replays its recorded decision: same inputs, same seed, same verdict. A gateway a live runner
    // samples decides live, so its decision never replays.
    const prior = this.live.has(id) ? undefined : host.reuse?.decision(id);
    const replayed = prior && flows.find((flow) => flow.id === prior.flow);
    if (prior && replayed) {
      this.log(thread, 'gateway.replayed', `↻ ${id} → ${prior.flow}  (decision from run ${prior.run})`);
      host.settled?.({ action: 'reused', id, flow: prior.flow, when: host.now(), run: prior.run });
      return this.follow(replayed);
    }
    const entry = this.steps.begin(id, graph.nameOf(id), bpmnType(element));

    /** Record the decision and how it was made, then follow `flow`. */
    const take = (flow: PlanElement, how: string, marks: Record<string, boolean> = {}): PlanElement | undefined => {
      entry.taken = { sequenceFlow: flow.id, name: flow.name, ...marks };
      this.steps.end(entry);
      const when = host.now();
      this.decisions.set(id, { flow: flow.id, when });
      this.log(thread, 'sequenceFlow.taken', `    ${how} → ${flow.id}`, { data: { element: id, flow: flow.id, how } });
      host.settled?.({ action: 'executed', id, flow: flow.id, when });
      return this.follow(flow);
    };

    if (element.type === 'eventBasedGateway') {
      this.log(thread, 'event.waiting', `    (waiting for the first message along ${flows.length} branches)`);
      try {
        return take(await this.race(id, flows, thread), 'first message', { message: true });
      } catch (error) {
        if (error instanceof Interrupted) this.steps.end(entry);
        else this.steps.fail(entry, error);
        throw error;
      }
    }

    const allocation = this.allocations.get(id);
    if (allocation) {
      // Seeded, each visit draws from the seed, the gateway and the visit number. The count is `_meta.reached`,
      // study-lifetime: each turn of a loop and each re-run draws again.
      const visit = this.meta('reached')[id] ?? 1;
      let arm: number;
      if (allocation.algorithm === 'block') {
        // Visit v sits at (v - 1) % size in block (v - 1) // size; a block is shuffled once, so it stays balanced.
        const block = Math.floor((visit - 1) / allocation.size);
        const key = `${id}:${block}`;
        if (!this.blocks.has(key)) this.blocks.set(key, permutedBlock(this.seed, id, block, allocation.weights, allocation.size));
        arm = this.blocks.get(key)![(visit - 1) % allocation.size];
      } else {
        arm = pick(this.seed === undefined ? Math.random() : draw(this.seed, id, visit), allocation.weights);
      }
      return take(flows[arm], 'drawn', { random: true });
    }

    try {
      let bindings: Record<string, unknown> = {};
      const runner = host.claim(id);
      if (runner) {
        // The runner samples what the conditions read (`face_count`).
        this.log(thread, 'runner.called', `    ${runner.name} samples for ${id}`);
        const sampled = await host.perform(id, this.jsonValues(), { note: this.note(thread) });
        entry._runnerMs = sampled.durationMs;
        keepRecord(entry, sampled);
        bindings = (sampled.result as Record<string, unknown>) || {};
        if (Object.keys(bindings).length > 0) entry.bindings = bindings;
      }
      for (const flow of flows) {
        if (!flow.condition) continue;
        const verdict = this.evaluate(flow.condition, id, bindings);
        ((entry.conditionExpressions ??= []) as unknown[]).push({
          sequenceFlow: flow.id, conditionExpression: flow.condition.body, held: verdict === true,
        });
        this.log(thread, 'conditionExpression.evaluated', `    ${flow.condition.body} → ${verdict === true}  [${flow.id}]`, { level: 'debug' });
        if (verdict === true) return take(flow, flow.condition.body);
      }
    } catch (error) {
      this.steps.fail(entry, error);
      throw error;
    }

    // No condition held: the default flow, else the one flow without a condition.
    const chosen = flows.find((flow) => flow.id === element.attributes.default);
    if (chosen) return take(chosen, 'default', { default: true });
    const bare = flows.filter((flow) => !flow.condition);
    if (bare.length === 1) return take(bare[0], 'otherwise', { otherwise: true });
    entry.status = 'stuck';
    this.steps.end(entry);
    this.steps.status = 'error';
    throw new Error(`${id}: no condition held, and there is no default flow or single flow without a condition`);
  }

  // --- values and scopes ---

  /** A value under an element's id. A data edge into a declared property writes the study state too:
   * `state.<scope>.<name>`, wherever the value came from. */
  store(id: string, value: unknown): void {
    this.values.set(id, value);
    const declared = this.graph.propertyScope(id);
    if (declared) (this.state[declared.scope] ??= {})[declared.name] = value;
  }

  /**
   * A value written under a property's name by whatever runs `from` (a runner in the walk's own process has no state
   * file to hand back): into the innermost scope around `from` that declares the name, which is returned, or
   * nowhere when none does. A property the Parameters wired into a sub-process set is not written.
   */
  write(name: string, value: unknown, from: string): string | undefined {
    const scope = this.graph.scopeChain(from).find((candidate) => this.graph.properties.get(candidate)?.has(name));
    if (!scope) return undefined;
    if (this.graph.readonly.get(scope)?.has(name)) {
      throw new Error(`'${name}' is set by the Parameters wired into ${scope}, so nothing inside it writes it.`);
    }
    const declared = this.graph.properties.get(scope)!.get(name)!;
    (this.state[scope] ??= {})[name] = value;
    if (declared.id) this.values.set(declared.id, value);
    return scope;
  }

  /** The properties in scope of an element, by name: what `{name}` and a condition read there. */
  inScope(id: string): Record<string, unknown> {
    const declared = Object.fromEntries(this.graph.scopeChain(id).reverse()
      .flatMap((scope) => [...(this.graph.properties.get(scope)?.keys() ?? [])].map((name) => [name, undefined])));
    return { ...declared, ...this.scopeValues(id) };
  }

  /** What an expression reads: `state`, then every element's value by its id and by its name. */
  private namespace(): Record<string, unknown> {
    const space: Record<string, unknown> = { state: { ...this.state, trace: [...this.trace] } };
    for (const [id, value] of this.values) {
      space[id] = value;
      const name = this.graph.plan.names[id];
      if (name) space[name] = value;
    }
    return space;
  }

  /** The properties in scope of an element, the innermost winning. */
  private scopeValues(id: string): Record<string, unknown> {
    const space: Record<string, unknown> = {};
    for (const scope of this.graph.scopeChain(id).reverse()) {
      const held = this.state[scope] ?? {};
      for (const name of this.graph.properties.get(scope)?.keys() ?? []) if (name in held) space[name] = held[name];
    }
    return space;
  }

  /** A FEEL expression's value. `language` is BPMN's per-expression attribute: unset or FEEL, else refused. `scope` is
   * the evaluating element: the properties declared on it and its containers are bound by name. */
  evaluate(expression: Expression, scope?: string, extra: Record<string, unknown> = {}): unknown {
    if (expression.language && !expression.language.toLowerCase().includes('feel')) {
      throw new Error(`a ${expression.language} expression — every Studyflow expression is FEEL`);
    }
    const { value, error } = evaluateFeel(expression.body, { ...this.namespace(), ...(scope ? this.scopeValues(scope) : {}), ...extra });
    if (error) throw new Error(error);
    return value;
  }

  /** Initialise the scope's properties from `value`; `reset` re-initialises ones the tree already holds. */
  private startScope(id: string, reset: boolean, thread: Thread): void {
    for (const [name, declared] of this.graph.properties.get(id) ?? []) {
      if (declared.value === undefined) continue;
      if (name.startsWith('_')) {
        this.log(thread, 'state.reserved', `    ${id}.${name}: names starting with _ are reserved`, { level: 'warning' });
        continue;
      }
      const held = (this.state[id] ??= {});
      if (reset || !(name in held)) {
        held[name] = structuredClone(declared.value);
        // The value space reads the same, so a hand-off cannot echo the pass before back into a reset scope.
        if (declared.id) this.values.set(declared.id, held[name]);
      }
    }
  }

  /** The JSON-able shadow of the run's values, for a runner's placeholders and intents, with the state tree under the
   * one key no element may take. */
  jsonValues(): Record<string, unknown> {
    const shadow: Record<string, unknown> = {};
    for (const [id, value] of this.values) {
      try {
        const json = JSON.stringify(value);
        if (json !== undefined) shadow[id] = JSON.parse(json);
      } catch { /* not JSON-able: it stays with the walk */ }
    }
    shadow.state = JSON.parse(JSON.stringify(this.state));
    return shadow;
  }

  /** What an activity sends: its data inputs by source id; one without a value this run gives its `uri`, else null. */
  private inputsOf(element: PlanElement): Record<string, unknown> | null {
    const sources = element.inputs.map((input) => input.source);
    return sources.length === 0 ? null : Object.fromEntries(sources.map((source) => [source, this.inputValue(source)]));
  }

  /** A data input's value: a declared property's from its scope (a list pass's item), else what the element holds
   * this run, else its `uri`. */
  private inputValue(source: string): unknown {
    const declared = this.graph.propertyScope(source);
    if (declared && !this.values.has(source)) return this.state[declared.scope]?.[declared.name] ?? null;
    return this.values.has(source) ? this.values.get(source) : this.graph.uriOf(source) ?? null;
  }

  /** A result the walk took itself (a message's content): under the element's id, and into each data output,
   * narrowed by that edge's `transformation` (`upper case(result)`); a null result stays null. */
  private bindResult(element: PlanElement, value: unknown): void {
    this.store(element.id, value);
    for (const { target, transformation, language } of element.outputs) {
      if (!target) continue;
      const narrowed = value !== null && value !== undefined && transformation
        ? this.evaluate({ body: transformation, language }, element.id, { result: value })
        : value;
      this.store(target, narrowed);
    }
  }

  // --- messages: the walk carries every one, along the flow it names ---

  private notify(): void {
    for (const wake of [...this.waiting]) wake();
  }

  /** Resolves when something a wait may depend on has changed: a message arrived, a pool ended or failed. */
  private changed(): Promise<void> {
    return new Promise((resolve) => {
      const wake = (): void => { this.waiting.delete(wake); resolve(); };
      this.waiting.add(wake);
    });
  }

  /** A message along a flow: into the flow's mailbox, or, when a runner plays the pool it ends at, to that runner,
   * whose answer goes back along the pool's flow to the sender. */
  private async send(flow: PlanElement, content: unknown, thread: Thread, options: { id?: string; inReplyTo?: string } = {}): Promise<void> {
    const { graph, host } = this;
    const target = flow.attributes.targetRef ?? '';
    const message: Message = { id: options.id ?? `${flow.id}.${this.sent += 1}`, flow: flow.id, content };
    if (options.inReplyTo) message.inReplyTo = options.inReplyTo;
    this.log(thread, 'message.sent', `    ✉ ${flow.attributes.sourceRef} → ${target}  [${message.id}]`, { level: 'debug', data: { message } });
    const pool = graph.participants.get(target);
    if (pool && host.claim(target)) return this.serve(pool, flow, message, thread);
    if (pool && !pool.attributes.processRef) {
      this.log(thread, 'message.unplayed', `    ✉ no runner plays ${pool.name || target}, so ${message.id} goes unanswered`, { level: 'warning' });
    }
    this.mail.set(flow.id, [...(this.mail.get(flow.id) ?? []), message]);
    this.notify();
  }

  /** One message to a pool a runner plays, recorded as a step of its own, one at a time to each pool. A pool that
   * fails answers null, so the sender goes on and the record keeps the error. */
  private async serve(pool: PlanElement, flow: PlanElement, message: Message, thread: Thread): Promise<void> {
    const { graph, host } = this;
    const name = pool.name || pool.id;
    const entry = this.steps.begin(pool.id, name, 'bpmn:Participant');
    entry.message = message.id;
    const turn = (this.serving.get(pool.id) ?? Promise.resolve()).then(async () => {
      try {
        const answered = await host.perform(pool.id, { ...this.jsonValues(), message }, { note: this.note(thread) });
        entry._runnerMs = answered.durationMs;
        keepRecord(entry, answered);
        const reply = answered.result ?? null;
        if (typeof reply === 'string') entry.reply = reply.slice(0, 2000); // what the pool said, kept with the run's records
        this.log(thread, 'message.answered', `    ✉ ${name} answered ${message.id}`, { data: { pool: pool.id, inReplyTo: message.id, reply } });
        return reply;
      } catch (error) {
        entry.status = 'error';
        entry.error = { type: (error as Error)?.name ?? 'Error', message: String((error as Error)?.message ?? error).slice(0, 400) };
        this.log(thread, 'message.unanswered', `    ✉ ${name} could not answer ${message.id}: ${(error as Error)?.message ?? error}`, { level: 'error' });
        return null;
      }
    });
    this.serving.set(pool.id, turn);
    const reply = await turn;
    this.steps.end(entry);
    const flows = graph.flowsOut.get(pool.id) ?? [];
    const sender = flow.attributes.sourceRef ?? '';
    const back = flows.find((candidate) => candidate.attributes.targetRef === sender)
      ?? flows.find((candidate) => graph.poolOf(candidate.attributes.targetRef ?? '') === graph.poolOf(sender));
    if (back) await this.send(back, reply, thread, { inReplyTo: message.id });
  }

  /** The next message along one of `flows`, waited for. A message at a boundary event of an activity around it ends
   * the wait, and so does a failed pool, or senders that have nothing left to send. */
  private async receive(id: string, flows: PlanElement[], thread: Thread): Promise<Message> {
    for (;;) {
      this.checkInterrupt(thread);
      for (const flow of flows) {
        const message = this.mail.get(flow.id)?.shift();
        if (message) {
          // What this pool sends back to the sender's pool answers this message.
          thread.heard.set(this.graph.poolOf(flow.attributes.sourceRef ?? ''), message.id);
          return message;
        }
      }
      this.expectMore(id, flows);
      await this.changed();
    }
  }

  /** An event-based gateway's branch: the one whose event happens first. Each branch starts at a catch event or a
   * receive task a message flow reaches; the first message along one picks that branch, and stays in its mailbox for
   * the step to take. Messages already waiting go by the branches' order. */
  private async race(gateway: string, flows: PlanElement[], thread: Thread): Promise<PlanElement> {
    const branches = flows.map((flow) => {
      const target = flow.attributes.targetRef ?? '';
      const into = this.graph.flowsIn.get(target) ?? [];
      if (into.length === 0) {
        throw new Error(`${gateway}: an event-based gateway waits for messages, and ${target} takes none. `
          + 'Start each branch with a catch event or a receive task a message flow reaches.');
      }
      return { flow, into };
    });
    for (;;) {
      this.checkInterrupt(thread);
      const first = branches.find(({ into }) => into.some((flow) => this.mail.get(flow.id)?.length));
      if (first) return first.flow;
      this.expectMore(gateway, branches.flatMap(({ into }) => into));
      await this.changed();
    }
  }

  /** Throws when no message will come along `flows`: a pool failed, or every sender has nothing left to send. */
  private expectMore(id: string, flows: PlanElement[]): void {
    if (this.failed !== undefined) throw new Error(`${id}: no message will come, another pool failed`);
    // A pool no process depicts only answers what is sent to it, and that answer is already here. A pool with a
    // process still has its own message to send until its walk ends, so a wait on it holds while it runs.
    const spent = (flow: PlanElement): boolean => {
      const source = flow.attributes.sourceRef ?? '';
      const pool = this.graph.poolOf(source);
      return this.poolsDone.has(pool) || (pool === source && this.graph.participants.has(source));
    };
    if (flows.every(spent)) throw new Error(`${id} waits along ${flows.map((flow) => flow.id).join(', ')}, and nothing is left to send`);
  }

  private answering(flow: PlanElement, thread: Thread): string | undefined {
    return thread.heard.get(this.graph.poolOf(flow.attributes.targetRef ?? ''));
  }

  /** Throws when a message waits at a boundary event of an activity this pool is inside, innermost first. */
  private checkInterrupt(thread: Thread): void {
    for (const { activity, flows } of [...thread.watching].reverse()) {
      for (const [flow, boundary] of flows) {
        if (this.mail.get(flow)?.length) {
          this.mail.get(flow)!.shift();
          throw new Interrupted(activity, boundary);
        }
      }
    }
  }

  /** A throw or end event sends a message along each flow out of it, carrying nothing but its arrival. */
  private async throwMessages(element: PlanElement, thread: Thread): Promise<void> {
    for (const flow of this.graph.flowsOut.get(element.id) ?? []) {
      await this.send(flow, null, thread, { inReplyTo: this.answering(flow, thread) });
    }
  }

  /** What a claimed element exchanges while its runner runs, along `talking`'s flows: the element's own, or an
   * enclosing sub-process's or pool's. */
  private talk(id: string, talking: string, thread: Thread): Talk & { delivered(): Promise<unknown> } {
    const sending: Promise<void>[] = [];
    const out = new Map((this.graph.flowsOut.get(talking) ?? []).map((flow) => [flow.id, flow]));
    const into = (this.graph.flowsIn.get(talking) ?? []).map((flow) => flow.id);
    return {
      send: (line) => {
        const flow = typeof line?.flow === 'string' ? out.get(line.flow) : undefined;
        if (!flow) {
          this.log(thread, 'message.misrouted', `    ✉ ${id} sent ${JSON.stringify(line).slice(0, 80)} along none of its flows`, { level: 'warning' });
          return;
        }
        const delivery = this.send(flow, line.content ?? null, thread, { id: line.id, inReplyTo: line.inReplyTo });
        delivery.catch(() => undefined); // heard in `delivered`, when the runner's own failure does not come first
        sending.push(delivery);
      },
      take: () => into.flatMap((flow) => this.mail.get(flow)?.splice(0) ?? []),
      delivered: () => Promise.all(sending),
    };
  }

  private log(thread: Thread, event: string, message: string, detail?: Parameters<Note>[2]): void {
    this.host.log(event, `${'  '.repeat(thread.depth + 1)}${message}`, detail);
  }

  /** The log, at the depth a pool's walk is at. */
  private note(thread: Thread): Note {
    return (event, message, detail) => this.log(thread, event, message, detail);
  }

  /** Ends the run from outside (the person stopped it): every wait fails, and each pool stops at its next step. */
  abort(reason: Error): void {
    this.failed ??= reason;
    this.notify();
  }
}

/** A hand-off's `record`, what the runner ran with (a package version, a model digest, the request as sent), merged
 * into its step's record entry and never read as a value; the walk's own keys stand. */
function keepRecord(entry: Entry, handed: Record<string, unknown>): void {
  const { record } = handed;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return;
  for (const [key, value] of Object.entries(record)) if (!(key in entry)) entry[key] = value;
}
