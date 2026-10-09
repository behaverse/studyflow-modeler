import { Graph, Walk, type Handback, type Host, type Message, type PlanElement, type RunEvent, type StateTree } from '@core/engine';
import { evaluateFeel } from '@core/expression/feel';
import { findByFlowNode, waitsForTime } from '@runner/nodes/registry';
import type { Job } from '@runner/jobs';
import type { Studyflow } from '@runner/studyflow';

export type SessionContext = {
  seed?: number;
  /** Which instance of its pool this session is (`?participant=`), 1 when not given. */
  participant?: number;
  variables?: Record<string, unknown>;
  agentId?: string;
  sessionId?: string;
  onDiagnostic?: (message: string) => void;
  /** A timer ended the screen on show: a timer event's wait is over, or a timer at a boundary event ended the step on
   * screen. The page drops the screen and asks for the next job. */
  onExpired?: (id: string) => void;
};

/** A step the page refused to finish (the participant declined consent): the run stops there, unless the step
 * carries an error boundary event to leave by. */
export class Aborted extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'Aborted';
  }
}

const STUDYFLOW = 'http://behaverse.org/schemas/studyflow/v1';

/** The pools the person at the page plays: no process of their own, and a human actor (a pool says `actorType`, and
 * is human when it says none). What the study sends one is asked on a screen, and the answer goes back. */
export function peopleOf(elements: Record<string, PlanElement>): Set<string> {
  return new Set(Object.values(elements).filter((element) => {
    if (element.type !== 'participant' || element.attributes.processRef) return false;
    const actor = element.extensions.find((extension) => extension.namespace === STUDYFLOW && extension.type === 'actor');
    return (actor?.attributes.actorType ?? 'human') === 'human' && !actor?.attributes.implementation;
  }).map((element) => element.id));
}

/**
 * One participant's run in the page: this runtime's host of the walk (packages/core/src/engine), the engine the
 * local runtime hosts too. A step a node module has a screen for is a claimed element, and its hand-off is that
 * screen: `traverse` yields its job, and asking for the next job says the screen is done. A pool the person plays
 * is claimed too: each message the study sends it is a screen, and what the person answers is the reply. A step
 * that exchanges messages has no screen of its own, so the walk sends and receives for it. A timer event is never
 * claimed: the walk waits for its time, and its screen shows the wait meanwhile (`wait`). Every event of the run is
 * kept, the record a local run keeps in `events.jsonl` (`getRecord`).
 */
export class Session {
  studyflow: Studyflow;
  agentId?: string;
  sessionId?: string;

  private readonly walk: Walk;
  private readonly jobs = new Map<string, Job>();
  /** The screens of the timer events, each shown while the walk waits for its time. */
  private readonly waits = new Map<string, Job>();
  private readonly undeclared = new Set<string>();
  private readonly onDiagnostic?: (message: string) => void;
  private readonly onExpired?: (id: string) => void;
  /** The pools the person plays, and the run's record. */
  private readonly people: Set<string>;
  private readonly events: RunEvent[] = [];
  /** The element whose screen is up: where a value it publishes is written from. */
  private serving: string | undefined;
  /** What the person answered the message on screen. */
  private replied: unknown = null;
  private show: (id: string, job: Job | undefined, signal?: AbortSignal) => Promise<unknown> = () => Promise.reject(new Error('the session is not running'));
  /** The screens asked for, one at a time: a step on another path of the walk waits for the one on screen. */
  private turn: Promise<unknown> = Promise.resolve();
  private refuse: (reason: string) => void = () => undefined;

