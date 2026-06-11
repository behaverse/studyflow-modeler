import download from 'downloadjs';
import { xmlToStudyflowYaml } from '@/lib/core/codec';
import { getDiagramName } from '../../diagramName';

export type SaveDiagramCommand = {
  type: 'save-diagram';
};

/** `.studyflow` files are YAML (see `lib/core/codec`); BPMN XML is available via Export As. */
export async function runSaveDiagram(modeler: any, _command: SaveDiagramCommand): Promise<void> {
  const { xml } = await modeler.saveXML({ format: true });
  const yamlText = await xmlToStudyflowYaml(xml, modeler.get('moddle'));
  download(yamlText, `${getDiagramName(modeler) ?? 'diagram'}.studyflow`, 'text/yaml');
}
