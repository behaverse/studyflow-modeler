/**
 * The document history the editor hangs its undo/redo off.
 *
 * `Editor.revision()` and the `CommandStackChanged` topic are the app's
 * "the document moved" signals: autosave (`settings/attachAutosave.ts`), the
 * provenance trail (`provenance/trail.ts`) and the undo/redo buttons
 * (`provenance/Provenance.tsx`) all read them.
 *
 * The canvas has no command stack, so the app supplies one: each mutation is
 * bracketed by {@link DocumentHistory.record}, which bumps the revision, fires
 * `CommandStackChanged` and queues an XML snapshot of the moddle document;
 * undo/redo restore a snapshot by re-importing it into the live editor.
 *
 * {@link DocumentHistory} stays an interface rather than collapsing into the one
 * implementation: it is what `Editor` delegates to, and the topic names above
 * are the app's contract, not the canvas's. It IS `EditorHistory` — the dependency
 * the facade declares — plus the disposal only its owner performs.
 *
 * Snapshots are taken *after* the write, asynchronously (bpmn-moddle's `toXML` is
 * async while `mutate.*` is not), through a single promise queue so they land in
 * order. Consecutive snapshots with identical XML collapse, which is what makes the
 * two mutation signals `editor/mount.ts` wires up — the facade's own
 * per-mutation `record` and the scene's change events — safe to overlap.
 */

import type { EditorHistory } from '@modeler/editor/port';

/** The history slice the `Editor` delegates to, and the store that owns it. */
export interface DocumentHistory extends EditorHistory {
  /** Detach listeners / drop snapshots. */
  dispose(): void;
}

export interface SnapshotHistoryOptions {
  /** Serialize the live document. Called off the mutation, on the snapshot queue. */
  serialize(): Promise<string>;
  /**
   * Re-import a snapshot into the live editor. Must NOT call back into
   * `Editor.importXML` — that resets the history it is restoring.
   */
  restore(xml: string): Promise<void>;
  /** Fire `CommandStackChanged` (and anything else the app hangs off a mutation). */
  onChanged?(): void;
  /** How many states to keep, newest first. Default 50. */
  limit?: number;
}

/**
 * App-level undo for an editor without a command stack: a bounded ring of XML
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
        // No `onChanged` here. The snapshot lands asynchronously, long after the
        // mutation that caused it, and `CommandStackChanged` means "the document
        // moved" to everything listening — a second, out-of-band fire re-dirties a
        // document that was just marked saved, which is how opening a file used to
        // trigger an auto-save write of a diagram nobody had edited yet
        // (`diagram/autosave.ts`, `tests/modeler.save.spec.ts`). The UI loses
        // nothing: `record()` already fired synchronously, and `canUndo` reports the
        // pending capture through `pending`.
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
