import type { PlanElement } from '@core/engine/plan';
import type { Entry } from '@core/engine/steps';

/* What a host of the walk provides, and what the walk's parts share: a pool's thread, the interrupt that leaves an
   activity for its boundary event, the log at a step's depth. */

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
  /** A pool's token moves into `to`: along a sequence flow when it took one, else it starts there, or leaves an
   * activity for its boundary event. The walk waits for it, so a host may show the move. `pool` names whose token. */
  moved?(to: string, along: string | undefined, pool: string): void | Promise<void>;
  /** A gateway the walk could not decide, because a condition could not be evaluated: a dry run, where no step ran to
   * bind what the condition reads, names the flow to take. */
  decide?(gateway: string, flows: string[], error: Error): string | undefined;
};

export type WalkOptions = {
  /** The run's seed: the study's, unless the run was given another; `null` runs unseeded whatever the study says. */
  seed?: string | number | null;
  /** The `state` tree the study carries from earlier runs. */
  state?: StateTree;
  maxSteps?: number;
  /** Walk each pool once, whatever its `participantMultiplicity`: a participant's session is one instance of its pool. */
  oneInstance?: boolean;
};

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

/** One pool's walk: where it is, what it watches, what it last heard. */
export type Thread = {
  /** The process it walks. */
  pool: string;
  depth: number;
  /** The activities it is inside, outermost first, each with the message flows that end it and their boundary events. */
  watching: { activity: string; flows: Map<string, PlanElement> }[];
  /** The message this pool last took from each other pool: what it sends back answers it. */
  heard: Map<string, string>;
};

/** A line for the log, indented to the depth a pool's walk is at. */
export function logAt(host: Host, thread: Thread, event: string, message: string, detail?: Parameters<Note>[2]): void {
  host.log(event, `${'  '.repeat(thread.depth + 1)}${message}`, detail);
}

/** A hand-off's `record`, what the runner ran with (a package version, a model digest, the request as sent), merged
 * into its step's record entry and never read as a value; the walk's own keys stand. */
export function keepRecord(entry: Entry, handed: Record<string, unknown>): void {
  const { record } = handed;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return;
  for (const [key, value] of Object.entries(record)) if (!(key in entry)) entry[key] = value;
}
