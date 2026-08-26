/**
 * The document-history seam both backends hang their undo/redo off.
 *
 * `EditorPort.revision()` and the `commandStack.changed` topic are the app's
 * "the document moved" signals: autosave (`settings/attachAutosave.ts`), the
 * provenance trail (`provenance/trail.ts`) and the undo/redo buttons
 * (`provenance/Provenance.tsx`) all read them. bpmn-js gets both for free from its
 * command stack; the canvas has no command stack at all, so the app supplies one.
 *
 * Two implementations, one interface:
 *
 * - {@link createCommandStackHistory} — bpmn backend. Native undo/redo is kept
 *   verbatim (no regression); the seam only *reads* it, counting
 *   `commandStack.changed` for `revision()`.
 * - {@link createSnapshotHistory} — canvas backend. Each mutation is bracketed by
 *   {@link DocumentHistory.record}, which bumps the revision, fires
 *   `commandStack.changed` and queues an XML snapshot of the moddle document;
 *   undo/redo restore a snapshot by re-importing it into the live backend.
 *
 * Snapshots are taken *after* the write, asynchronously (bpmn-moddle's `toXML` is
 * async while `mutate.*` is not), through a single promise queue so they land in
 * order. Consecutive snapshots with identical XML collapse, which is what makes the
 * two mutation signals the canvas backend listens to — the adapter's `endMutation`
 * and the scene's own change events — safe to overlap.
 */

/** The history slice the `EditorPort` delegates to, on either backend. */
export interface DocumentHistory {
  /** Monotonic edit counter; import resets it silently. */
  revision(): number;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Snapshot point, immediately before a mutation applies (no-op on both today). */
  beginMutation(label: string): void;
  /** Commit point, immediately after a mutation applied. */
  endMutation(label: string): void;
  /** One mutation happened, from wherever. Equivalent to `endMutation`. */
  record(label?: string): void;
  /** A fresh document was imported: forget the past, re-baseline silently. */
  reset(): void;
  /** Detach listeners / drop snapshots. */
  dispose(): void;
}

// --- bpmn backend -------------------------------------------------------------

/** The subset of a bpmn-js modeler this seam needs. */
type CommandStackHost = {
  get(name: 'eventBus', strict: false): { on(topic: string, fn: () => void): void; off?(topic: string, fn: () => void): void } | null;
  get(name: 'commandStack', strict: false): any;
  get(name: 'commandStack'): any;
};

/**
 * Native bpmn-js undo/redo behind the seam. `revision()` counts
 * `commandStack.changed`, which `importXML` deliberately does not fire (it clears
 * the stack silently) — the same signal the old `commandStack._stackIdx` read gave.
 *
 * `record` is a no-op here: the command stack already fired the event that moved
 * the counter, and re-firing it would double-count.
 */
export function createCommandStackHistory(host: CommandStackHost): DocumentHistory {
  let revision = 0;
  const bump = () => {
    revision += 1;
  };
  // Non-strict: unit-test modeler stand-ins carry no event bus (and no edits to count).
  const bus = host.get('eventBus', false);
  bus?.on('commandStack.changed', bump);

  return {
    revision: () => revision,
    undo: () => host.get('commandStack').undo(),
    redo: () => host.get('commandStack').redo(),
    // Non-strict: read at render time, where a stand-in may carry no command stack.
    canUndo: () => !!host.get('commandStack', false)?.canUndo(),
    canRedo: () => !!host.get('commandStack', false)?.canRedo(),
    beginMutation: () => undefined,
    endMutation: () => undefined,
    record: () => undefined,
    reset: () => undefined,
    dispose: () => bus?.off?.('commandStack.changed', bump),
  };
}

// --- canvas backend -----------------------------------------------------------

export interface SnapshotHistoryOptions {
  /** Serialize the live document. Called off the mutation, on the snapshot queue. */
  serialize(): Promise<string>;
  /**
   * Re-import a snapshot into the live backend. Must NOT call back into
   * `EditorPort.importXML` — that resets the history it is restoring.
   */
  restore(xml: string): Promise<void>;
  /** Fire `commandStack.changed` (and anything else the app hangs off a mutation). */
  onChanged?(): void;
  /** How many states to keep, newest first. Default 50. */
  limit?: number;
}

/**
 * App-level undo for a backend without a command stack: a bounded ring of XML
 * snapshots plus a cursor. `entries[index]` is always the state on screen.
 */
export function createSnapshotHistory(options: SnapshotHistoryOptions): DocumentHistory {
  const limit = options.limit ?? 50;
  let entries: string[] = [];
  let index = -1;
  let revision = 0;
  /** Captures queued but not yet landed; keeps `canUndo` honest between the two. */
  let pending = 0;
  /** True while a snapshot is being restored: the writes it causes are not edits. */
  let restoring = false;
  let disposed = false;
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task).catch((err: unknown) => {
      console.warn('Document history step failed; the undo stack may be short a state.', err);
    });
    return queue;
  };

  const capture = (): void => {
    if (disposed) return;
    pending += 1;
    void enqueue(async () => {
      try {
        if (disposed || restoring) return;
        const xml = await options.serialize();
        // Identical to what is already on top: the two mutation signals overlapped,
        // or the write was a no-op. Either way it is not a new undo state.
        if (entries[index] === xml) return;
        if (index < entries.length - 1) entries = entries.slice(0, index + 1);
        entries.push(xml);
        while (entries.length > limit) entries.shift();
        index = entries.length - 1;
        // The stack grew after the synchronous `record()` already fired: let the UI
        // (undo/redo buttons) re-read `canUndo`/`canRedo`. Not for the baseline an
        // import lays down, which is not a mutation and moves nothing.
        if (entries.length > 1) options.onChanged?.();
      } finally {
        pending -= 1;
      }
    });
  };

  const travel = (delta: number): void => {
    if (disposed) return;
    void enqueue(async () => {
      const target = index + delta;
      const xml = entries[target];
      if (xml === undefined) return;
      restoring = true;
      try {
        await options.restore(xml);
        index = target;
      } finally {
        restoring = false;
      }
      revision += 1;
      options.onChanged?.();
    });
  };

  const record = (): void => {
    if (disposed || restoring) return;
    revision += 1;
    options.onChanged?.();
    capture();
  };

  return {
    revision: () => revision,
    // `pending` covers the window between the synchronous mutation and its snapshot.
    canUndo: () => index > 0 || (index === 0 && pending > 0),
    canRedo: () => index >= 0 && index < entries.length - 1,
    undo: () => travel(-1),
    redo: () => travel(+1),
    beginMutation: () => undefined,
    endMutation: () => record(),
    record: () => record(),
    reset: () => {
      entries = [];
      index = -1;
      revision = 0;
      pending = 0;
      capture();
    },
    dispose: () => {
      disposed = true;
      entries = [];
      index = -1;
    },
  };
}
