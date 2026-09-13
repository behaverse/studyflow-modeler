import { expect, test } from '@playwright/test';

import { createSnapshotHistory } from '@modeler/editor/history';

/**
 * The editor's undo history: XML snapshots standing in for a command stack. It is
 * what `Editor.revision()` / `undo()` / `redo()` answer with, so provenance,
 * autosave and dirty-tracking read it without knowing where the mutation came from.
 */

/**
 * A document that is one string. `serialize` reads it, `restore` writes it — the
 * same contract `editor/mount.ts` fulfils with `saveXML` /
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

  // Synchronous, because `HistoryChanged` consumers (autosave, provenance,
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
  history.record();
  await settle();
  const afterEdit = history.revision();

  expect(history.canUndo()).toBe(true);
  expect(history.canRedo()).toBe(false);

  history.undo();
  await settle();
  expect(state.xml, 'the document is back at the import baseline').toBe('<a/>');
  expect(history.canUndo()).toBe(false);
  expect(history.canRedo()).toBe(true);
  // An undo is a change like any other, so a re-export re-stamps the trail; a redo too.
  expect(history.revision()).toBeGreaterThan(afterEdit);
  const afterUndo = history.revision();

  history.redo();
  await settle();
  expect(state.xml).toBe('<b/>');
  expect(history.canRedo()).toBe(false);
  expect(history.revision()).toBeGreaterThan(afterUndo);
});

test('an edit is one undo state: a no-op adds none, and two signals for one edit collapse', async () => {
  const { state, history } = fakeDocument('<a/>');
  history.reset();
  await settle();

  history.record();
  await settle();
  expect(history.canUndo(), 'nothing changed, so there is nothing to go back to').toBe(false);

  // What the editor does on a `mutate.*` call: the mutations' per-mutation
  // commit and the scene's own change event both arrive for a single write.
  state.xml = '<b/>';
  history.record();
  history.record();
  await settle();

  history.undo();
  await settle();
  expect(state.xml, 'one undo is enough — the duplicate snapshot was dropped').toBe('<a/>');
  expect(history.canUndo()).toBe(false);
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
      // The canvas fires `ElementChanged` while a snapshot is being applied; the
      // watcher in `editor/mount.ts` calls straight back into `record`.
      history.record();
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