  constructor(studyflow: Studyflow, context: SessionContext = {}) {
    this.studyflow = studyflow;
    this.agentId = context.agentId;
    this.sessionId = context.sessionId;
    this.onDiagnostic = context.onDiagnostic;
    this.onExpired = context.onExpired;

    const { elements, processes } = studyflow.plan;
    const graph = new Graph(studyflow.plan);
    this.people = peopleOf(elements);
    for (const node of studyflow.flowNodes.values()) {
      // A sub-process ends where its end event is: the screen that closes a session is the study's own end.
      if (node.type === 'bpmn:EndEvent' && !processes.includes(elements[node.id]?.parent ?? '')) continue;
      const definition = findByFlowNode(node);
      // A step with no screen of its own that exchanges messages does so through the walk, not a Continue button.
      const exchanged = graph.exchange(elements[node.id]);
      if (definition && 'fallback' in definition.match && exchanged.outgoing.length + exchanged.incoming.length > 0) continue;
      const job = (definition?.toJob(node) as Job | null | undefined) ?? undefined;
      if (job) (waitsForTime(node) ? this.waits : this.jobs).set(node.id, job);
      else if (definition) this.diagnose(`'${node.id}' (${definition.type}) has nothing to run; step skipped`);
    }
    const host: Host = {
      claim: (id) => (this.jobs.has(id) ? { name: this.jobs.get(id)!.type, live: true } : this.people.has(id) ? { name: 'person', live: true } : undefined),
      perform: async (id, _values, { message, signal }) => {
        const job = message ? this.messageJob(id, message) : undefined;
        const shown = this.turn.then(() => {
          if (signal?.aborted) throw new Aborted('its time ran out');
          return this.show(id, job, signal);
        });
        this.turn = shown.catch(() => undefined);
        const replied = await shown;
        if (message) return { result: replied };
        return replied === null ? {} : this.handback(studyflow.plan.elements[id], replied);
      },
      wait: (ms, signal, at) => this.wait(ms, signal, at),
      record: (event) => this.events.push(event),
      log: (_event, message, detail) => {
        if (detail?.level === 'warning' || detail?.level === 'error') this.diagnose(message.trim());
      },
      now: () => new Date().toISOString(),
    };
    // A session is one participant: one instance of its pool, whatever the pool's multiplicity.
    this.walk = new Walk(studyflow.plan, host, { seed: context.seed, participant: context.participant, state: structuredClone(studyflow.state), oneInstance: true });
    for (const [name, value] of Object.entries(context.variables ?? {})) this.setVariable(name, value);
  }

  /** How a node publishes what it collected: into the nearest scope around its step that declares `name`, else with
   * the study, where it is kept and reported as undeclared. */
  setVariable(name: string, value: unknown): void {
    const [root] = this.studyflow.plan.processes;
    if (this.walk.write(name, value, this.serving ?? root)) return;
    this.undeclared.add(name);
    this.walk.store(name, value);
    this.walk.set(root, name, value);
  }

  /** Whether the study has a random gateway, which draws for the participant this session is. */
  get draws(): boolean {
    return this.walk.allocations.size > 0;
  }

  /** The `state` tree as the run has left it (never written back to the file by this runtime). */
  getState(): StateTree {
    return this.walk.state;
  }

  /** The values in scope of the step on screen, by name; between steps, the study's own. */
  getVariables(): Record<string, unknown> {
    const [root] = this.studyflow.plan.processes;
    const kept = Object.fromEntries([...this.undeclared].map((name) => [name, this.walk.state[root]?.[name]]));
    return { ...kept, ...this.walk.inScope(this.serving ?? root) };
  }

  getUndeclaredVariables(): string[] {
    return [...this.undeclared];
  }

  /** The run's record: its events so far (packages/core/src/engine/record.ts), as a local run keeps them. */
  getRecord(): readonly RunEvent[] {
    return this.events;
  }

  /** What the screen on show answers: for a message, the reply its sender gets; for a step, its result. */
  answer(reply: unknown): void {
    this.replied = reply;
  }

