import { useEffect, useState, useContext } from 'react';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import 'bpmn-js-color-picker/colors/color-picker.css';
import { ModelerContext } from './contexts';
import { executeCommand } from './commands';
import {
  clearAutosavedDiagram,
  getSettings,
  loadAutosavedDiagram,
  saveAutosavedDiagram,
  subscribeSettings,
} from './settings';
import { modeler as s } from './styles';

const AUTOSAVE_DEBOUNCE_MS = 600;

export function Modeler() {

    const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
    const { setModeler } = useContext(ModelerContext);
    const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | undefined;

    const initialXml =
      getSettings().diagramAutoSave === 'local' ? loadAutosavedDiagram() : undefined;
    executeCommand(null, {
      type: 'download-schemas',
    })
      .then((schemas: Record<string, any>) => executeCommand(null, {
        type: 'create-modeler',
        container: canvas,
        extensionSchemas: schemas,
        initialDiagramXml: initialXml,
      }))
      .then((modeler: any) => {
        if (cancelled) return;
        detach = attachAutosave(modeler);
        setModeler(modeler);
        setLoading(false);
      })
      .catch((err: any) => console.log('Error creating modeler:', err));

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [canvas, setModeler]);

  /** Persist the diagram XML to localStorage whenever the user changes it. */
  function attachAutosave(modeler: any): () => void {
    const eventBus = modeler.get('eventBus');
    let timer: number | undefined;

    const flush = () => {
      if (getSettings().diagramAutoSave !== 'local') return;
      modeler
        .saveXML({ format: true })
        .then(({ xml }: { xml: string }) => {
          if (xml) saveAutosavedDiagram(xml);
        })
        .catch(() => {
          // Ignore serialization errors during transient invalid states.
        });
    };
    const schedule = () => {
      if (getSettings().diagramAutoSave !== 'local') return;
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

  if (isLoading) {
    return (
      <div className={s.loading} data-testid="modeler-loading">
        <div role="status" className={s.loadingSpinner} aria-label="Loading modeler">
          <span className={s.loadingIcon}></span>
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

    return (
        <div className={s.canvas} data-testid="modeler-canvas" ref={setCanvas}></div>
    );
}
