import { exportDiagramName } from '@modeler/export/common';
import download from 'downloadjs';
import { toStandardBpmnXml, toWireXml, xmlToStudyflow } from '@core/document';
import { exportToArtemis } from '@modeler/export/artemis';
import { exportToDrawio } from '@modeler/export/drawio';
import { carriesDiagram, exportFilename, getExportFormat, type ExportFormat, type ExportFormatId } from '@modeler/export/formats';
import { remoteIconSource } from '@modeler/export/iconSource';
import { exportToLinkML } from '@modeler/export/linkml';
import { buildExportModel, type ExportModel } from '@modeler/export/model';
import { exportToNidm } from '@modeler/export/nidm';
import { dataUrlToBytes, embedStudyflowIntoPng } from '@core/document/png';
import { embedIconsInSvg, embedStudyflowIntoSvg, exportToPng } from '@modeler/export/svgEmbedding';
import { stampTrailForExport } from '@modeler/provenance/trail';
import { getStoredUserEmail } from '@modeler/settings/store';
import type { Modeler } from '@modeler/bpmn/types';

export type ExportDiagramCommand = {
  type: 'ExportDiagram';
  format?: ExportFormatId;
};

async function toExportableXml(modeler: Modeler): Promise<string> {
  const { xml } = await modeler.saveXML({ format: true });
  return toWireXml(xml, modeler.get('moddle'));
}

async function renderSvg(modeler: Modeler): Promise<{ svg: string; xml: string }> {
  const [{ svg }, compactXml] = await Promise.all([modeler.saveSVG(), toExportableXml(modeler)]);
  const xml = await toStandardBpmnXml(compactXml, modeler.get('moddle'));
  const cleaned = svg.replace(/^(\s*<\?xml[^>]*>\s*)?(?:\s*<!--[\s\S]*?-->\s*)+/i, '$1');
  return { svg: await embedIconsInSvg(cleaned, remoteIconSource), xml };
}

const ENCODERS: Record<ExportFormatId, (ctx: {
  modeler: Modeler;
  renderSvg: () => Promise<{ svg: string; xml: string }>;
  /** The semantic view of the diagram, built on demand; only the interchange formats read it. */
  exportModel: () => ExportModel;
}) => Promise<BlobPart> | BlobPart> = {
  studyflow: async ({ modeler }) =>
    xmlToStudyflow(await toExportableXml(modeler), modeler.get('moddle')),

  // Data associations are lowered to the standard `ioSpecification` form so other BPMN tooling sees ordinary BPMN.
  bpmn: async ({ modeler }) =>
    toStandardBpmnXml(await toExportableXml(modeler), modeler.get('moddle')),

  drawio: ({ modeler }) => exportToDrawio(modeler),
  linkml: ({ exportModel }) => exportToLinkML(exportModel()),
  nidm: ({ exportModel }) => exportToNidm(exportModel()),
  artemis: ({ exportModel }) => exportToArtemis(exportModel()),

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
export function stampProvenance(modeler: Modeler, format: ExportFormat): void {
  if (!carriesDiagram(format)) return;
  stampTrailForExport(modeler, {
    who: getStoredUserEmail(),
    tool: `studyflow-modeler/${import.meta.env.APP_VERSION}`,
  });
}

/** The bytes of the diagram in one format. Shared with saving, which writes them straight to disk. */
export function encodeDiagram(
  modeler: Modeler,
  format: ExportFormat,
): Promise<BlobPart> | BlobPart {
  return ENCODERS[format.id]({
    modeler,
    renderSvg: () => renderSvg(modeler),
    exportModel: () => buildExportModel(modeler),
  });
}

export async function runExportDiagram(modeler: Modeler, command: ExportDiagramCommand): Promise<void> {
  const format = getExportFormat(command.format ?? 'studyflow');

  stampProvenance(modeler, format);

  const filename = exportFilename(exportDiagramName(modeler), format);
  const payload = await encodeDiagram(modeler, format);
  download(new Blob([payload], { type: format.mimeType }), filename, format.mimeType);
}
