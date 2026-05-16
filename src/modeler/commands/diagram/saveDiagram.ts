import download from 'downloadjs';
import { getDiagramName } from '../../diagramName';

export type SaveDiagramCommand = {
  type: 'save-diagram';
};

export async function runSaveDiagram(modeler: any, _command: SaveDiagramCommand): Promise<void> {
  const { xml } = await modeler.saveXML({ format: true });
  download(xml, `${getDiagramName(modeler) ?? 'diagram'}.studyflow`, 'application/xml');
}
