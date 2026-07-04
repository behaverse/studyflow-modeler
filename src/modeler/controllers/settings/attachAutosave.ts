import { clearAutosavedDiagram, saveAutosavedDiagram } from '@/modeler/infra/settings/autosaveDiagram';
import { getSettings, subscribeSettings } from '@/modeler/infra/settings/store';

const AUTOSAVE_DEBOUNCE_MS = 600;

const isOn = () => getSettings().diagramAutoSave === 'local';

/** Debounce-persist the diagram XML to localStorage on each canvas change. */
export function attachAutosave(modeler: any): () => void {
  const eventBus = modeler.get('eventBus');
  let timer: number | undefined;

  const flush = () => {
    if (!isOn()) return;
    modeler.saveXML({ format: true })
      .then(({ xml }: { xml: string }) => { if (xml) saveAutosavedDiagram(xml); })
      .catch(() => {});
  };

  const schedule = () => {
    if (!isOn()) return;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  };

  eventBus.on('commandStack.changed', schedule);
  eventBus.on('import.done', schedule);

  const unsub = subscribeSettings((next) => {
    if (next.diagramAutoSave === 'off') {
      if (timer) window.clearTimeout(timer);
      clearAutosavedDiagram();
    }
  });

  return () => {
    eventBus.off('commandStack.changed', schedule);
    eventBus.off('import.done', schedule);
    unsub();
    if (timer) window.clearTimeout(timer);
  };
}
