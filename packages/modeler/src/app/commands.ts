import new_diagram from '#assets/examples/new_diagram.bpmn?raw';
import BpmnColorPickerModule from 'bpmn-js-color-picker';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import GridModule from 'diagram-js-grid';
import { fromStandardBpmnXml, fromWireXml } from '@core/document';
import { loadSchemas } from '@core/notation/loader';
import { StudyflowModelerModule } from '@modeler/bpmn/module';
import { MODELER_FONT_FAMILY } from '@modeler/constants';
import { ensureDiagramLayout } from '@modeler/diagram/autoLayout';
import { clearAutosavedDiagram, clearDiagramHandoff, createDiagramHandoff, getSettings } from '@modeler/settings/store';
import { CreateAppendAnythingModule, CreateAppendElementTemplatesModule } from 'bpmn-js-create-append-anything';
import { getEditorPort } from '@modeler/editor/bpmnAdapter';
import type { Modeler } from '@modeler/bpmn/types';

export type DownloadSchemasCommand = {
  type: 'DownloadSchemas';
};

export async function runDownloadSchemas(_modeler: Modeler | null, _command: DownloadSchemasCommand): Promise<Record<string, any>> {
  return loadSchemas(getSettings().enabledSchemas);
}

/** Bus commands rather than keybindings */
export type UndoCommand = { type: 'Undo' };
export type RedoCommand = { type: 'Redo' };

export function runUndo(modeler: Modeler, _command: UndoCommand): void {
  getEditorPort(modeler).undo();
}

export function runRedo(modeler: Modeler, _command: RedoCommand): void {
  getEditorPort(modeler).redo();
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

export async function runOpenRunner(modeler: Modeler, command: OpenRunnerCommand): Promise<void> {
  // `undefined` means the caller never tried; `null` means it tried and the browser said no.
  const target = command.target === undefined ? openRunnerTab() : command.target;
  if (!target) fail(POPUP_BLOCKED);

  let xml: string;
  try {
    ({ xml } = await getEditorPort(modeler).saveXML({ format: true }));
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

const ADDITIONAL_MODULES = [
  CreateAppendAnythingModule,
  BpmnColorPickerModule,
  CreateAppendElementTemplatesModule,
  GridModule,
  StudyflowModelerModule,
];

export type CreateModelerCommand = {
  type: 'CreateModeler';
  container: any;
  extensionSchemas: Record<string, any>;
  initialDiagramXml?: string;
};

export async function runCreateModeler(_modeler: Modeler | null, command: CreateModelerCommand): Promise<Modeler> {
  // Cast narrows to the app's `Modeler` alias: upstream types `saveXML().xml` as optional.
  const modeler = new BpmnModeler({
    container: command.container,
    textRenderer: {
      defaultStyle: {
        fontFamily: MODELER_FONT_FAMILY,
      },
    },
    moddleExtensions: command.extensionSchemas,
    additionalModules: ADDITIONAL_MODULES,
  }) as unknown as Modeler;

  const editor = getEditorPort(modeler);
  const provided = command.initialDiagramXml;
  if (provided) {
    try {
      const moddle = editor.model.moddle();
      const wireXml = await fromStandardBpmnXml(
        await fromWireXml(provided, moddle),
        moddle,
      );
      await editor.importXML(await ensureDiagramLayout(wireXml, moddle));
      return modeler;
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
  return modeler;
}
