import download from 'downloadjs';

export type SaveDiagramCommand = {
  type: 'save-diagram';
  diagramName: string;
};

export async function runSaveDiagram(
  modeler: any,
  command: SaveDiagramCommand,
): Promise<void> {
  if (!modeler) {
    throw new Error("Command 'save-diagram' requires a modeler instance.");
  }

  const { xml } = await modeler.saveXML({ format: true });
  download(xml, `${command.diagramName}.studyflow`, 'application/xml');
}
