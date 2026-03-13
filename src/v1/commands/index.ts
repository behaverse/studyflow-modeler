import type { CommandContext } from './types';
import type { PaletteStartCreateCommand } from './paletteStartCreate';
import { runPaletteStartCreate } from './paletteStartCreate';
import type { InspectorUpdatePropertyCommand } from './inspectorUpdateProperty';
import { runInspectorUpdateProperty } from './inspectorUpdateProperty';
import type { PaletteRegisterSchemaProvidersCommand } from './paletteSetup';
import { runPaletteRegisterSchemaProviders } from './paletteSetup';
import type {
  PaletteActivateLassoCommand,
  PaletteOpenPopupCommand,
} from './paletteUi';
import {
  runPaletteActivateLasso,
  runPaletteOpenPopup,
} from './paletteUi';
import type {
  LoginAsGuestCommand,
  LoginCommand,
} from './auth';
import {
  runLoginAsGuest,
  runLogin,
} from './auth';
import type { OpenDiagramCommand } from './openDiagram';
import { runOpenDiagram } from './openDiagram';
import type { NewDiagramCommand } from './newDiagram';
import { runNewDiagram } from './newDiagram';
import type { SaveDiagramCommand } from './saveDiagram';
import { runSaveDiagram } from './saveDiagram';
import type { ExportDiagramCommand } from './exportDiagram';
import { runExportDiagram } from './exportDiagram';
import type { PublishDiagramCommand } from './publishDiagram';
import { runPublishDiagram } from './publishDiagram';
import type { ToggleSimulationCommand } from './toggleSimulation';
import { runToggleSimulation } from './toggleSimulation';
import type { ResetZoomCommand } from './resetZoom';
import { runResetZoom } from './resetZoom';
import type { DownloadSchemasCommand } from './downloadSchemas';
import { runDownloadSchemas } from './downloadSchemas';
import type { CreateModelerCommand } from './createModeler';
import { runCreateModeler } from './createModeler';
import type { ImportXmlCommand } from './importXml';
import { runImportXml } from './importXml';
import type { UpdatePropertyCommand } from './updateProperty';
import { runUpdateProperty } from './updateProperty';
import type { UpdateModdlePropertiesCommand } from './updateModdleProperties';
import { runUpdateModdleProperties } from './updateModdleProperties';
import type { CreateShapeCommand } from './createShape';
import { runCreateShape } from './createShape';

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

function normalizeContext(contextOrModeler: any): CommandContext {
  if (!contextOrModeler) return {};

  // bpmn-js modeler has .get(service)
  if (typeof contextOrModeler.get === 'function') {
    return { modeler: contextOrModeler };
  }

  // modeling service has updateProperties/updateModdleProperties
  if (
    typeof contextOrModeler.updateProperties === 'function' ||
    typeof contextOrModeler.updateModdleProperties === 'function'
  ) {
    return { modeling: contextOrModeler };
  }

  return contextOrModeler;
}

export async function executeCommand(
  contextOrModeler: any,
  command: DiagramCommand,
): Promise<any> {
  const context = normalizeContext(contextOrModeler);

  switch (command.type) {
    case 'palette-start-create':
      return runPaletteStartCreate(context, command);

    case 'inspector-update-property':
      return runInspectorUpdateProperty(context, command);

    case 'palette-register-schema-providers':
      return runPaletteRegisterSchemaProviders(context, command);

    case 'palette-activate-lasso':
      return runPaletteActivateLasso(context, command);

    case 'palette-open-popup':
      return runPaletteOpenPopup(context, command);

    case 'login-as-guest':
      return runLoginAsGuest(command);

    case 'login':
      return runLogin(command);

    case 'open-diagram':
      return runOpenDiagram(context, command);

    case 'new-diagram':
      return runNewDiagram(context, command);

    case 'save-diagram':
      return runSaveDiagram(context, command);

    case 'export-diagram':
      return runExportDiagram(context, command);

    case 'publish-diagram':
      return runPublishDiagram(context, command);

    case 'toggle-simulation':
      return runToggleSimulation(context, command);

    case 'reset-zoom':
      return runResetZoom(context, command);

    case 'download-schemas':
      return runDownloadSchemas(command);

    case 'create-modeler':
      return runCreateModeler(command);

    case 'import-xml':
      return runImportXml(context, command);

    case 'update-property':
      runUpdateProperty(context, command);
      return undefined;

    case 'update-moddle-properties':
      runUpdateModdleProperties(context, command);
      return undefined;

    case 'create-shape':
      return runCreateShape(context, command);

    default:
      return undefined;
  }
}
