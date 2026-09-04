import { exportDiagramName } from '@modeler/export/common';
import download from 'downloadjs';
import { toStandardBpmnXml, toWireXml, xmlToStudyflow } from '@core/document';
import { carriesDiagram, exportFilename, getExportFormat, type DiagramFormatId, type EncodeContext, type ExportFormat, type ExportFormatId } from '@modeler/export/formats';
import { buildExportModel } from '@modeler/export/model';
import { dataUrlToBytes, embedStudyflowIntoPng } from '@core/document/png';
import { embedStudyflowIntoSvg, exportToPng } from '@modeler/export/svgEmbedding';
import { stampTrailForExport } from '@modeler/provenance/trail';
import { getStoredUserEmail } from '@modeler/settings/store';
import type { Editor } from '@modeler/editor/port';

export type ExportDiagramCommand = {
  type: 'ExportDiagram';
  format?: ExportFormatId;
};

async function toExportableXml(modeler: Editor): Promise<string> {
  const { xml } = await modeler.saveXML({ format: true });
  return toWireXml(xml, modeler.model.moddle());
}

/**
 * The diagram as a self-contained SVG, plus its XML.
 *
 * No icon substitution pass: the renderer draws resolved glyphs as real `<svg>`
 * bodies (`draw/iconCache.ts`), so what the canvas serializes
 * is already what the export carries.
 */
async function renderSvg(modeler: Editor): Promise<{ svg: string; xml: string }> {
  // The SVG first, synchronously: it is a snapshot of the canvas as it stands, and
  // `toExportableXml` walks the same live moddle tree.
  const svg = modeler.canvas.toSVG();
  const compactXml = await toExportableXml(modeler);
  const xml = await toStandardBpmnXml(compactXml, modeler.model.moddle());
  const cleaned = svg.replace(/^(\s*<\?xml[^>]*>\s*)?(?:\s*<!--[\s\S]*?-->\s*)+/i, '$1');
  return { svg: cleaned, xml };
}

const ENCODERS: Record<DiagramFormatId, (ctx: EncodeContext) => Promise<BlobPart> | BlobPart> = {
  studyflow: async ({ modeler }) =>
    xmlToStudyflow(await toExportableXml(modeler), modeler.model.moddle()),

  // Data associations are lowered to the standard `ioSpecification` form so other BPMN tooling sees ordinary BPMN.
  bpmn: async ({ modeler }) =>
    toStandardBpmnXml(await toExportableXml(modeler), modeler.model.moddle()),

  // The picture always carries its source: an image that cannot be reopened is a dead end, and
  // anyone wanting a draw.io file exports that format directly.
  svg: async ({ renderSvg }) => {
    const { svg, xml } = await renderSvg();
    return embedStudyflowIntoSvg(svg, xml);
  },

  png: async ({ renderSvg }) => {
    const { svg, xml } = await renderSvg();
    // The payload lands in its own PNG chunk, at the offset its reader scans; the image is untouched.
    return embedStudyflowIntoPng(dataUrlToBytes(await exportToPng(svg)), xml) as BlobPart;
  },
};

/**
 * Records that this artifact was produced, for the formats that carry the diagram itself; derived
 * documents leave no stamp. Whether an invocation deserves one at all is the caller's call — the
 * auto-save deliberately does not ask.
 *
 * Lives here rather than beside the rest of the trail because it reads the build version through
 * `import.meta`, and `provenance/trail.ts` is loaded by the browserless unit specs, which cannot.
 */
export function stampProvenance(modeler: Editor, format: ExportFormat): void {
  if (!carriesDiagram(format)) return;
  stampTrailForExport(modeler, {
    who: getStoredUserEmail(),
    tool: `studyflow-modeler/${import.meta.env.APP_VERSION}`,
  });
}

/** The bytes of the diagram in one format. Shared with saving, which writes them straight to disk. */
export function encodeDiagram(
  modeler: Editor,
  format: ExportFormat,
): Promise<BlobPart> | BlobPart {
  const encode = format.encode ?? ENCODERS[format.id as DiagramFormatId];
  if (!encode) throw new Error(`No encoder for export format: ${format.id}`);
  return encode({ modeler, renderSvg: () => renderSvg(modeler), exportModel: () => buildExportModel(modeler) });
}

export async function runExportDiagram(modeler: Editor, command: ExportDiagramCommand): Promise<void> {
  const format = getExportFormat(command.format ?? 'studyflow');

  stampProvenance(modeler, format);

  const filename = exportFilename(exportDiagramName(modeler), format);
  const payload = await encodeDiagram(modeler, format);
  download(new Blob([payload], { type: format.mimeType }), filename, format.mimeType);
}
