import { PLACEHOLDER } from '@core/document/state';
import { allocationOf, draw, permutedBlock, pick, type Allocation } from '@core/engine/allocation';
import { CONTAINER_TYPES, GATEWAY_TYPES, Graph, PASSTHROUGH_TYPES } from '@core/engine/graph';
import { HandoffError, Interrupted, keepRecord, logAt, type Handback, type Host, type Note, type StateTree, type Talk, type Thread, type WalkOptions } from '@core/engine/host';
import type { Plan, PlanElement } from '@core/engine/plan';
import { Post } from '@core/engine/post';
import { Steps, type Entry } from '@core/engine/steps';
import { timerDelay } from '@core/engine/timer';
import { Values } from '@core/engine/values';

/**
 * The walk: one study, walked as the notation says. It is the one engine behind every runtime: the local runtime
 * hosts it and hands each claimed element to a partial runner (skills/local/SKILL.md), the browser runtime hosts it
 * and shows each step as a screen, and the modeler hosts it as a dry run. It executes nothing itself and does no I/O:
 * a host says who claims an element and performs it, keeps the records, and decides what a re-run may reuse.
 *
 * Every pool with a process is walked at once, each as its own task, one path per pool. The pools talk only along
 * message flows, and the walk carries every message.
 */

const bpmnType = (element: PlanElement): string => `bpmn:${element.type.charAt(0).toUpperCase()}${element.type.slice(1)}`;

const has = (element: PlanElement, definition: string): boolean => (element.events ?? []).includes(definition);

export class Walk {
  readonly graph: Graph;
  readonly steps = new Steps();
  /** The `state` tree: `state.<scope>.<property>`, and `state._meta`, the walk's own. */
  /** When each activity finished, each event was reached, and which flow each gateway took. */
  readonly completed = new Map<string, string>();
  readonly reached = new Map<string, string>();
  readonly decisions = new Map<string, { flow: string; when: string }>();
  /** Every element that never skips or replays: a live runner's, one that exchanges messages, one that repeats. */
  readonly live = new Set<string>();
  readonly allocations = new Map<string, Allocation>();

  private readonly host: Host;
  private readonly seed: number | undefined;
  private readonly maxSteps: number;
  private readonly oneInstance: boolean;
  private readonly blocks = new Map<string, number[]>();
  private readonly memory: Values;
  private readonly post: Post;

