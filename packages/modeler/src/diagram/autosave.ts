/**
 * Auto-save, to two destinations that answer different questions: the copy in this browser is
 * "can I close the tab and come back", the write-through to disk is "is my file up to date". They
 * are independently switchable and share one debounce, because they are triggered by the same edit.
 */
import { executeCommand } from '@modeler/commandBus';
import { getLink, hasUnsavedEdits, markDirty } from '@modeler/diagram/fileHandle';
import { autoSavable } from '@modeler/export/formats';
import {
  clearAutosavedDiagram,
  getSettings,
  reportAutosaveFailure,
  saveAutosavedDiagram,
  subscribeSettings,
} from '@modeler/settings/store';
import type { Editor } from '@modeler/editor/port';

const AUTOSAVE_DEBOUNCE_MS = 600;

/** The copy in this browser, which survives a reload. */
const localIsOn = () => getSettings().diagramAutoSave === 'local';

/**
 * The write-through to disk. Needs a linked file, and one cheap enough to rewrite on every edit —
 * an image is rendered from scratch each time, so it waits for a save the user asked for.
 */
const fileIsOn = () => {
  const { file } = getLink();
  return getSettings().autoSaveToFile && !!file && autoSavable(file.format);
};

export function attachAutosave(modeler: Editor): () => void {
  let timer: number | undefined;

  const flush = () => {
    if (localIsOn()) {
      modeler.saveXML({ format: true })
        .then(({ xml }: { xml: string }) => {
          if (xml) saveAutosavedDiagram(xml);
        })
        .catch(reportAutosaveFailure);
    }
    // Only edits made since the last write are worth a file write; `SaveDiagram` serializes
    // overlapping writes, and the debounce is what keeps a keystroke from becoming a swap file.
    if (fileIsOn() && hasUnsavedEdits()) {
      void executeCommand(modeler, { type: 'SaveDiagram', auto: true });
    }
  };

  const schedule = () => {
    if (!localIsOn() && !fileIsOn()) return;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  };

  const onEdited = () => {
    markDirty();
    schedule();
  };

  modeler.events.on('commandStack.changed', onEdited);
  modeler.events.on('import.done', schedule);

  // Turning either destination on has to arm the timer; turning the local copy off also drops
  // the entry, so a stale diagram is never restored from a switch the user has since flipped.
  let wasOn = { local: localIsOn(), file: fileIsOn() };
  const unsub = subscribeSettings(() => {
    const isOn = { local: localIsOn(), file: fileIsOn() };
    if (isOn.local === wasOn.local && isOn.file === wasOn.file) return;
    const droppedLocal = wasOn.local && !isOn.local;
    wasOn = isOn;
    if (droppedLocal) clearAutosavedDiagram();
    if (isOn.local || isOn.file) schedule();
    else if (timer) window.clearTimeout(timer);
  });

  return () => {
    modeler.events.off('commandStack.changed', onEdited);
    modeler.events.off('import.done', schedule);
    unsub();
    if (timer) window.clearTimeout(timer);
  };
}
