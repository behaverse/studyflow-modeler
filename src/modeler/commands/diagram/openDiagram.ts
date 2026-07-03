import { looksLikeXml, studyflowToXml } from '@/lib/core/studyflowYaml';
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

/** `.studyflow` content is sniffed: YAML (current format) or BPMN XML (legacy files, `.bpmn`, `.xml`). */
async function toXml(modeler: any, filename: string, content: string): Promise<string> {
  if (filename.toLowerCase().endsWith('.svg')) return extractXmlFromSvg(content);
  if (looksLikeXml(content)) return content;
  return studyflowToXml(content, modeler.get('moddle'));
}

export async function runOpenDiagram(modeler: any, command: OpenDiagramCommand): Promise<any> {
  const xml = await toXml(modeler, command.filename, command.content);

  const result = await runImportXml(modeler, { type: 'import-xml', xml });

  // Best-effort fit. bpmn-js's fit math can yield a non-finite scale for some
  // valid diagrams (e.g. collaborations whose collapsed sub-process drilldown
  // planes momentarily present a degenerate viewport). A failed auto-fit must
  // not abort opening an otherwise-valid diagram.
  try {
    modeler.get('canvas').zoom('fit-viewport');
  } catch (err) {
    console.warn('Zoom to fit-viewport failed after open; leaving default zoom.', err);
  }

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
