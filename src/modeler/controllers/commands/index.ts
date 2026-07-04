import { runPaletteStartCreate, type PaletteStartCreateCommand } from '@/modeler/controllers/commands/palette/paletteStartCreate';
import { runPaletteStartCreateTemplate, type PaletteStartCreateTemplateCommand } from '@/modeler/controllers/commands/palette/paletteStartCreateTemplate';
import { runResolvePaletteSchemas, type ResolvePaletteSchemasCommand } from '@/modeler/controllers/commands/palette/paletteSetup';
import { runPaletteActivateLasso, runPaletteOpenPopup, type PaletteActivateLassoCommand, type PaletteOpenPopupCommand } from '@/modeler/controllers/commands/palette/paletteUi';

import { runOpenDiagram, type OpenDiagramCommand } from '@/modeler/controllers/commands/diagram/openDiagram';
import { runImportJsPsych, type ImportJsPsychCommand } from '@/modeler/controllers/commands/diagram/importJsPsych';
import { runNewDiagram, type NewDiagramCommand } from '@/modeler/controllers/commands/diagram/newDiagram';
import { runSaveDiagram, type SaveDiagramCommand } from '@/modeler/controllers/commands/diagram/saveDiagram';
import { runPublishDiagram, type PublishDiagramCommand } from '@/modeler/controllers/commands/diagram/publishDiagram';
import { runResetZoom, type ResetZoomCommand } from '@/modeler/controllers/commands/diagram/resetZoom';
import { runImportXml, type ImportXmlCommand } from '@/modeler/controllers/commands/diagram/importXml';

import { runToggleSimulation, type ToggleSimulationCommand } from '@/modeler/controllers/commands/ui/toggleSimulation';
import { runDownloadSchemas, type DownloadSchemasCommand } from '@/modeler/controllers/commands/ui/downloadSchemas';
import { runCreateModeler, type CreateModelerCommand } from '@/modeler/controllers/commands/ui/createModeler';
import { runOpenRunner, type OpenRunnerCommand } from '@/modeler/controllers/commands/ui/openRunner';

import { runUpdateAttribute, type UpdateAttributeCommand } from '@/modeler/controllers/commands/attributes/updateAttribute';

import { runCreateShape, runSetColor, type CreateShapeCommand, type SetColorCommand } from '@/modeler/controllers/commands/shape';

export type DiagramCommand =
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

/** Adding a new `DiagramCommand` fails compile until it's registered in HANDLERS. */
type HandlerMap = {
  [K in DiagramCommand['type']]: (
    modeler: any,
    command: Extract<DiagramCommand, { type: K }>,
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

/** Dispatch a typed `DiagramCommand`; `modeler` is any DI container with `.get(service)`. */
export async function executeCommand(modeler: any, command: DiagramCommand): Promise<any> {
  const handler = HANDLERS[command.type] as (m: any, cmd: DiagramCommand) => unknown;
  return handler ? handler(modeler, command) : undefined;
}
