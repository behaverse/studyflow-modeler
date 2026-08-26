import {
  clearAutosavedDiagram,
  reportAutosaveFailure,
  saveAutosavedDiagram,
} from '@modeler/settings/store';
import { getSettings, subscribeSettings } from '@modeler/settings/store';
import { getEditorPort } from '@modeler/editor/registry';
import type { PortHandle } from '@modeler/editor/registry';

const AUTOSAVE_DEBOUNCE_MS = 600;

const isOn = () => getSettings().diagramAutoSave === 'local';

export function attachAutosave(modeler: PortHandle): () => void {
  const editor = getEditorPort(modeler);
  let timer: number | undefined;

  const flush = () => {
    if (!isOn()) return;
    editor.saveXML({ format: true })
      .then(({ xml }: { xml: string }) => {
        if (xml) saveAutosavedDiagram(xml);
      })
      .catch(reportAutosaveFailure);
  };

  const schedule = () => {
    if (!isOn()) return;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  };

  editor.events.on('commandStack.changed', schedule);
  editor.events.on('import.done', schedule);

  let wasOn = isOn();
  const unsub = subscribeSettings((next) => {
    const nowOn = next.diagramAutoSave === 'local';
    if (wasOn === nowOn) return;
    wasOn = nowOn;
    if (nowOn) {
      schedule();
      return;
    }
    if (timer) window.clearTimeout(timer);
    clearAutosavedDiagram();
  });

  return () => {
    editor.events.off('commandStack.changed', schedule);
    editor.events.off('import.done', schedule);
    unsub();
    if (timer) window.clearTimeout(timer);
  };
}
