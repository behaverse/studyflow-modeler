/**
 * Command bus for the modeler. `executeCommand` routes a typed command to its
 * handler; each handler lives in the semantic controller module it belongs to
 * (diagram/, palette/, shape/, attributes/, simulation/, app/). This file owns
 * only the registry and dispatch, no command logic of its own.
 *
 * A `ControllerCommand` is a dispatchable controller action, distinct from a
 * `PaletteCommand` (a command-palette menu entry in the view layer). A palette
 * entry's action may dispatch one of these, open a dialog, or just expand a
 * submenu; only the first kind reaches this bus.
 */
import {
  runPaletteStartCreate, type PaletteStartCreateCommand,
  runPaletteStartCreateTemplate, type PaletteStartCreateTemplateCommand,
  runResolvePaletteSchemas, type ResolvePaletteSchemasCommand,
  runPaletteActivateLasso, runPaletteOpenPopup,
  type PaletteActivateLassoCommand, type PaletteOpenPopupCommand,
} from '@/modeler/controllers/palette';

import {
  runOpenDiagram, type OpenDiagramCommand,
  runImportJsPsych, type ImportJsPsychCommand,
  runImportXml, type ImportXmlCommand,
  runNewDiagram, type NewDiagramCommand,
  runSaveDiagram, type SaveDiagramCommand,
  runPublishDiagram, type PublishDiagramCommand,
  runResetZoom, type ResetZoomCommand,
} from '@/modeler/controllers/diagram';

import { runCreateShape, runSetColor, type CreateShapeCommand, type SetColorCommand } from '@/modeler/controllers/shape';
import { runUpdateAttribute, type UpdateAttributeCommand } from '@/modeler/controllers/attributes';

import {
  runCreateModeler, type CreateModelerCommand,
  runDownloadSchemas, type DownloadSchemasCommand,
  runOpenRunner, type OpenRunnerCommand,
} from '@/modeler/controllers/app';

import { runToggleSimulation, type ToggleSimulationCommand } from '@/modeler/controllers/simulation/toggleSimulation';

export type ControllerCommand =
  | PaletteStartCreateCommand
  | PaletteStartCreateTemplateCommand
  | ResolvePaletteSchemasCommand
  | PaletteActivateLassoCommand
  | PaletteOpenPopupCommand
  | OpenDiagramCommand
  | ImportJsPsychCommand
  | NewDiagramCommand
  | SaveDiagramCommand
  | PublishDiagramCommand
  | ToggleSimulationCommand
  | ResetZoomCommand
  | DownloadSchemasCommand
  | CreateModelerCommand
  | OpenRunnerCommand
  | ImportXmlCommand
  | UpdateAttributeCommand
  | CreateShapeCommand
  | SetColorCommand;

/** Adding a new `ControllerCommand` fails compile until it's registered in HANDLERS. */
type HandlerMap = {
  [K in ControllerCommand['type']]: (
    modeler: any,
    command: Extract<ControllerCommand, { type: K }>,
  ) => unknown;
};

const HANDLERS: HandlerMap = {
  'palette-start-create': runPaletteStartCreate,
  'palette-start-create-template': runPaletteStartCreateTemplate,
  'resolve-palette-schemas': runResolvePaletteSchemas,
  'palette-activate-lasso': runPaletteActivateLasso,
  'palette-open-popup': runPaletteOpenPopup,
  'open-diagram': runOpenDiagram,
  'import-jspsych': runImportJsPsych,
  'new-diagram': runNewDiagram,
  'save-diagram': runSaveDiagram,
  'publish-diagram': runPublishDiagram,
  'toggle-simulation': runToggleSimulation,
  'reset-zoom': runResetZoom,
  'download-schemas': runDownloadSchemas,
  'create-modeler': runCreateModeler,
  'open-runner': runOpenRunner,
  'import-xml': runImportXml,
  'update-attribute': runUpdateAttribute,
  'create-shape': runCreateShape,
  'set-color': runSetColor,
};

/** Dispatch a typed `ControllerCommand`; `modeler` is any DI container with `.get(service)`. */
export async function executeCommand(modeler: any, command: ControllerCommand): Promise<any> {
  const handler = HANDLERS[command.type] as (m: any, cmd: ControllerCommand) => unknown;
  return handler ? handler(modeler, command) : undefined;
}
