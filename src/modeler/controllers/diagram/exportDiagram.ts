/**
 * The single way a diagram leaves the app.
 *
 * Every destination — the native `.studyflow` YAML included — is an entry in
 * `models/exporters/formats`, so "save" and "export" are the same operation
 * with a different format; the Export dialog is the only UI in front of it.
 *
 * Image formats additionally carry embedded payloads (see `embed`): the
 * studyflow XML, which makes the figure reopenable here, and a draw.io
 * `<mxfile>`, which makes it editable there. Both ride *inside* a normal SVG
 * or PNG, so the file stays a plain image everywhere else.
 */
import download from 'downloadjs';
import { stampTrailForExport } from '@/modeler/models/provenanceTrail';
import { getStoredUserEmail } from '@/modeler/infra/settings/store';
import { xmlToStudyflow } from '@/core/codec';
import { toStandardBpmnXml } from '@/core/codec/io-specification';
import { toWireXml } from '@/core/codec/choreography';
import { getDiagramName } from '@/modeler/models/diagramName';
import { exportToLinkML } from '@/modeler/models/exporters/linkml';
import { exportToNidm } from '@/modeler/models/exporters/nidm';
import { exportToArtemis } from '@/modeler/models/exporters/artemis';
import { exportToDrawio } from '@/modeler/models/exporters/drawio';
import {
  embedDrawioIntoSvg,
  embedIconsInSvg,
  embedStudyflowIntoSvg,
  exportToPng,
} from '@/modeler/models/exporters/svgEmbedding';
import {
  dataUrlToBytes,
  embedDrawioIntoPng,
  embedStudyflowIntoPng,
} from '@/modeler/models/exporters/pngEmbedding';
import {
  DEFAULT_EMBED_OPTIONS,
  exportFilename,
  getExportFormat,
  type EmbedOptions,
  type ExportFormat,
  type ExportFormatId,
} from '@/modeler/models/exporters/formats';
import { remoteIconSource } from '@/modeler/infra/iconSource';

export type ExportDiagramCommand = {
  type: 'export-diagram';
  /** Defaults to the native `studyflow` format. */
  format?: ExportFormatId;
  /** Extra payloads for image formats; ignored by every other format. */
  embed?: Partial<EmbedOptions>;
};

/**
 * The diagram as BPMN XML, ready to leave the app. Pure-choreography diagrams
 * are lowered to a spec-clean `bpmn:Choreography` root first (see
 * `core/codec/choreography`); `toWireXml` is a no-op otherwise.
 */
async function toExportableXml(modeler: any): Promise<string> {
  const { xml } = await modeler.saveXML({ format: true });
  return toWireXml(xml, modeler.get('moddle'));
}

/** Rendered SVG with icon glyphs inlined, plus the XML that goes with it.
 *  The embedded XML is the standard form — a shipped figure carries pure
 *  BPMN, with the compact `binding` already lowered to `ioSpecification`. */
async function renderSvg(modeler: any): Promise<{ svg: string; xml: string }> {
  const [{ svg }, compactXml] = await Promise.all([modeler.saveSVG(), toExportableXml(modeler)]);
  const xml = await toStandardBpmnXml(compactXml, modeler.get('moddle'));
  const cleaned = svg.replace(/^(\s*<\?xml[^>]*>\s*)?(?:\s*<!--[\s\S]*?-->\s*)+/i, '$1');
  return { svg: await embedIconsInSvg(cleaned, remoteIconSource), xml };
}

async function buildPayload(
  modeler: any,
  format: ExportFormat,
  embed: EmbedOptions,
): Promise<BlobPart> {
  switch (format.id) {
    case 'studyflow':
      return xmlToStudyflow(await toExportableXml(modeler), modeler.get('moddle'));

    // Steps with data associations are lowered to the full standard
    // `ioSpecification` form on the way out, so other BPMN tooling sees
    // ordinary BPMN.
    case 'bpmn':
      return toStandardBpmnXml(await toExportableXml(modeler), modeler.get('moddle'));

    case 'drawio':
      return exportToDrawio(modeler);

    case 'linkml':
      return exportToLinkML(modeler);

    case 'nidm':
      return exportToNidm(modeler);

    case 'artemis':
      return exportToArtemis(modeler);

    case 'svg': {
      const { svg, xml } = await renderSvg(modeler);
      let out = svg;
      if (embed.drawio) out = embedDrawioIntoSvg(out, exportToDrawio(modeler));
      if (embed.studyflow) out = embedStudyflowIntoSvg(out, xml);
      return out;
    }

    case 'png': {
      const { svg, xml } = await renderSvg(modeler);
      let png = dataUrlToBytes(await exportToPng(svg));
      // Each payload lands in its own PNG chunk, at the offset its reader
      // scans (see `pngEmbedding`); neither disturbs the image data.
      if (embed.studyflow) png = embedStudyflowIntoPng(png, xml);
      if (embed.drawio) png = embedDrawioIntoPng(png, exportToDrawio(modeler));
      return png as BlobPart;
    }
  }
}

export async function runExportDiagram(modeler: any, command: ExportDiagramCommand): Promise<void> {
  const format = getExportFormat(command.format ?? 'studyflow');
  const embed = { ...DEFAULT_EMBED_OPTIONS, ...command.embed };

  // Formats that carry the diagram itself (readable back, or embedding it)
  // record the export on the provenance trail; derived documents (LinkML,
  // NIDM, ...) describe the diagram without being it, so they leave no stamp.
  if (format.importable || format.embeddable) {
    stampTrailForExport(modeler, {
      who: getStoredUserEmail(),
      tool: `studyflow-modeler/${import.meta.env.APP_VERSION}`,
    });
  }

  const filename = exportFilename(getDiagramName(modeler) ?? 'diagram', format);

  const payload = await buildPayload(modeler, format, embed);
  download(new Blob([payload], { type: format.mimeType }), filename, format.mimeType);
}
