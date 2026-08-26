/**
 * The bpmn-js backend: a `BpmnModeler` plus the modules the app layers on it,
 * wrapped in the backend-neutral {@link PortHandle}.
 *
 * Behaviour is unchanged from before the two-backend split — this file only moves
 * the construction out of `app/commands.ts` so the backend switch has one shape to
 * choose between. The raw modeler stays reachable on `handle.modeler` for the
 * editor-internal modules that inject its services; nothing app-side reads it.
 */

import BpmnColorPickerModule from 'bpmn-js-color-picker';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import GridModule from 'diagram-js-grid';
import { CreateAppendAnythingModule, CreateAppendElementTemplatesModule } from 'bpmn-js-create-append-anything';
import { StudyflowModelerModule } from '@modeler/bpmn/module';
import { MODELER_FONT_FAMILY } from '@modeler/constants';
import { createBpmnEditorPort } from '@modeler/editor/bpmnAdapter';
import type { PortHandle } from '@modeler/editor/registry';
import type { Modeler } from '@modeler/bpmn/types';

const ADDITIONAL_MODULES = [
  CreateAppendAnythingModule,
  BpmnColorPickerModule,
  CreateAppendElementTemplatesModule,
  GridModule,
  StudyflowModelerModule,
];

export type BpmnBackendOptions = {
  container: HTMLElement;
  extensionSchemas: Record<string, any>;
};

/** Mount bpmn-js into `container` and wrap it in a handle. */
export function createBpmnBackend(options: BpmnBackendOptions): PortHandle {
  // Cast narrows to the app's `Modeler` alias: upstream types `saveXML().xml` as optional.
  const modeler = new BpmnModeler({
    container: options.container,
    textRenderer: {
      defaultStyle: {
        fontFamily: MODELER_FONT_FAMILY,
      },
    },
    moddleExtensions: options.extensionSchemas,
    additionalModules: ADDITIONAL_MODULES,
  }) as unknown as Modeler;

  return {
    backend: 'bpmn',
    // One adapter per modeler: its revision counter spans the modeler's whole life.
    editor: createBpmnEditorPort(modeler),
    modeler,
    destroy: () => modeler.destroy(),
  };
}
