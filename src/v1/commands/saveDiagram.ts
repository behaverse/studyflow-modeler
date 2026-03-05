import type { CommandContext } from './types';
import download from 'downloadjs';

export type SaveDiagramCommand = {
  type: 'save-diagram';
  diagramName: string;
};

export async function runSaveDiagram(
  context: CommandContext,
  command: SaveDiagramCommand,
): Promise<void> {
  if (!context.modeler) {
    throw new Error("Command 'save-diagram' requires a modeler instance.");
  }

  const { xml } = await context.modeler.saveXML({ format: true });
  download(xml, `${command.diagramName}.studyflow`, 'application/xml');
}
