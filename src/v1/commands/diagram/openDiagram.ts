import { runImportXml } from './importXml';

export type OpenDiagramCommand = {
  type: 'open-diagram';
  filename: string;
  content: string;
  setDiagramName?: (name: string) => void;
};

function extractXmlFromSvg(svgText: string): string {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
  const studyflowEl = svgDoc.querySelector('metadata > studyflow');
  if (!studyflowEl) {
    throw new Error('The selected SVG file does not contain embedded Studyflow.');
  }
  return studyflowEl.innerHTML;
}

export async function runOpenDiagram(
  modeler: any,
  command: OpenDiagramCommand,
): Promise<any> {
  if (!modeler) {
    throw new Error("Command 'open-diagram' requires a modeler instance.");
  }

  let xml = command.content;

  if (command.filename.toLowerCase().endsWith('.svg')) {
    xml = extractXmlFromSvg(command.content);
  }

  const result = await runImportXml(modeler, { type: 'import-xml', xml });

  modeler.get('canvas').zoom('fit-viewport');

  if (command.setDiagramName) {
    const nameWithoutExt = command.filename.replace(/\.[^/.]+$/, '');
    command.setDiagramName(nameWithoutExt);
  }

  return result;
}
