import {
  clearAutosavedDiagram,
  reportAutosaveFailure,
  saveAutosavedDiagram,
} from '@modeler/settings/store';
import { getSettings, subscribeSettings } from '@modeler/settings/store';
import type { Editor } from '@modeler/editor/port';

const AUTOSAVE_DEBOUNCE_MS = 600;

const isOn = () => getSettings().diagramAutoSave === 'local';

export function attachAutosave(modeler: Editor): () => void {
  let timer: number | undefined;

  const flush = () => {
    if (!isOn()) return;
    modeler.saveXML({ format: true })
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

  modeler.events.on('commandStack.changed', schedule);
  modeler.events.on('import.done', schedule);

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
    modeler.events.off('commandStack.changed', schedule);
    modeler.events.off('import.done', schedule);
    unsub();
    if (timer) window.clearTimeout(timer);
  };
}
