import { looksLikeXml, studyflowToXml } from '@/core/codec';
import { extractXmlFromSvg, filenameStem } from '@/modeler/models/diagramFile';
import { extractXmlFromPng } from '@/modeler/models/exporters/pngEmbedding';
import { runImportXml } from '@/modeler/controllers/diagram/importXml';
import { runUpdateAttribute } from '@/modeler/controllers/attributes/updateAttribute';

export type OpenDiagramCommand = {
  type: 'open-diagram';
  filename: string;
  /** Text for XML/YAML/SVG sources; raw bytes for exported `.png` files. */
  content: string | ArrayBuffer;
};

/** `.studyflow` content is sniffed: YAML (current format) or BPMN XML (legacy files, `.bpmn`, `.xml`). */
async function toXml(modeler: any, filename: string, content: string | ArrayBuffer): Promise<string> {
  if (filename.toLowerCase().endsWith('.png')) {
    if (typeof content === 'string') throw new Error('PNG diagrams must be opened as binary data.');
    return extractXmlFromPng(content);
  }
  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  if (filename.toLowerCase().endsWith('.svg')) return extractXmlFromSvg(text);
  if (looksLikeXml(text)) return text;
  return studyflowToXml(text, modeler.get('moddle'));
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
