import type { PlanElement } from '@core/engine/plan';
import type { RunEvent } from '@core/engine/record';
import type { Entry } from '@core/engine/steps';

/* What a host of the walk provides, and what the walk's parts share: a pool's thread, the interrupt that leaves an
   activity for its boundary event, the log at a step's depth. */

export type StateTree = Record<string, any>;

/** A message along a message flow. */
export type Message = { id: string; flow: string; content: unknown; inReplyTo?: string };

/** Which conversation a message to a pool that remembers belongs to: the pool and the instance of the pool asking it,
 * and how many exchanges of it came before (`turn`, from 0). */
export type Conversation = { id: string; turn: number };

/** What a claimed element's runner exchanges while it runs: a message out along one of its flows, the messages in. */
export type Talk = {
  send(line: { flow?: unknown; content?: unknown; id?: string; inReplyTo?: string }): void;
  /** The messages that have arrived along the flows into it since the last take. */
  take(): Message[];
  /** Resolves when a message may have arrived: the time to take again. */
  arrived(): Promise<void>;
};

/** What a runner hands back from one hand-off: what it binds, said outright. */
export type Handback = {
  /** The step's result, bound under its element's id; a pool's answer; at a gateway, what its conditions read. */
  result?: unknown;
  /** Values later steps read, by the id they are bound under: a data edge's target. */
  values?: Record<string, unknown>;
  /** Properties it wrote, scope by scope. */
  state?: Record<string, Record<string, unknown>>;
  /** What it ran with (a package version, a model digest, the request as sent): for the record, never read as a value. */
  record?: Record<string, unknown>;
  durationMs?: number;
};

/** A hand-off that failed after binding something: what it had bound is kept, and the step still fails. */
export class HandoffError extends Error {
  readonly partial: Handback | undefined;

  constructor(message: string, partial?: Handback) {
    super(message);
    this.name = 'HandoffError';
    this.partial = partial;
  }
}

export type Level = 'debug' | 'info' | 'warning' | 'error';

/** A line for the run's log, written at the depth of the step it is about. */
export type Note = (event: string, message: string, detail?: { level?: Level }) => void;

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
  /** Hands a claimed element, or one `message` to a pool a runner plays (with its `conversation`, when the pool
   * remembers), to its runner: the run's values in, what the
   * runner hands back out, and the element's `attributes` with their placeholders resolved. A failure rejects, with a
   * {@link HandoffError} when something had been bound first. `signal` aborts when a timer at a boundary event ends
   * the activity the hand-off is in: the host stops it. */
  perform(id: string, values: Record<string, unknown>, step: { attributes: Record<string, unknown>; message?: Message; conversation?: Conversation; talk?: Talk; note: Note; signal?: AbortSignal }): Promise<Handback>;
  /** Resolves `ms` from now, for the timer event `at`, unless `signal` aborts first; without it, the machine's clock. */
  wait?(ms: number, signal: AbortSignal, at: string): Promise<void>;
  log: Note;
  /** A timestamp for a record, as the host writes them. */
  now(): string;
  reuse?: Reuse;
  /** What happened, as it happens: the run's record, which the host keeps (packages/core/src/engine/record.ts). */
  record?(event: RunEvent): void;
  /** An activity's data outputs, once it is done: the host notes what it made. */
  outputs?(id: string, targets: string[], entry: Entry, note: Note): void;
  /** The walk is about to leave an element. */
  passed?(id: string): void;
  /** A pool's token moves into `to`: along a sequence flow when it took one, else it starts there, or leaves an
   * activity for its boundary event. The walk waits for it, so a host may show the move. `pool` names whose token. */
  moved?(to: string, along: string | undefined, pool: string): void | Promise<void>;
  /** A gateway the walk could not decide, because a condition could not be evaluated: a dry run, where no step ran to
   * bind what the condition reads, names the flow to take. */
  decide?(gateway: string, flows: string[], error: Error): string | undefined;
  /** Free choice, for exploring every way a study can go: each decision the walk would make by data or by chance is
   * the host's instead, one of `options` at `at`. A gateway's flow (`<gateway>`, the flow ids), another pass of an
   * activity (`<activity>:again`, `again` or `done`), the conditional boundary event that ends a finished activity
   * (`<activity>:ends`, `none` or a boundary id). */
  choose?(at: string, options: string[]): string;
};

export type WalkOptions = {
  /** The run's seed: the study's, unless the run was given another; `null` runs unseeded whatever the study says. */
  seed?: string | number | null;
  /** The `state` tree the study carries from earlier runs. */
  state?: StateTree;
  maxSteps?: number;
  /** Walk each pool once, whatever its `participantMultiplicity`: a participant's session is one instance of its pool. */
  oneInstance?: boolean;
  /** Which instance of its pool that one is, 1-based (the browser's `?participant=`): a random gateway draws for it. */
  participant?: number;
  /** The seeds of the random gateways that conceal their allocation (`seedDigest`), by gateway id, checked against
   * their digests beforehand (`concealedSeeds`). Such a gateway draws from its own seed instead of the run's. */
  concealed?: Record<string, string>;
};

/** A path stopped because another path of its scope ended the scope: it failed, left at a boundary event, or ended
 * the scope at a terminate end event. */
export class Cancelled extends Error {
  constructor() {
    super('stopped: another path ended its scope');
    this.name = 'Cancelled';
  }
}

/** A message reached a boundary event of a running activity, or a failure its error boundary event: the walk leaves
 * the activity for the event. */
export class Interrupted extends Error {
  readonly activity: string;
  readonly boundary: PlanElement;

  constructor(activity: string, boundary: PlanElement) {
    super(`${activity} ended by ${boundary.id}`);
    this.name = 'Interrupted';
    this.activity = activity;
    this.boundary = boundary;
  }
}

/** One path of a pool's walk: a token, where it is, what it watches, what its pool last heard. A pool walks one path
 * until a split gives it more, each walking on its own until a join takes them back. */
export type Thread = {
  /** The process it walks. */
  pool: string;
  /** Which path it is, unique in the run; a pool's own thread, before any path starts, is ''. */
  path: string;
  depth: number;
  /** The activities it is inside, outermost first, each with the message flows that end it and their boundary events,
   * the timer boundary events whose time has come, and what stops the hand-offs inside it when one has. */
  watching: { activity: string; flows: Map<string, PlanElement>; due: PlanElement[]; stop: AbortController }[];
  /** The scopes it walks in, outermost first: one aborts when another path of it failed, left it at a boundary event,
   * or ended it at a terminate end event, and every path still in it stops. */
  cancels: AbortSignal[];
  /** The message this pool last took from each other pool: what it sends back answers it. */
  heard: Map<string, string>;
  /** Which instance of the pool it walks, 1-based, and how often that instance has reached each random gateway. */
  participant: number;
  visits: Map<string, number>;
};

/** A line for the log, indented to the depth a pool's walk is at. */
export function logAt(host: Host, thread: Thread, event: string, message: string, detail?: Parameters<Note>[2]): void {
  host.log(event, `${'  '.repeat(thread.depth + 1)}${message}`, detail);
}

/** A hand-off's `record`, what the runner ran with (a package version, a model digest, the request as sent), merged
 * into its step's record entry and never read as a value; the walk's own keys stand. */
export function keepRecord(entry: Entry, handed: Handback): void {
  entry._runnerMs = handed.durationMs;
  const { record } = handed;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return;
  for (const [key, value] of Object.entries(record)) if (!(key in entry)) entry[key] = value;
}
