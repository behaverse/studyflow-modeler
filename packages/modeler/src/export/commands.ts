import { exportDiagramName } from '@modeler/export/common';
import download from 'downloadjs';
import { toStandardBpmnXml, toWireXml, xmlToStudyflow } from '@core/document';
import { exportToArtemis } from '@modeler/export/artemis';
import { exportToDrawio } from '@modeler/export/drawio';
import { DEFAULT_EMBED_OPTIONS, exportFilename, getExportFormat, type EmbedOptions, type ExportFormatId } from '@modeler/export/formats';
import { exportToLinkML } from '@modeler/export/linkml';
import { buildExportModel, type ExportModel } from '@modeler/export/model';
import { exportToNidm } from '@modeler/export/nidm';
import { dataUrlToBytes, embedDrawioIntoPng, embedStudyflowIntoPng } from '@core/document/png';
import { embedDrawioIntoSvg, embedStudyflowIntoSvg, exportToPng } from '@modeler/export/svgEmbedding';
import { stampTrailForExport } from '@modeler/provenance/trail';
import { getStoredUserEmail } from '@modeler/settings/store';
import type { Editor } from '@modeler/editor/port';

export type ExportDiagramCommand = {
  type: 'ExportDiagram';
  format?: ExportFormatId;
  embed?: Partial<EmbedOptions>;
};

async function toExportableXml(modeler: Editor): Promise<string> {
  const { xml } = await modeler.saveXML({ format: true });
  return toWireXml(xml, modeler.model.moddle());
}

/**
 * The diagram as a self-contained SVG, plus its XML.
 *
 * No icon substitution pass: the renderer draws resolved glyphs as real `<svg>`
 * bodies (`draw/iconCache.ts`, parity addendum 6 §2), so what the canvas serializes
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

const ENCODERS: Record<ExportFormatId, (ctx: {
  modeler: Editor;
  embed: EmbedOptions;
  renderSvg: () => Promise<{ svg: string; xml: string }>;
  /** The semantic view of the diagram, built on demand; only the interchange formats read it. */
  exportModel: () => ExportModel;
}) => Promise<BlobPart> | BlobPart> = {
  studyflow: async ({ modeler }) =>
    xmlToStudyflow(await toExportableXml(modeler), modeler.model.moddle()),

  // Data associations are lowered to the standard `ioSpecification` form so other BPMN tooling sees ordinary BPMN.
  bpmn: async ({ modeler }) =>
    toStandardBpmnXml(await toExportableXml(modeler), modeler.model.moddle()),

  drawio: ({ modeler }) => exportToDrawio(modeler),
  linkml: ({ exportModel }) => exportToLinkML(exportModel()),
  nidm: ({ exportModel }) => exportToNidm(exportModel()),
  artemis: ({ exportModel }) => exportToArtemis(exportModel()),

  svg: async ({ modeler, embed, renderSvg }) => {
    const { svg, xml } = await renderSvg();
    let out = svg;
    if (embed.drawio) out = embedDrawioIntoSvg(out, exportToDrawio(modeler));
    if (embed.studyflow) out = embedStudyflowIntoSvg(out, xml);
    return out;
  },

  png: async ({ modeler, embed, renderSvg }) => {
    const { svg, xml } = await renderSvg();
    let png = dataUrlToBytes(await exportToPng(svg));
    // Each payload lands in its own PNG chunk at the offset its reader scans; neither disturbs the image data.
    if (embed.studyflow) png = embedStudyflowIntoPng(png, xml);
    if (embed.drawio) png = embedDrawioIntoPng(png, exportToDrawio(modeler));
    return png as BlobPart;
  },
};

export async function runExportDiagram(modeler: Editor, command: ExportDiagramCommand): Promise<void> {
  const format = getExportFormat(command.format ?? 'studyflow');
  const embed = { ...DEFAULT_EMBED_OPTIONS, ...command.embed };

  // Only formats that carry the diagram itself stamp the provenance trail; derived documents leave no stamp.
  if (format.importable || format.embeddable) {
    stampTrailForExport(modeler, {
      who: getStoredUserEmail(),
      tool: `studyflow-modeler/${import.meta.env.APP_VERSION}`,
    });
  }

  const filename = exportFilename(exportDiagramName(modeler), format);

  const payload = await ENCODERS[format.id]({
    modeler,
    embed,
    renderSvg: () => renderSvg(modeler),
    exportModel: () => buildExportModel(modeler),
  });
  download(new Blob([payload], { type: format.mimeType }), filename, format.mimeType);
}
