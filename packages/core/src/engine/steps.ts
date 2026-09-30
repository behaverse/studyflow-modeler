/** One step's record: what ran, when, how it ended, and whatever the walk or its runner noted about it. */
export type Entry = Record<string, unknown> & {
  node: string;
  name: string;
  type: string;
  startedAt: string;
  status: string;
  durationMs?: number;
};

const clocks = new WeakMap<Entry, number>();

/** The steps of one run, in the order they began. */
export class Steps {
  status: 'ok' | 'error' = 'ok';
  entries: Entry[] = [];

  begin(node: string, name: string, type: string): Entry {
    const entry: Entry = { node, name, type, startedAt: new Date().toISOString(), status: 'ok' };
    clocks.set(entry, performance.now());
    this.entries.push(entry);
    return entry;
  }

  /** Closes the entry; a duration its runner reported replaces the walk's own, which includes the hand-off. */
  end(entry: Entry): void {
    const started = clocks.get(entry);
    if (started !== undefined) entry.durationMs = Math.round((performance.now() - started) * 10) / 10;
    clocks.delete(entry);
    const reported = entry._runnerMs;
    delete entry._runnerMs;
    if (typeof reported === 'number') entry.durationMs = reported;
  }

  fail(entry: Entry, error: unknown): void {
    entry.status = 'error';
    const failure = error instanceof Error ? error : new Error(String(error));
    entry.error = {
      type: failure.name,
      message: failure.message.slice(0, 400),
      traceback: (failure.stack ?? '').split('\n').slice(0, 6),
    };
    this.status = 'error';
    delete entry._runnerMs;
    if (clocks.has(entry)) this.end(entry);
  }
}
