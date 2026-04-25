import type { CommandContext } from './types';
import { normalizeContext } from './context';

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
 */
type HandlerMap = {
  [K in DiagramCommand['type']]: (
    context: CommandContext,
    command: Extract<DiagramCommand, { type: K }>,
  ) => unknown;
};

const HANDLERS: HandlerMap = {
  'palette-start-create': (ctx, cmd) => runPaletteStartCreate(ctx, cmd),
  'inspector-update-property': (ctx, cmd) => runInspectorUpdateProperty(ctx, cmd),
  'palette-register-schema-providers': (ctx, cmd) => runPaletteRegisterSchemaProviders(ctx, cmd),
  'palette-activate-lasso': (ctx, cmd) => runPaletteActivateLasso(ctx, cmd),
  'palette-open-popup': (ctx, cmd) => runPaletteOpenPopup(ctx, cmd),
  'login-as-guest': (_ctx, cmd) => runLoginAsGuest(cmd),
  login: (_ctx, cmd) => runLogin(cmd),
  'open-diagram': (ctx, cmd) => runOpenDiagram(ctx, cmd),
  'new-diagram': (ctx, cmd) => runNewDiagram(ctx, cmd),
  'save-diagram': (ctx, cmd) => runSaveDiagram(ctx, cmd),
  'export-diagram': (ctx, cmd) => runExportDiagram(ctx, cmd),
  'publish-diagram': (ctx, cmd) => runPublishDiagram(ctx, cmd),
  'toggle-simulation': (ctx, cmd) => runToggleSimulation(ctx, cmd),
  'reset-zoom': (ctx, cmd) => runResetZoom(ctx, cmd),
  'download-schemas': (_ctx, cmd) => runDownloadSchemas(cmd),
  'create-modeler': (_ctx, cmd) => runCreateModeler(cmd),
  'import-xml': (ctx, cmd) => runImportXml(ctx, cmd),
  'update-property': (ctx, cmd) => {
    runUpdateProperty(ctx, cmd);
    return undefined;
  },
  'update-moddle-properties': (ctx, cmd) => {
    runUpdateModdleProperties(ctx, cmd);
    return undefined;
  },
  'create-shape': (ctx, cmd) => runCreateShape(ctx, cmd),
};

/**
 * Dispatch a typed `DiagramCommand` through its registered handler.
 *
 * The first argument can be:
 * - a bpmn-js modeler instance (preferred),
 * - a bare `modeling` service (back-compat for a few low-level callers),
 * - an already-shaped `CommandContext`, or
 * - `null` for handlers that don't need any context (e.g., login).
 */
export async function executeCommand(
  contextOrModeler: any,
  command: DiagramCommand,
): Promise<any> {
  const context = normalizeContext(contextOrModeler);
  const handler = HANDLERS[command.type] as (
    ctx: CommandContext,
    cmd: DiagramCommand,
  ) => unknown;
  if (!handler) return undefined;
  return handler(context, command);
}
