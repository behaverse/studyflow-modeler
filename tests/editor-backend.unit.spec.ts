import { expect, test } from '@playwright/test';

import { DEFAULT_EDITOR_BACKEND, resolveEditorBackend } from '@modeler/editor/backend';
import { createSnapshotHistory } from '@modeler/editor/history';
import { createCommandStackHistory } from '@modeler/editor/history';

/**
 * P6a — the two app-side halves the canvas backend brought with it: the backend
 * flag, and the document history that stands in for a command stack.
 *
 * Neither belongs to an editor. The flag decides which one boots; the history is
 * what `EditorPort.revision()` / `undo()` / `redo()` answer with on *both*
 * backends, so provenance, autosave and dirty-tracking cannot tell them apart.
 */

// --- the flag -----------------------------------------------------------------

/** Install a minimal `window` for the duration of `run` (the unit lane is browserless). */
async function withWindow(
  fake: { href?: string; stored?: string | null; throws?: boolean },
  run: () => void | Promise<void>,
): Promise<void> {
  const previous = (globalThis as any).window;
  (globalThis as any).window = {
    location: { href: fake.href ?? 'http://localhost/app' },
    localStorage: {
      getItem: (key: string) => {
        if (fake.throws) throw new Error('storage disabled');
        return key === 'studyflow.editorBackend' ? (fake.stored ?? null) : null;
      },
    },
  };
  try {
    await run();
  } finally {
    if (previous === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previous;
  }
}

test('the default backend is bpmn — the flag has to be asked for', async () => {
  expect(DEFAULT_EDITOR_BACKEND).toBe('bpmn');
  await withWindow({}, () => {
    expect(resolveEditorBackend()).toBe('bpmn');
  });
});

test('`?editor=canvas` mounts the canvas, and outranks the stored preference', async () => {
  await withWindow({ href: 'http://localhost/app?editor=canvas' }, () => {
    expect(resolveEditorBackend()).toBe('canvas');
  });
  await withWindow({ href: 'http://localhost/app?editor=bpmn', stored: 'canvas' }, () => {
    expect(resolveEditorBackend()).toBe('bpmn');
  });
});

test('the stored preference applies when the URL says nothing', async () => {
  await withWindow({ stored: 'canvas' }, () => {
    expect(resolveEditorBackend()).toBe('canvas');
  });
});

test('an unrecognised value falls through rather than booting the wrong editor', async () => {
  await withWindow({ href: 'http://localhost/app?editor=canvs', stored: 'canvas' }, () => {
    expect(resolveEditorBackend(), 'the typo is skipped, the next source answers').toBe('canvas');
  });
  await withWindow({ href: 'http://localhost/app?editor=' }, () => {
    expect(resolveEditorBackend()).toBe('bpmn');
  });
});

test('storage that throws (private mode) is not a boot failure', async () => {
  await withWindow({ throws: true }, () => {
    expect(resolveEditorBackend()).toBe('bpmn');
  });
});

// --- the snapshot history -----------------------------------------------------

/**
 * A document that is one string. `serialize` reads it, `restore` writes it — the
 * same contract `editor/canvasBackend.ts` fulfils with `saveXML` /
 * `canvas.importDefinitions`.
 */
function fakeDocument(initial: string) {
  const state = { xml: initial, changes: 0 };
  const history = createSnapshotHistory({
    serialize: async () => state.xml,
    restore: async (xml) => {
      state.xml = xml;
    },
    onChanged: () => {
      state.changes += 1;
    },
  });
  return { state, history };
}

/** Let every queued snapshot / restore land. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

test('an import baselines the history silently: no revision, nothing to undo', async () => {
  const { state, history } = fakeDocument('<a/>');
  history.reset();
  await settle();

  expect(history.revision(), 'import resets the counter without moving it').toBe(0);
  expect(history.canUndo()).toBe(false);
  expect(history.canRedo()).toBe(false);
  expect(state.changes, 'baselining is not a mutation').toBe(0);
});

test('a recorded mutation bumps the revision and fires the change signal at once', async () => {
  const { state, history } = fakeDocument('<a/>');
  history.reset();
  await settle();

  state.xml = '<b/>';
  history.record();

  // Synchronous, because `commandStack.changed` consumers (autosave, provenance,
  // the undo button) read these in the same turn as the mutation.
  expect(history.revision()).toBe(1);
  expect(state.changes).toBeGreaterThanOrEqual(1);
  expect(history.canUndo(), 'the snapshot is still queued, but there is a past').toBe(true);
});

test('undo restores the previous snapshot and redo puts it back', async () => {
  const { state, history } = fakeDocument('<a/>');
  history.reset();
  await settle();

  state.xml = '<b/>';
  history.endMutation('updateProperties');
  await settle();

  expect(history.canUndo()).toBe(true);
  expect(history.canRedo()).toBe(false);

  history.undo();
  await settle();
  expect(state.xml, 'the document is back at the import baseline').toBe('<a/>');
  expect(history.canUndo()).toBe(false);
  expect(history.canRedo()).toBe(true);

  history.redo();
  await settle();
  expect(state.xml).toBe('<b/>');
  expect(history.canRedo()).toBe(false);
});

test('undo/redo move the revision, so a re-export re-stamps the trail', async () => {
  const { state, history } = fakeDocument('<a/>');
  history.reset();
  await settle();

  state.xml = '<b/>';
  history.record();
  await settle();
  const afterEdit = history.revision();

  history.undo();
  await settle();
  expect(history.revision(), 'an undo is a change like any other').toBeGreaterThan(afterEdit);
});

test('two mutation signals for one edit collapse into one undo state', async () => {
  const { state, history } = fakeDocument('<a/>');
  history.reset();
  await settle();

  // What the canvas backend does on a `mutate.*` call: the adapter's `endMutation`
  // and the scene's own change event both arrive for a single write.
  state.xml = '<b/>';
  history.endMutation('setColor');
  history.record('scene');
  await settle();

  history.undo();
  await settle();
  expect(state.xml, 'one undo is enough — the duplicate snapshot was dropped').toBe('<a/>');
  expect(history.canUndo()).toBe(false);
});

test('a no-op mutation leaves the undo stack alone', async () => {
  const { state, history } = fakeDocument('<a/>');
  history.reset();
  await settle();

  history.record();
  await settle();

  expect(state.xml).toBe('<a/>');
  expect(history.canUndo(), 'nothing changed, so there is nothing to go back to').toBe(false);
});

test('a new edit after an undo drops the redo branch', async () => {
  const { state, history } = fakeDocument('<a/>');
  history.reset();
  await settle();

  state.xml = '<b/>';
  history.record();
  await settle();

  history.undo();
  await settle();
  expect(history.canRedo()).toBe(true);

  state.xml = '<c/>';
  history.record();
  await settle();

  expect(history.canRedo(), 'the abandoned future is gone').toBe(false);
  history.undo();
  await settle();
  expect(state.xml).toBe('<a/>');
});

test('the writes an undo itself causes are not recorded as edits', async () => {
  const state = { xml: '<a/>' };
  let recordsDuringRestore = 0;
  const history = createSnapshotHistory({
    serialize: async () => state.xml,
    restore: async (xml) => {
      state.xml = xml;
      // The canvas fires `element.changed` while a snapshot is being applied; the
      // watcher in `canvasBackend.ts` calls straight back into `record`.
      history.record('scene');
      recordsDuringRestore += 1;
    },
  });

  history.reset();
  await settle();
  state.xml = '<b/>';
  history.record();
  await settle();

  history.undo();
  await settle();

  expect(recordsDuringRestore, 'the restore really did call back in').toBe(1);
  expect(state.xml).toBe('<a/>');
  expect(history.canRedo(), 're-entrancy did not truncate the redo branch').toBe(true);
});

test('the ring is bounded: the oldest states fall off', async () => {
  const state = { xml: 'v0' };
  const history = createSnapshotHistory({
    serialize: async () => state.xml,
    restore: async (xml) => {
      state.xml = xml;
    },
    limit: 3,
  });

  history.reset();
  await settle();
  for (let i = 1; i <= 5; i += 1) {
    state.xml = `v${i}`;
    history.record();
    await settle();
  }

  history.undo();
  await settle();
  history.undo();
  await settle();
  expect(state.xml).toBe('v3');
  expect(history.canUndo(), 'v0..v2 fell out of a 3-deep ring').toBe(false);
});

// --- the bpmn half of the same seam -------------------------------------------

test('the bpmn backend keeps its native stack behind the same seam', () => {
  const calls: string[] = [];
  let listener: (() => void) | undefined;
  const commandStack = {
    undo: () => calls.push('undo'),
    redo: () => calls.push('redo'),
    canUndo: () => true,
    canRedo: () => false,
  };
  const modeler = {
    get: (name: string) => (name === 'eventBus'
      ? { on: (_topic: string, fn: () => void) => { listener = fn; } }
      : commandStack),
  };

  const history = createCommandStackHistory(modeler as any);

  expect(history.revision(), 'nothing has been executed yet').toBe(0);
  listener?.();
  listener?.();
  expect(history.revision(), 'one bump per `commandStack.changed`').toBe(2);

  history.undo();
  history.redo();
  expect(calls, 'undo/redo go straight to the command stack — no snapshots').toEqual(['undo', 'redo']);
  expect(history.canUndo()).toBe(true);
  expect(history.canRedo()).toBe(false);

  // The seam must not double-count: the command stack already fired the event.
  history.record();
  history.endMutation('setColor');
  expect(history.revision()).toBe(2);
});

test('a modeler stand-in with no event bus still answers the history', () => {
  const history = createCommandStackHistory({ get: () => null } as any);
  expect(history.revision()).toBe(0);
  expect(history.canUndo()).toBe(false);
  expect(history.canRedo()).toBe(false);
});
