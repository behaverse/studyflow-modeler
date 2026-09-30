import { Walk, type Host, type StateTree } from '@core/engine';
import { findByFlowNode } from '@runner/nodes/registry';
import type { Job } from '@runner/jobs';
import type { Studyflow } from '@runner/studyflow';

export type SessionContext = {
  seed?: number;
  variables?: Record<string, unknown>;
  agentId?: string;
  sessionId?: string;
  onDiagnostic?: (message: string) => void;
  /** A timer at a boundary event ended the step on screen: the page drops the screen and asks for the next job. */
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

/**
 * One participant's run in the page: this runtime's host of the walk (packages/core/src/engine), the engine the
 * local runtime hosts too. A step a node module has a screen for is a claimed element, and its hand-off is that
 * screen: `traverse` yields its job, and asking for the next job says the screen is done.
 */
export class Session {
  studyflow: Studyflow;
  agentId?: string;
  sessionId?: string;

  private readonly walk: Walk;
  private readonly jobs = new Map<string, Job>();
  private readonly undeclared = new Set<string>();
  private readonly onDiagnostic?: (message: string) => void;
  private readonly onExpired?: (id: string) => void;
  /** The element whose screen is up: where a value it publishes is written from. */
  private serving: string | undefined;
  private show: (id: string) => Promise<void> = () => Promise.reject(new Error('the session is not running'));
  private refuse: (reason: string) => void = () => undefined;

  constructor(studyflow: Studyflow, context: SessionContext = {}) {
    this.studyflow = studyflow;
    this.agentId = context.agentId;
    this.sessionId = context.sessionId;
    this.onDiagnostic = context.onDiagnostic;
    this.onExpired = context.onExpired;

    const { elements, processes } = studyflow.plan;
    for (const node of studyflow.flowNodes.values()) {
      // A sub-process ends where its end event is: the screen that closes a session is the study's own end.
      if (node.type === 'bpmn:EndEvent' && !processes.includes(elements[node.id]?.parent ?? '')) continue;
      const definition = findByFlowNode(node);
      const job = (definition?.toJob(node) as Job | null | undefined) ?? undefined;
      if (job) this.jobs.set(node.id, job);
      else if (definition) this.diagnose(`'${node.id}' (${definition.type}) has nothing to run; step skipped`);
    }
    const host: Host = {
      claim: (id) => (this.jobs.has(id) ? { name: this.jobs.get(id)!.type, live: true } : undefined),
      perform: (id, _values, { signal }) => {
        signal?.addEventListener('abort', () => { this.refuse('its time ran out'); this.onExpired?.(id); });
        return this.show(id).then(() => ({}));
      },
      log: (_event, message, detail) => {
        if (detail?.level === 'warning' || detail?.level === 'error') this.diagnose(message.trim());
      },
      now: () => new Date().toISOString(),
    };
    // A session is one participant: one instance of its pool, whatever the pool's multiplicity.
    this.walk = new Walk(studyflow.plan, host, { seed: context.seed, state: structuredClone(studyflow.state), oneInstance: true });
    for (const [name, value] of Object.entries(context.variables ?? {})) this.setVariable(name, value);
  }

  /** How a node publishes what it collected: into the nearest scope around its step that declares `name`, else with
   * the study, where it is kept and reported as undeclared. */
  setVariable(name: string, value: unknown): void {
    const [root] = this.studyflow.plan.processes;
    if (this.walk.write(name, value, this.serving ?? root)) return;
    this.undeclared.add(name);
    this.walk.store(name, value);
    (this.walk.state[root] ??= {})[name] = value;
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

  /** The run, one job at a time: the walk goes on when the next job is asked for. Leaving the loop ends the run. */
  async *traverse(): AsyncGenerator<Job, void, void> {
    let shown: (() => void) | undefined;
    const offered: (Job | Error | null)[] = [];
    let wake: (() => void) | undefined;
    const offer = (next: Job | Error | null): void => { offered.push(next); wake?.(); };
    this.show = (id) => new Promise((resolve, reject) => {
      this.serving = id;
      shown = () => { this.serving = undefined; resolve(); };
      this.refuse = (reason) => { this.serving = undefined; reject(new Aborted(reason)); };
      offer(this.jobs.get(id)!);
    });
    this.walk.run().then(() => offer(null), (error) => offer(error instanceof Error ? error : new Error(String(error))));
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