  /** A step's result, and each of its data outputs narrowed by that edge's `transformation`, as a runner binds them. */
  private handback(element: PlanElement, result: unknown): Handback {
    const values: Record<string, unknown> = {};
    for (const { target, transformation } of element.outputs) {
      if (!target) continue;
      if (!transformation) {
        values[target] = result;
        continue;
      }
      // FEEL over `result` and the properties in scope, as the walk narrows what a step it runs itself makes.
      const { value, error } = evaluateFeel(transformation, { ...this.walk.inScope(element.id), result });
      if (error) throw new Error(`${element.id}: ${error}`);
      values[target] = value;
    }
    return { result, values };
  }

  /** A timer's wait, `ms` by the machine's clock. A timer event's screen shows it meanwhile, told when the wait ends
   * (`until`), until the time comes or the walk stops waiting (a boundary event of an activity around it ended it):
   * then the page is told to drop it. The screen never ends the wait. */
  private wait(ms: number, signal: AbortSignal, at: string): Promise<void> {
    const waited = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    });
    const job = this.waits.get(at);
    if (job) {
      const until = Date.now() + ms;
      const over = new AbortController();
      const end = (): void => over.abort();
      signal.addEventListener('abort', end, { once: true });
      void waited.then(end);
      // Its turn may come after its time, when the screen before it outlasted the wait: it is then not shown.
      const shown = this.turn.then(() => (over.signal.aborted ? undefined : this.show(at, { ...job, until } as Job, over.signal)));
      this.turn = shown.catch(() => undefined);
    }
    return waited;
  }

  /** The screen of one message to a pool the person plays. */
  private messageJob(pool: string, message: Message): Job {
    const { model } = this.studyflow;
    const element = model.get(pool) ?? { type: 'bpmn:Participant', id: pool };
    const node = { id: pool, type: 'bpmn:Participant', element, model, parameters: {}, outgoing: [], incoming: [] };
    const job = findByFlowNode(node)?.toJob(node) as Job | null | undefined;
    if (!job) throw new Error(`the page has no screen to answer a message to '${element.name || pool}'`);
    return { ...job, message } as unknown as Job;
  }

  /** The run, one job at a time: the walk goes on when the next job is asked for. Leaving the loop ends the run. */
  async *traverse(): AsyncGenerator<Job, void, void> {
    let shown: (() => void) | undefined;
    const offered: (Job | Error | null)[] = [];
    let wake: (() => void) | undefined;
    const offer = (next: Job | Error | null): void => { offered.push(next); wake?.(); };
    this.show = (id, job, signal) => new Promise((resolve, reject) => {
      this.serving = id;
      this.replied = null;
      shown = () => { this.serving = undefined; resolve(this.replied); };
      this.refuse = (reason) => { this.serving = undefined; reject(new Aborted(reason)); };
      signal?.addEventListener('abort', () => { this.refuse('its time ran out'); this.onExpired?.(id); }, { once: true });
      offer(job ?? this.jobs.get(id)!);
    });
    const now = (): string => new Date().toISOString();
    this.events.push({ event: 'started', at: now(), run: this.sessionId ?? 'session', state: structuredClone(this.walk.state), stamp: { action: 'executed', when: now(), run: this.sessionId } });
    const finish = (status: 'ok' | 'error'): void => { this.events.push({ event: 'finished', at: now(), status }); };
    this.walk.run().then(
      () => { finish('ok'); offer(null); },
      (error) => { finish('error'); offer(error instanceof Error ? error : new Error(String(error))); },
    );
    try {
      for (;;) {
        while (offered.length === 0) await new Promise<void>((resolve) => { wake = resolve; });
        const next = offered.shift()!;
        if (next === null) return;
        if (next instanceof Error) throw next;
        yield next;
        shown?.();
      }
    } finally {
      this.walk.abort(new Error('the session ended'));
    }
  }

  /** Refuses the step on screen: its failure takes its error boundary event when it carries one, else it stops the run. */
  abort(reason: string): void {
    this.refuse(reason);
  }

  private diagnose(message: string): void {
    this.onDiagnostic?.(message);
    if (!this.onDiagnostic) console.warn(`[studyflow] ${message}`);
  }
}