  constructor(plan: Plan, host: Host, options: WalkOptions = {}) {
    this.host = host;
    this.graph = new Graph(plan);
    this.memory = new Values(this.graph, options.state ?? {});
    this.post = new Post(this.graph, host, this.steps, this.memory);
    this.maxSteps = options.maxSteps ?? 1000;
    this.oneInstance = options.oneInstance ?? false;
    const seed = Number((options.seed === undefined ? plan.study.seed : options.seed) ?? NaN);
    this.seed = Number.isInteger(seed) ? seed : undefined; // unseeded: `Math.random()`, and a re-run replays the recorded decision instead

    const { graph } = this;
    // Each random gateway's allocation, read before the walk: one it cannot apply stops the run here.
    for (const gateway of Object.values(graph.elements)) {
      if (GATEWAY_TYPES.has(gateway.type) && gateway.branching === 'random') {
        this.allocations.set(gateway.id, allocationOf(gateway, (graph.outgoing.get(gateway.id) ?? []).length));
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
      if (!CONTAINER_TYPES.has(graph.elements[scope]?.type ?? 'process')) this.memory.startScope(scope, false, this.note({ pool: '', depth: 0, watching: [], heard: new Map() }));
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
    const thread: Thread = { pool, depth: 0, watching: [], heard: new Map() };
    const { participant, instances: drawn } = graph.instancesOf(pool);
    const instances = this.oneInstance ? 1 : drawn;
    const start = graph.entryOf(pool);
    for (let instance = 1; instance <= instances; instance += 1) {
      if (instances > 1) {
        // Which instance this is, for whatever runs inside: `state._meta.instance.<pool id>`, 1-based.
        this.memory.meta('instance')[participant] = instance;
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
        this.memory.trace.push(id);
        this.memory.count(id);
        this.post.checkInterrupt(thread);
        const name = graph.nameOf(id);

        if (type === 'endEvent') {
          const entry = this.steps.begin(id, name, bpmnType(element));
          // A runner may claim the end too: its chance to fold what it started for the study.
          if (host.claim(id)) await this.executeViaRunner(element, entry, thread);
          await this.post.throwFrom(element, thread);
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
              this.adopt(id, await this.handOff(id, this.memory.json(), thread), entry);
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
            if (error instanceof Interrupted) this.steps.end(entry);
            else this.steps.fail(entry, error);
            throw error;
          }
          await this.post.throwFrom(element, thread);
          this.steps.end(entry);
          this.reached.set(id, host.now());
          this.log(thread, 'event.reached', `○ ${id}`);
        } else {
          const boundary = await this.perform(element, depth, thread);
          if (boundary) {
            // The activity ended at one of its boundary events: the walk goes on from there.
            this.memory.trace.push(boundary.id);
            this.memory.count(boundary.id);
            this.reached.set(boundary.id, host.now());
            await host.moved?.(boundary.id, undefined, thread.pool);
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
    const due: PlanElement[] = [];
    thread.watching.push({
      activity: id,
      flows: new Map((graph.boundaries.get(id) ?? [])
        .flatMap((boundary) => (graph.flowsIn.get(boundary.id) ?? []).map((flow): [string, PlanElement] => [flow.id, boundary]))),
      due,
    });
    // A timer at a boundary event runs from the moment the activity is entered; when its time comes it ends the
    // activity, stopping the hand-off the pool is waiting on.
    const timers = (graph.boundaries.get(id) ?? []).filter((boundary) => boundary.timer)
      .map((boundary) => this.post.timer(this.timerMs(boundary), boundary.id, () => { due.push(boundary); thread.handoff?.abort(); }));
    try {
      let passes = 0;
      const listed = this.loopList(element);
      const outputs: unknown[] = [];
      while (listed ? passes < listed.items.length : this.loopsAgain(element, passes)) {
        passes += 1;
        if (passes > this.maxSteps) throw new Error(`${id}: loop budget exhausted — does its loop ever end?`);
        // Which pass this is, for whatever runs inside: `state._meta.instance.<id>`, 1-based.
        if (element.loop) this.memory.meta('instance')[id] = passes;
        if (listed) {
          // The pass's item in the activity's own scope, `{C}` to the steps inside, and no output yet.
          const held = (this.memory.state[id] ??= {});
          if (listed.item) held[listed.item] = listed.items[passes - 1];
          if (listed.output) delete held[listed.output];
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
      Object.assign(held, written);
    }
    for (const [key, value] of Object.entries(handed.values ?? {})) this.memory.store(key, value);
    if (handed.result !== undefined) this.memory.store(id, handed.result);
  }

  /** One hand-off to the host, which a timer at a boundary event of an activity around it may stop: the walk then
   * leaves for that event, whatever the hand-off had done. */
  private async handOff(id: string, values: Record<string, unknown>, thread: Thread, talk?: Talk): Promise<Handback> {
    const handoff = thread.handoff = new AbortController();
    try {
      return await this.host.perform(id, values, { talk, note: this.note(thread), signal: handoff.signal });
    } finally {
      thread.handoff = undefined;
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

  private async next(element: PlanElement, thread: Thread): Promise<PlanElement | undefined> {
    const { graph, host } = this;
    const { id } = element;
    const flows = graph.outgoing.get(id) ?? [];
    if (flows.length === 0) return undefined;
    if (!GATEWAY_TYPES.has(element.type)) return this.follow(flows[0], thread);

    // A clean gateway replays its recorded decision: same inputs, same seed, same verdict. A gateway a live runner
    // samples decides live, so its decision never replays.
    const prior = this.live.has(id) ? undefined : host.reuse?.decision(id);
    const replayed = prior && flows.find((flow) => flow.id === prior.flow);
    if (prior && replayed) {
      this.log(thread, 'gateway.replayed', `↻ ${id} → ${prior.flow}  (decision from run ${prior.run})`);
      host.settled?.({ action: 'reused', id, flow: prior.flow, when: host.now(), run: prior.run });
      return this.follow(replayed, thread);
    }
    const entry = this.steps.begin(id, graph.nameOf(id), bpmnType(element));

    /** Record the decision and how it was made, then follow `flow`. */
    const take = (flow: PlanElement, how: string, marks: Record<string, boolean> = {}): Promise<PlanElement | undefined> => {
      entry.taken = { sequenceFlow: flow.id, name: flow.name, ...marks };
      this.steps.end(entry);
      const when = host.now();
      this.decisions.set(id, { flow: flow.id, when });
      this.log(thread, 'sequenceFlow.taken', `    ${how} → ${flow.id}`, { data: { element: id, flow: flow.id, how } });
      host.settled?.({ action: 'executed', id, flow: flow.id, when });
      return this.follow(flow, thread);
    };

    if (element.type === 'eventBasedGateway') {
      this.log(thread, 'event.waiting', `    (waiting for the first message along ${flows.length} branches)`);
      try {
        return take(await this.post.race(id, flows, thread), 'first message', { message: true });
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
      const visit = this.memory.meta('reached')[id] ?? 1;
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
        if (verdict === true) return take(flow, flow.condition.body);
      }
    } catch (error) {
      const chosen = host.decide?.(id, flows.map((flow) => flow.id), error as Error);
      const decided = flows.find((flow) => flow.id === chosen);
      if (decided) return take(decided, 'decided by the host');
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

  /** A value under a property's name, into the innermost scope around `from` that declares it; that scope, if any. */
  write(name: string, value: unknown, from: string): string | undefined {
    return this.memory.write(name, value, from);
  }

  /** The properties in scope of an element, by name. */
  inScope(id: string): Record<string, unknown> {
    return this.memory.inScope(id);
  }
}
