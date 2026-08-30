import new_diagram from '#assets/examples/new_diagram.bpmn?raw';
import { fromStandardBpmnXml, fromWireXml } from '@core/document';
import { loadSchemas } from '@core/notation/loader';
import { ensureDiagramLayout } from '@modeler/diagram/autoLayout';
import { clearAutosavedDiagram, clearDiagramHandoff, createDiagramHandoff, getSettings } from '@modeler/settings/store';
import { mountEditor } from '@modeler/editor/mount';
import type { Editor } from '@modeler/editor/port';

export type DownloadSchemasCommand = {
  type: 'DownloadSchemas';
};

export async function runDownloadSchemas(_modeler: Editor | null, _command: DownloadSchemasCommand): Promise<Record<string, any>> {
  return loadSchemas(getSettings().enabledSchemas);
}

/** Bus commands rather than keybindings */
export type UndoCommand = { type: 'Undo' };
export type RedoCommand = { type: 'Redo' };

export function runUndo(modeler: Editor, _command: UndoCommand): void {
  modeler.undo();
}

export function runRedo(modeler: Editor, _command: RedoCommand): void {
  modeler.redo();
}

const DEFAULT_SEED = 42;

export type OpenRunnerCommand = {
  type: 'OpenRunner';
  seed?: number;
  /** Tab claimed by the click handler; see `openRunnerTab`. Omit and this opens its own. */
  target?: Window | null;
};

/** Reported in *this* tab: the runner tab either never opened or has nothing to read. */
export class OpenRunnerError extends Error {}

function fail(message: string): never {
  console.warn(message);
  throw new OpenRunnerError(message);
}

const POPUP_BLOCKED = 'Could not open the runner. Allow pop-ups for this site and try again.';

/** Must be called *synchronously* from the click: `window.open` is only honoured while the gesture is live, and the async hand-off would land after it expires. */
export function openRunnerTab(): Window | null {
  return window.open('', '_blank');
}

export async function runOpenRunner(modeler: Editor, command: OpenRunnerCommand): Promise<void> {
  // `undefined` means the caller never tried; `null` means it tried and the browser said no.
  const target = command.target === undefined ? openRunnerTab() : command.target;
  if (!target) fail(POPUP_BLOCKED);

  let xml: string;
  try {
    ({ xml } = await modeler.saveXML({ format: true }));
  } catch (err) {
    target.close();
    throw err;
  }

  const { id, result } = createDiagramHandoff(xml);
  if (result !== 'ok') {
    target.close();
    clearDiagramHandoff(id);
    fail(
      result === 'quota'
        ? 'Could not start the runner: browser storage is full. Clear local data from Settings > Privacy and try again.'
        : 'Could not start the runner. Allow it for this site and try again.',
    );
  }

  const params = new URLSearchParams({
    diagram: id,
    seed: String(command.seed ?? DEFAULT_SEED),
  });

  // Absolute: the blank tab's own base URL is `about:blank`, which a relative path resolves against.
  const url = new URL(`./run/?${params.toString()}`, window.location.href).href;
  try {
    target.location.replace(url);
  } catch {
    // A tab the user closed while the diagram was serializing.
    clearDiagramHandoff(id);
    fail(POPUP_BLOCKED);
  }
}

export type CreateModelerCommand = {
  type: 'CreateModeler';
  container: any;
  extensionSchemas: Record<string, any>;
  initialDiagramXml?: string;
};

/**
 * Mount the editor into `container` and hand back the {@link Editor} facade the app
 * holds from here on (`editor/mount.ts`).
 */
export async function runCreateModeler(_modeler: Editor | null, command: CreateModelerCommand): Promise<Editor> {
  const editor = mountEditor({
    container: command.container as HTMLElement,
    extensionSchemas: command.extensionSchemas,
  });

  const provided = command.initialDiagramXml;
  if (provided) {
    try {
      const moddle = editor.model.moddle();
      const wireXml = await fromStandardBpmnXml(
        await fromWireXml(provided, moddle),
        moddle,
      );
      await editor.importXML(await ensureDiagramLayout(wireXml, moddle));
      return editor;
    } catch (err) {
      console.warn(
        'Failed to import the initial diagram; falling back to a new diagram. ' +
        'The autosaved entry (if any) has been cleared.',
        err,
      );
      clearAutosavedDiagram();
    }
  }
  await editor.importXML(new_diagram);
  return editor;
}
