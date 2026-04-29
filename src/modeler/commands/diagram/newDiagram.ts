import { runImportXml } from './importXml';
import new_diagram from '@/assets/new_diagram.bpmn';

export type NewDiagramCommand = {
  type: 'new-diagram';
};

export async function runNewDiagram(
  modeler: any,
  _command: NewDiagramCommand,
): Promise<any> {
  if (!modeler) {
    throw new Error("Command 'new-diagram' requires a modeler instance.");
  }

  const xml = await fetch(new_diagram).then((r) => r.text());
  const result = await runImportXml(modeler, { type: 'import-xml', xml });
  modeler.get('canvas').zoom('fit-viewport');
  return result;
}
