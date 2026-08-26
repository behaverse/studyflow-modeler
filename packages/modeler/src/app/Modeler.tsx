import { useEffect, useRef, useState, useContext } from 'react';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import 'bpmn-js-color-picker/colors/color-picker.css';
import { ModelerContext } from '@modeler/app/contexts';
import { executeCommand } from '@modeler/commandBus';
import { getSettings, loadAutosavedDiagram } from '@modeler/settings/store';
import { attachAutosave } from '@modeler/settings/attachAutosave';
import { surface, text } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';
import type { PortHandle } from '@modeler/editor/registry';

const s = {
  root: 'relative flex flex-1 h-full',
  loading: `absolute inset-0 z-10 flex text-center ${surface.canvas}`,
  loadingSpinner: 'm-auto animate-spin',
  loadingIcon: `${ICONS.arrowRepeat} text-stone-500 text-[3rem]`,
  bootError: `absolute inset-0 z-10 flex items-center justify-center p-8 ${surface.canvas}`,
  bootErrorText: `max-w-prose text-sm ${text.muted}`,
  canvas: `grow ${surface.canvas}`,
} as const;

export function Modeler() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { setModeler } = useContext(ModelerContext);
  const [isLoading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | undefined;
    let created: PortHandle | undefined;

    const initialXml = getSettings().diagramAutoSave === 'local' ? loadAutosavedDiagram() : undefined;
    executeCommand(null, { type: 'DownloadSchemas' })
      .then((schemas: Record<string, any>) => executeCommand(null, {
        type: 'CreateModeler',
        container: containerRef.current,
        extensionSchemas: schemas,
        initialDiagramXml: initialXml,
      }))
      .then((handle: PortHandle) => {
        // `CreateModeler` is async: under StrictMode the cleanup below runs before this resolves.
        if (cancelled) {
          handle?.destroy?.();
          return;
        }
        created = handle;
        detach = attachAutosave(handle);
        // The handle already carries the facade (one per editor, so its revision
        // counter spans the editor's whole life); the app holds it from here on.
        setModeler(handle);
        setLoading(false);
      })
      .catch((err: unknown) => {
        console.error('Error creating modeler:', err);
        if (cancelled) return;
        setBootError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      detach?.();
      created?.destroy?.();
    };
  }, [setModeler]);

  return (
    <div className={s.root}>
      <div className={s.canvas} data-testid="modeler-canvas" ref={containerRef} />
      {isLoading && (
        <div className={s.loading} data-testid="modeler-loading">
          <div role="status" className={s.loadingSpinner} aria-label="Loading modeler">
            <span className={s.loadingIcon}></span>
            <span className="sr-only">Loading...</span>
          </div>
        </div>
      )}
      {bootError && (
        <div className={s.bootError} data-testid="modeler-boot-error" role="alert">
          <p className={s.bootErrorText}>
            The modeler could not start. Reload the page to try again.  {bootError}
          </p>
        </div>
      )}
    </div>
  );
}
