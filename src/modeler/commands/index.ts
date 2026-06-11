import { runPaletteStartCreate, type PaletteStartCreateCommand } from './palette/paletteStartCreate';
import { runPaletteStartCreateTemplate, type PaletteStartCreateTemplateCommand } from './palette/paletteStartCreateTemplate';
import { runResolvePaletteSchemas, type ResolvePaletteSchemasCommand } from './palette/paletteSetup';
import { runPaletteActivateLasso, runPaletteOpenPopup, type PaletteActivateLassoCommand, type PaletteOpenPopupCommand } from './palette/paletteUi';

import { runOpenDiagram, type OpenDiagramCommand } from './diagram/openDiagram';
import { runNewDiagram, type NewDiagramCommand } from './diagram/newDiagram';
import { runSaveDiagram, type SaveDiagramCommand } from './diagram/saveDiagram';
import { runPublishDiagram, type PublishDiagramCommand } from './diagram/publishDiagram';
import { runResetZoom, type ResetZoomCommand } from './diagram/resetZoom';
import { runImportXml, type ImportXmlCommand } from './diagram/importXml';

import { runToggleSimulation, type ToggleSimulationCommand } from './ui/toggleSimulation';
import { runDownloadSchemas, type DownloadSchemasCommand } from './ui/downloadSchemas';
import { runCreateModeler, type CreateModelerCommand } from './ui/createModeler';
import { runOpenRunner, type OpenRunnerCommand } from './ui/openRunner';

import { runUpdateAttribute, type UpdateAttributeCommand } from './attributes/updateAttribute';

import { runCreateShape, runSetColor, type CreateShapeCommand, type SetColorCommand } from './shape';

export type DiagramCommand =
  | PaletteStartCreateCommand
  | PaletteStartCreateTemplateCommand
  | ResolvePaletteSchemasCommand
  | PaletteActivateLassoCommand
  | PaletteOpenPopupCommand
  | OpenDiagramCommand
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
