import { useEffect, useState, useContext } from 'react';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import 'bpmn-js-color-picker/colors/color-picker.css';
import { ModelerContext } from '@/modeler/infra/contexts';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { attachAutosave, getSettings, loadAutosavedDiagram } from '@/modeler/views/settings';
import { modeler as s } from '@/modeler/infra/styles';

export function Modeler() {
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  const { setModeler } = useContext(ModelerContext);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | undefined;

    const initialXml = getSettings().diagramAutoSave === 'local' ? loadAutosavedDiagram() : undefined;
    executeCommand(null, { type: 'download-schemas' })
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
      .catch((err: any) => console.error('Error creating modeler:', err));

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [canvas, setModeler]);

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

  return <div className={s.canvas} data-testid="modeler-canvas" ref={setCanvas} />;
}
