import type { Graph } from '@core/engine/graph';
import { Interrupted, keepRecord, logAt, type Conversation, type Host, type Message, type Talk, type Thread } from '@core/engine/host';
import type { PlanElement } from '@core/engine/plan';
import type { Happening } from '@core/engine/record';
import type { Steps } from '@core/engine/steps';
import type { Values } from '@core/engine/values';

/**
 * The messages between pools: the walk carries every one, along the flow it names. A message waits in its flow's
 * mailbox for the step that takes it; one sent to a pool a runner plays is that runner's to answer. A wait ends when
 * its message comes, when a message reaches a boundary event of an activity around it, or when none can come.
 */
export class Post {
  private readonly mail = new Map<string, Message[]>();
  private readonly waiting = new Set<() => void>();
  private readonly poolsDone = new Set<string>();
  private readonly serving = new Map<string, Promise<unknown>>();
  /** The exchanges each conversation with a pool that remembers has had this run. */
  private readonly turns = new Map<string, number>();
  private sent = 0;
  /** Why the run is ending, once a pool failed or the run was stopped: every wait fails with it. */
  failed: unknown;
  private readonly graph: Graph;
  private readonly host: Host;
  private readonly steps: Steps;
  private readonly values: Values;
  private readonly record: (happened: Happening) => void;

  constructor(graph: Graph, host: Host, steps: Steps, values: Values, record: (happened: Happening) => void = () => undefined) {
    this.graph = graph;
    this.host = host;
    this.steps = steps;
    this.values = values;
    this.record = record;
  }

  /** A pool's walk has ended: it sends nothing more. */
  ended(pool: string): void {
    this.poolsDone.add(pool);
    this.notify();
  }

  notify(): void {
    for (const wake of [...this.waiting]) wake();
  }

  /** Resolves when something a wait may depend on has changed: a message arrived, a pool ended or failed. */
  changed(): Promise<void> {
    return new Promise((resolve) => {
      const wake = (): void => { this.waiting.delete(wake); resolve(); };
      this.waiting.add(wake);
    });
  }

