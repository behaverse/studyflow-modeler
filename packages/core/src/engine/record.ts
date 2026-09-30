import type { Message, StateTree } from '@core/engine/host';
import type { Entry } from '@core/engine/steps';

/**
 * What happened in a run, in order: its one record. The walk tells its host each event as it happens, and the host
 * keeps them (the local runtime's `events.jsonl`, a browser session's record); every other account of the run is read
 * off them: the counts and the properties in the state the study keeps ({@link stateOf}), the records stamped on its
 * elements ({@link recordOf}), a run repository's commits.
 */
export type RunEvent = { at: string } & (
  /** A run began, from `state`; `stamp` is the entry it adds to the study's timeline (`_meta.prov`). The host's. */
  | { event: 'started'; run: string; state: StateTree; stamp: Record<string, unknown> }
  /** A token reached a node, or took a sequence flow: one more in `_meta.reached.<id>`. */
  | { event: 'reached'; id: string }
  /** A pool's instance, or a repeating activity's pass, began: `_meta.instance.<id>`. */
  | { event: 'instance'; id: string; instance: number }
  /** A property of a scope was written, or cleared when there is no `value`. */
  | { event: 'wrote'; scope: string; name: string; value?: unknown }
  /** A step ran, an event was passed, or a gateway took `flow`; `entry` is its record entry. */
  | { event: 'executed'; id: string; flow?: string; entry?: Entry }
  | { event: 'failed'; id: string; entry: Entry }
  /** A step was skipped, or a gateway's decision replayed, on the record of run `run` (made at `trusted`). */
  | { event: 'reused'; id: string; run: string; flow?: string; trusted?: string }
  /** A message went along a flow. */
  | { event: 'sent'; message: Message }
  /** A pool a runner plays answered a message, or could not (`entry.status`). */
  | { event: 'answered'; id: string; entry: Entry }
  /** An artifact a step made, or one staged in from outside for it. The host's. */
  | { event: 'created' | 'imported'; id: string; uri: string }
  /** The run ended. The host's. */
  | { event: 'finished'; status: 'ok' | 'error' }
);

/** A run's events without the time the host adds to each. */
export type Happening = RunEvent extends infer Event ? (Event extends RunEvent ? Omit<Event, 'at'> : never) : never;

/**
 * The state a run leaves: from its `started` event's state (else `start`), each count, pass and property as its
 * events say. What the walk holds at the end is this, so a run's record is enough to recover it.
 */
export function stateOf(events: readonly RunEvent[], start: StateTree = {}): StateTree {
  let state: StateTree = structuredClone(start);
  const meta = (quantity: string): Record<string, any> => ((state._meta ??= {})[quantity] ??= {});
  for (const happened of events) {
    switch (happened.event) {
      case 'started':
        state = structuredClone(happened.state);
        break;
      case 'reached': {
        const reached = meta('reached');
        reached[happened.id] = (reached[happened.id] ?? 0) + 1;
        break;
      }
      case 'instance':
        meta('instance')[happened.id] = happened.instance;
        break;
      case 'wrote': {
        const scope = (state[happened.scope] ??= {});
        if ('value' in happened) scope[happened.name] = structuredClone(happened.value);
        else delete scope[happened.name];
        break;
      }
      default:
    }
  }
  return state;
}

/** When each element last did what its study records of it, by id. */
export type Stamping = {
  /** Steps that ran, and events passed. */
  executed: Map<string, string>;
  /** The flow each gateway took, and when. */
  decided: Map<string, { flow: string; when: string }>;
  /** Steps skipped, and decisions replayed: when, and the `when` of the record trusted. */
  reused: Map<string, { when: string; trusted: string }>;
  created: Map<string, string>;
  imported: Map<string, string>;
};

/** What a run's events say to record on each element of the study: {@link Stamping}. */
export function recordOf(events: readonly RunEvent[]): Stamping {
  const record: Stamping = { executed: new Map(), decided: new Map(), reused: new Map(), created: new Map(), imported: new Map() };
  for (const happened of events) {
    switch (happened.event) {
      case 'executed':
        if (happened.flow) record.decided.set(happened.id, { flow: happened.flow, when: happened.at });
        else record.executed.set(happened.id, happened.at);
        break;
      case 'reused':
        record.reused.set(happened.id, { when: happened.at, trusted: happened.trusted ?? '' });
        break;
      case 'created':
      case 'imported':
        record[happened.event].set(happened.id, happened.at);
        break;
      default:
    }
  }
  return record;
}
