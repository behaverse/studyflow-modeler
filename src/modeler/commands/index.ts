import type { PaletteStartCreateCommand } from './palette/paletteStartCreate';
import { runPaletteStartCreate } from './palette/paletteStartCreate';
import type { PaletteRegisterSchemaProvidersCommand } from './palette/paletteSetup';
import { runPaletteRegisterSchemaProviders } from './palette/paletteSetup';
import type { PaletteActivateLassoCommand, PaletteOpenPopupCommand } from './palette/paletteUi';
import { runPaletteActivateLasso, runPaletteOpenPopup } from './palette/paletteUi';

import type { LoginAsGuestCommand, LoginCommand } from './auth';
import { runLoginAsGuest, runLogin } from './auth';

import type { OpenDiagramCommand } from './diagram/openDiagram';
import { runOpenDiagram } from './diagram/openDiagram';
import type { NewDiagramCommand } from './diagram/newDiagram';
import { runNewDiagram } from './diagram/newDiagram';
import type { SaveDiagramCommand } from './diagram/saveDiagram';
import { runSaveDiagram } from './diagram/saveDiagram';
import type { ExportDiagramCommand } from './diagram/exportDiagram';
import { runExportDiagram } from './diagram/exportDiagram';
import type { PublishDiagramCommand } from './diagram/publishDiagram';
import { runPublishDiagram } from './diagram/publishDiagram';
import type { ResetZoomCommand } from './diagram/resetZoom';
import { runResetZoom } from './diagram/resetZoom';
import type { ImportXmlCommand } from './diagram/importXml';
import { runImportXml } from './diagram/importXml';

import type { ToggleSimulationCommand } from './ui/toggleSimulation';
import { runToggleSimulation } from './ui/toggleSimulation';
import type { DownloadSchemasCommand } from './ui/downloadSchemas';
import { runDownloadSchemas } from './ui/downloadSchemas';
import type { CreateModelerCommand } from './ui/createModeler';
import { runCreateModeler } from './ui/createModeler';

import type { UpdatePropertyCommand } from './properties/updateProperty';
import { runUpdateProperty } from './properties/updateProperty';
import type { UpdateModdlePropertiesCommand } from './properties/updateModdleProperties';
import { runUpdateModdleProperties } from './properties/updateModdleProperties';
import type { InspectorUpdatePropertyCommand } from './properties/inspectorUpdateProperty';
import { runInspectorUpdateProperty } from './properties/inspectorUpdateProperty';

import type { CreateShapeCommand } from './shape';
import { runCreateShape } from './shape';

export type DiagramCommand =
  | PaletteStartCreateCommand
  | InspectorUpdatePropertyCommand
  | PaletteRegisterSchemaProvidersCommand
  | PaletteActivateLassoCommand
  | PaletteOpenPopupCommand
  | LoginAsGuestCommand
  | LoginCommand
  | OpenDiagramCommand
  | NewDiagramCommand
  | SaveDiagramCommand
  | ExportDiagramCommand
  | PublishDiagramCommand
  | ToggleSimulationCommand
  | ResetZoomCommand
  | DownloadSchemasCommand
  | CreateModelerCommand
  | ImportXmlCommand
  | UpdatePropertyCommand
  | UpdateModdlePropertiesCommand
  | CreateShapeCommand;

/**
 * Map of command-type → handler. The `Extract` generic ensures each handler's
 * second parameter is the exact command variant for that type, so adding a
 * new `DiagramCommand` will fail compile until it's added to this map.
 *
 * The first argument is the bpmn-js modeler (or any DI container with
 * `.get(service)` — e.g., the `injector` token). Handlers that don't need the
 * modeler (login, download-schemas, create-modeler) ignore it.
 */
type HandlerMap = {
  [K in DiagramCommand['type']]: (
    modeler: any,
    command: Extract<DiagramCommand, { type: K }>,
  ) => unknown;
};

const HANDLERS: HandlerMap = {
  'palette-start-create': runPaletteStartCreate,
  'inspector-update-property': runInspectorUpdateProperty,
  'palette-register-schema-providers': runPaletteRegisterSchemaProviders,
  'palette-activate-lasso': runPaletteActivateLasso,
  'palette-open-popup': runPaletteOpenPopup,
  'login-as-guest': (_modeler, cmd) => runLoginAsGuest(cmd),
  login: (_modeler, cmd) => runLogin(cmd),
  'open-diagram': runOpenDiagram,
  'new-diagram': runNewDiagram,
  'save-diagram': runSaveDiagram,
  'export-diagram': runExportDiagram,
  'publish-diagram': runPublishDiagram,
  'toggle-simulation': runToggleSimulation,
  'reset-zoom': runResetZoom,
  'download-schemas': (_modeler, cmd) => runDownloadSchemas(cmd),
  'create-modeler': (_modeler, cmd) => runCreateModeler(cmd),
  'import-xml': runImportXml,
  'update-property': runUpdateProperty,
  'update-moddle-properties': runUpdateModdleProperties,
  'create-shape': runCreateShape,
};

/**
 * Dispatch a typed `DiagramCommand` through its registered handler.
 *
 * `modeler` should be the bpmn-js modeler instance (or any object exposing
 * `.get(service)` — e.g., the DI `injector` from inside a bpmn-js service).
 * Pass `null` for handlers that don't need it (login, download-schemas,
 * create-modeler).
 */
export async function executeCommand(
  modeler: any,
  command: DiagramCommand,
): Promise<any> {
  const handler = HANDLERS[command.type] as (
    m: any,
    cmd: DiagramCommand,
  ) => unknown;
  if (!handler) return undefined;
  return handler(modeler, command);
}
