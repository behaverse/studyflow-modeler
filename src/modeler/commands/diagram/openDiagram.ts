import { runImportXml } from './importXml';
import { runUpdateAttribute } from '../attributes/updateAttribute';

export type OpenDiagramCommand = {
  type: 'open-diagram';
  filename: string;
  content: string;
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

const filenameStem = (filename: string) => filename.replace(/\.[^/.]+$/, '');

export async function runOpenDiagram(modeler: any, command: OpenDiagramCommand): Promise<any> {
  const xml = command.filename.toLowerCase().endsWith('.svg')
    ? extractXmlFromSvg(command.content)
    : command.content;

  const result = await runImportXml(modeler, { type: 'import-xml', xml });
  modeler.get('canvas').zoom('fit-viewport');

  // Derive a name from the filename if the diagram didn't ship with one.
  const root = modeler.get('canvas').getRootElement();
  const embedded = root?.businessObject?.name;
  if (root && (typeof embedded !== 'string' || embedded.length === 0)) {
    runUpdateAttribute(modeler, {
      type: 'update-attribute',
      element: root,
      attributeName: 'name',
      value: filenameStem(command.filename),
    });
  }

  return result;
}
