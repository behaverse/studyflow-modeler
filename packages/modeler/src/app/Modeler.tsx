import { useEffect, useRef, useState } from 'react';

import new_diagram from '#assets/new_diagram.bpmn?raw';
import { fromWireXml } from '@core/document';
import { loadSchemas } from '@core/notation/loader';
import { ensureDiagramLayout } from '@modeler/diagram/autoLayout';
import { mountEditor } from '@modeler/editor/mount';
import { connectCommandBus } from '@modeler/commandBus';
import { clearAutosavedDiagram, getSettings, loadAutosavedDiagram } from '@modeler/settings/store';
import { attachAutosave } from '@modeler/diagram/autosave';
import { restoreLink } from '@modeler/diagram/fileHandle';
import { notify } from '@modeler/app/noticeStore';
import { openDiagramFile } from '@modeler/open/openFile';
import { surface, text } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';
import type { Editor } from '@modeler/editor/port';

const s = {
  root: 'relative flex flex-1 h-full',
  loading: `absolute inset-0 z-10 flex text-center ${surface.canvas}`,
  loadingSpinner: 'm-auto animate-spin',
  loadingIcon: `${ICONS.arrowRepeat} text-stone-500 text-[3rem]`,
  bootError: `absolute inset-0 z-10 flex items-center justify-center p-8 ${surface.canvas}`,
  bootErrorText: `max-w-prose text-sm ${text.muted}`,
  canvas: `grow ${surface.canvas}`,
} as const;

/** `?open=<url>` (what `studyflow edit <file>` passes) fetches that diagram onto the canvas, over any restored draft. */
async function openFromUrl(editor: Editor): Promise<void> {
  const url = new URLSearchParams(window.location.search).get('open');
  if (!url) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const name = decodeURIComponent(new URL(url, window.location.href).pathname.split('/').pop() ?? '');
    await openDiagramFile(editor, new File([await response.blob()], name));
  } catch (err) {
    notify('error', `Could not open ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Mount the editor in `container` with the enabled schemas, on the autosaved diagram if it opens, else a new one. */
async function bootEditor(container: HTMLElement, autosaved: string | undefined): Promise<Editor> {
  const editor = mountEditor({ container, extensionSchemas: await loadSchemas(getSettings().enabledSchemas) });
  if (autosaved) {
    try {
      const moddle = editor.model.moddle();
      await editor.importXML(await ensureDiagramLayout(await fromWireXml(autosaved, moddle), moddle));
      return editor;
    } catch (err) {
      console.warn('Could not open the autosaved diagram; starting a new one, and the autosave is cleared.', err);
      clearAutosavedDiagram();
    }
  }
  await editor.importXML(new_diagram);
  return editor;
}

/** The canvas and the boot that puts an editor on it; `onReady` hands the editor to the app. */
export function Modeler({ onReady }: { onReady: (editor: Editor) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | undefined;
    let created: Editor | undefined;

    const initialXml = getSettings().diagramAutoSave === 'local' ? loadAutosavedDiagram() : undefined;
    bootEditor(containerRef.current!, initialXml)
      .then((editor: Editor) => {
        // Boot is async: under StrictMode the cleanup below runs before this resolves.
        if (cancelled) {
          editor?.destroy?.();
          return;
        }
        created = editor;
        connectCommandBus(editor);
        detach = attachAutosave(editor);
        // Picks the previous session's file back up, but only when the canvas was restored along
        // with it. Without the restored diagram this is a fresh blank canvas, and a link would
        // point saving at a file this diagram never came from. Permission has reset to `prompt`
        // unless the app is installed, so a restored link usually waits for a click to write.
        if (initialXml) {
          restoreLink().catch((err) => console.warn('Could not restore the linked file.', err));
        }
        // One facade per editor (so its revision counter spans the editor's whole
        // life); the app holds it from here on.
        onReady(editor);
        setLoading(false);
        openFromUrl(editor);
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
  }, [onReady]);

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
