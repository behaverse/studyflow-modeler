import new_diagram from '#assets/examples/new_diagram.bpmn?raw';
import BpmnColorPickerModule from 'bpmn-js-color-picker';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import GridModule from 'diagram-js-grid';
import { fromStandardBpmnXml, fromWireXml } from '@behaverse/studyflow-core/document';
import { loadSchemas } from '@behaverse/studyflow-core/notation/loader';
import { StudyflowModelerModule } from '@/modeler/bpmn/module';
import { MODELER_FONT_FAMILY } from '@/modeler/constants';
import { ensureDiagramLayout } from '@/modeler/diagram/autoLayout';
import { clearAutosavedDiagram, clearDiagramHandoff, createDiagramHandoff, getSettings } from '@/modeler/settings/store';
import { CreateAppendAnythingModule, CreateAppendElementTemplatesModule } from 'bpmn-js-create-append-anything';
import type { Modeler } from '@/modeler/bpmn/types';

export type DownloadSchemasCommand = {
  type: 'DownloadSchemas';
};

export async function runDownloadSchemas(_modeler: Modeler | null, _command: DownloadSchemasCommand): Promise<Record<string, any>> {
  return loadSchemas(getSettings().enabledSchemas);
}

/** Bus commands rather than keybindings, so views off the canvas (the Provenance dialog)
 *  can step history without keyboard focus reaching bpmn-js. */
export type UndoCommand = { type: 'Undo' };
export type RedoCommand = { type: 'Redo' };

export function runUndo(modeler: Modeler, _command: UndoCommand): void {
  modeler.get('commandStack').undo();
}

export function runRedo(modeler: Modeler, _command: RedoCommand): void {
  modeler.get('commandStack').redo();
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

const POPUP_BLOCKED = 'Could not open the runner: the browser blocked the new tab. Allow pop-ups for this site and try again.';

/**
 * Claim the runner's tab. Call this *synchronously* from the click — a browser only honours
 * `window.open` while the gesture that triggered it is still live, and serializing the diagram
 * for the hand-off is async, so opening afterwards reads as an unprompted pop-up and is blocked.
 * The tab starts blank and `runOpenRunner` points it at the runner once the hand-off is written.
 */
export function openRunnerTab(): Window | null {
  return window.open('', '_blank');
}

export async function runOpenRunner(modeler: Modeler, command: OpenRunnerCommand): Promise<void> {
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
        : 'Could not start the runner: this browser blocks local storage, which the hand-off needs.',
    );
  }

  const params = new URLSearchParams({
    diagram: id,
    seed: String(command.seed ?? DEFAULT_SEED),
  });

  // Absolute: the blank tab's own base URL is `about:blank`, which a relative path resolves against.
  const url = new URL(`./run.html?${params.toString()}`, window.location.href).href;
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

  const provided = command.initialDiagramXml;
  if (provided) {
    try {
      const wireXml = await fromStandardBpmnXml(
        await fromWireXml(provided, modeler.get('moddle')),
        modeler.get('moddle'),
      );
      await modeler.importXML(await ensureDiagramLayout(wireXml, modeler.get('moddle')));
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
  await modeler.importXML(new_diagram);
  return modeler;
}
