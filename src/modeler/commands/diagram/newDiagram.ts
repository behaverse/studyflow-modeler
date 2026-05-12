import { runImportXml } from './importXml';
import new_diagram from '@/assets/examples/new_diagram.bpmn?raw';

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

  const result = await runImportXml(modeler, { type: 'import-xml', xml: new_diagram });
  modeler.get('canvas').zoom('fit-viewport');
  return result;
}