  /** A message along a flow: into the flow's mailbox, or, when a runner plays the pool it ends at, to that runner,
   * whose answer goes back along the pool's flow to the sender. */
  async send(flow: PlanElement, content: unknown, thread: Thread, options: { id?: string; inReplyTo?: string } = {}): Promise<void> {
    const { graph, host } = this;
    const target = flow.attributes.targetRef ?? '';
    const message: Message = { id: options.id ?? `${flow.id}.${this.sent += 1}`, flow: flow.id, content };
    if (options.inReplyTo) message.inReplyTo = options.inReplyTo;
    logAt(this.host, thread, 'message.sent', `    ✉ ${flow.attributes.sourceRef} → ${target}  [${message.id}]`, { level: 'debug' });
    this.record({ event: 'sent', message });
    const pool = graph.participants.get(target);
    if (pool && host.claim(target)) return this.serve(pool, flow, message, thread);
    if (pool && !pool.attributes.processRef) {
      logAt(this.host, thread, 'message.unplayed', `    ✉ no runner plays ${pool.name || target}, so ${message.id} goes unanswered`, { level: 'warning' });
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
    const conversation = this.conversationOf(pool, thread);
    const turn = (this.serving.get(pool.id) ?? Promise.resolve()).then(async () => {
      try {
        const asked = conversation && { ...conversation, turn: this.turns.get(conversation.id) ?? 0 };
        const answered = await host.perform(pool.id, this.values.json(), { message, conversation: asked, note: (event, text, detail) => logAt(this.host, thread, event, text, detail) });
        // An exchange that failed is no part of the conversation.
        if (asked) this.turns.set(asked.id, asked.turn + 1);
        keepRecord(entry, answered);
        const reply = answered.result ?? null;
        if (typeof reply === 'string') entry.reply = reply.slice(0, 2000); // what the pool said, kept with the run's records
        logAt(this.host, thread, 'message.answered', `    ✉ ${name} answered ${message.id}`);
        return reply;
      } catch (error) {
        entry.status = 'error';
        entry.error = { type: (error as Error)?.name ?? 'Error', message: String((error as Error)?.message ?? error).slice(0, 400) };
        logAt(this.host, thread, 'message.unanswered', `    ✉ ${name} could not answer ${message.id}: ${(error as Error)?.message ?? error}`, { level: 'error' });
        return null;
      }
    });
    this.serving.set(pool.id, turn);
    const reply = await turn;
    this.steps.end(entry);
    this.record({ event: 'answered', id: pool.id, entry });
    const flows = graph.flowsOut.get(pool.id) ?? [];
    const sender = flow.attributes.sourceRef ?? '';
    const back = flows.find((candidate) => candidate.attributes.targetRef === sender)
      ?? flows.find((candidate) => graph.poolOf(candidate.attributes.targetRef ?? '') === graph.poolOf(sender));
    if (back) await this.send(back, reply, thread, { inReplyTo: message.id });
  }

  /** The conversation a message from `thread` to `pool` belongs to, when the pool remembers: one per instance of the
   * asking pool, so a model answering one subject sees that subject's earlier messages and no other subject's. */
  private conversationOf(pool: PlanElement, thread: Thread): Omit<Conversation, 'turn'> | undefined {
    if (pool.memory !== 'conversation') return undefined;
    const { participant } = this.graph.instancesOf(thread.pool);
    const instance = (this.values.state._meta?.instance as Record<string, number> | undefined)?.[participant];
    return { id: `${pool.id} with ${participant}${instance ? ` #${instance}` : ''}` };
  }

  /** The next message along one of `flows`, waited for. A message at a boundary event of an activity around it ends
   * the wait, and so does a failed pool, or senders that have nothing left to send. */
  async receive(id: string, flows: PlanElement[], thread: Thread): Promise<Message> {
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
  async race(gateway: string, flows: PlanElement[], thread: Thread): Promise<PlanElement> {
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

  answering(flow: PlanElement, thread: Thread): string | undefined {
    return thread.heard.get(this.graph.poolOf(flow.attributes.targetRef ?? ''));
  }

  /** Resolves `ms` from now, by the host's clock or the machine's. */
  private wait(ms: number, signal: AbortSignal, at: string): Promise<void> {
    if (this.host.wait) return this.host.wait(ms, signal, at);
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => clearTimeout(timer));
    });
  }

  /** A timer: `then` once `ms` have passed, unless the returned controller aborts first. */
  timer(ms: number, at: string, then: () => void): AbortController {
    const stop = new AbortController();
    void this.wait(ms, stop.signal, at).then(() => {
      if (stop.signal.aborted) return;
      then();
      this.notify();
    });
    return stop;
  }

  /** A timer event's wait. A boundary event of an activity around it ends the wait, and so does a failed pool. */
  async sleep(ms: number, at: string, thread: Thread): Promise<void> {
    let due = false;
    const stop = this.timer(ms, at, () => { due = true; });
    try {
      while (!due) {
        this.checkInterrupt(thread);
        if (this.failed !== undefined) throw new Error(`${at}: the run ended while its timer ran`);
        await this.changed();
      }
    } finally {
      stop.abort();
    }
  }

  /** Throws when a boundary event of an activity this pool is inside has happened, innermost first: its timer has
   * run out, or (unless `timersOnly`) a message waits at it. */
  checkInterrupt(thread: Thread, timersOnly = false): void {
    for (const { activity, flows, due } of [...thread.watching].reverse()) {
      if (due.length > 0) throw new Interrupted(activity, due[0]);
      if (timersOnly) continue;
      for (const [flow, boundary] of flows) {
        if (this.mail.get(flow)?.length) {
          this.mail.get(flow)!.shift();
          throw new Interrupted(activity, boundary);
        }
      }
    }
  }

  /** A throw or end event sends a message along each flow out of it, carrying nothing but its arrival. */
  async throwFrom(element: PlanElement, thread: Thread): Promise<void> {
    for (const flow of this.graph.flowsOut.get(element.id) ?? []) {
      await this.send(flow, null, thread, { inReplyTo: this.answering(flow, thread) });
    }
  }

  /** What a claimed element exchanges while its runner runs, along `talking`'s flows: the element's own, or an
   * enclosing sub-process's or pool's. */
  talk(id: string, talking: string, thread: Thread): Talk & { delivered(): Promise<unknown> } {
    const sending: Promise<void>[] = [];
    const out = new Map((this.graph.flowsOut.get(talking) ?? []).map((flow) => [flow.id, flow]));
    const into = (this.graph.flowsIn.get(talking) ?? []).map((flow) => flow.id);
    return {
      send: (line) => {
        const flow = typeof line?.flow === 'string' ? out.get(line.flow) : undefined;
        if (!flow) {
          logAt(this.host, thread, 'message.misrouted', `    ✉ ${id} sent ${JSON.stringify(line).slice(0, 80)} along none of its flows`, { level: 'warning' });
          return;
        }
        const delivery = this.send(flow, line.content ?? null, thread, { id: line.id, inReplyTo: line.inReplyTo });
        delivery.catch(() => undefined); // heard in `delivered`, when the runner's own failure does not come first
        sending.push(delivery);
      },
      take: () => into.flatMap((flow) => this.mail.get(flow)?.splice(0) ?? []),
      arrived: () => this.changed(),
      delivered: () => Promise.all(sending),
    };
  }
}
