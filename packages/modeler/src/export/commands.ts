import { exportDiagramName } from '@modeler/diagram/name';
import { carriesDiagram, exportFilename, getExportFormat, keepsPastedImages, type DiagramFormatId, type EncodeContext, type ExportFormat, type ExportFormatId } from '@modeler/diagram/formats';
import { buildExportModel } from '@modeler/export/model';
import { dataUrlToBytes, embedPastedImagesIntoPng, embedStudyflowIntoPng } from '@core/document/png';
import { embedPastedImagesIntoTiff, embedStudyflowIntoTiff, encodeTiff, protocolDigest } from '@core/document';
import { notify } from '@modeler/app/noticeStore';
import { DEFAULT_DPI, openedPrintSize, pixelsAcross, widthOnPaper, type PrintSize } from '@modeler/export/printSize';
import { dropUnresolvedIcons, embedBpmnIntoSvg, exportSize, exportToPng, exportToRaster } from '@modeler/export/svgEmbedding';
import { stampTrailForExport } from '@modeler/provenance/trail';
import { getStoredUserEmail } from '@modeler/settings/store';
import type { Editor } from '@modeler/editor/port';

export type ExportDiagramCommand = {
  type: 'ExportDiagram';
  format?: ExportFormatId;
  /** The download's name. Defaults to the diagram's name with the format's extension. */
  filename?: string;
  /** For a TIFF: its size on paper. Without one, {@link defaultPrintSize}. */
  print?: PrintSize;
};

/** What `encodeDiagram` takes besides the format. */
export type EncodeOptions = { print?: PrintSize };

// The study's XML writes each data association in the standard `ioSpecification` form, so other BPMN tooling sees ordinary BPMN.
function toBpmn(modeler: Editor): Promise<string> {
  return modeler.study.toXml();
}

/** The diagram as a `.studyflow.yaml` holds it. */
function toStudyflow(modeler: Editor): string {
  return modeler.study.toYaml();
}

/** `svg`, without the XML prolog's comments and the icons nothing resolved. */
const cleanedSvg = (svg: string): string => dropUnresolvedIcons(svg.replace(/^(\s*<\?xml[^>]*>\s*)?(?:\s*<!--[\s\S]*?-->\s*)+/i, '$1'));

/**
 * The diagram as a self-contained SVG, plus the `.studyflow.yaml` text it carries.
 *
 * No icon substitution pass: the renderer inlines each glyph from the stylesheet as a
 * real `<svg>` body, so what `toSvg` draws is already what the export carries.
 */
async function renderSvg(modeler: Editor): Promise<{ svg: string; studyflow: string }> {
  return { svg: cleanedSvg(modeler.toSvg()), studyflow: toStudyflow(modeler) };
}

/**
 * The diagram as an image, and all a reader needs to open it again: the study's text and the bytes of the images
 * pasted on it, each in a PNG chunk of its own. Drawing it anew leaves no pasted image any the worse for the last save.
 */
async function toPng(modeler: Editor): Promise<Uint8Array> {
  const drawn = dataUrlToBytes(await exportToPng(cleanedSvg(modeler.toSvg({ pastedImages: true }))));
  return embedPastedImagesIntoPng(embedStudyflowIntoPng(drawn, modeler.study.toYaml({ pastedImages: true })), modeler.study.pastedImages());
}

/** The size the figure has in the diagram's units, pasted images and padding included: what its width on paper is set against. */
export function figureSize(modeler: Editor): { width: number; height: number } {
  return exportSize(cleanedSvg(modeler.toSvg({ pastedImages: true }))) ?? { width: 1, height: 1 };
}

/**
 * The print size a TIFF of the canvas takes unless asked otherwise: the one the TIFF it was opened from declares, else
 * the diagram's own width at 0.2 mm a unit, at 300 dpi.
 */
export function defaultPrintSize(modeler: Editor, figure = figureSize(modeler)): PrintSize {
  return openedPrintSize() ?? { widthMm: widthOnPaper(figure.width), dpi: DEFAULT_DPI };
}

/**
 * The diagram as a TIFF at `print`, the figure a journal asks for: LZW, its size on paper in its resolution tags, and
 * all a reader needs to open it again, the study in its XMP packet and the pasted images in a tag of their own.
 */
async function toTiff(modeler: Editor, print = defaultPrintSize(modeler)): Promise<Uint8Array> {
  const raster = await exportToRaster(cleanedSvg(modeler.toSvg({ pastedImages: true })), pixelsAcross(print.widthMm, print.dpi));
  const { id, name } = modeler.study.root;
  const about = { id, name, digest: await protocolDigest(modeler.study.model), creatorTool: `studyflow-modeler/${import.meta.env.APP_VERSION}` };
  const drawn = embedStudyflowIntoTiff(encodeTiff(raster, print.dpi), modeler.study.toYaml({ pastedImages: true }), about);
  return embedPastedImagesIntoTiff(drawn, modeler.study.pastedImages());
}

const ENCODERS: Record<DiagramFormatId, (ctx: EncodeContext) => Promise<BlobPart> | BlobPart> = {
  studyflow: ({ modeler }) => toStudyflow(modeler),
  bpmn: ({ modeler }) => toBpmn(modeler),

  // The picture always carries its source, the BPMN XML in an SVG and the YAML in a PNG: an image that
  // cannot be reopened is a dead end, and anyone wanting a draw.io file exports that format directly.
  svg: async ({ modeler, renderSvg }) => {
    const { svg } = await renderSvg();
    return embedBpmnIntoSvg(svg, await toBpmn(modeler));
  },

  // The payload lands in its own PNG chunks, at the offset their reader scans; the image is untouched.
  png: async ({ png }) => await png() as BlobPart,
  tif: async ({ tiff }) => await tiff() as BlobPart,
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

/** Say so when a file written at someone's asking leaves out the images pasted on the canvas. */
export function sayPastedImagesLeftOut(modeler: Editor, format: ExportFormat): void {
  const count = modeler.study.pastedImages().size;
  if (count === 0 || keepsPastedImages(format)) return;
  notify('warning', `${format.extension} leaves out ${count === 1 ? 'the image' : `the ${count} images`} pasted on the canvas: only a .studyflow.png or a .studyflow.tif keeps them.`);
}

/** The bytes of the diagram in one format. Shared with saving, which writes them straight to disk. */
export function encodeDiagram(
  modeler: Editor,
  format: ExportFormat,
  options: EncodeOptions = {},
): Promise<BlobPart> | BlobPart {
  const encode = format.encode ?? ENCODERS[format.id as DiagramFormatId];
  if (!encode) throw new Error(`No encoder for export format: ${format.id}`);
  return encode({
    modeler,
    renderSvg: () => renderSvg(modeler),
    png: () => toPng(modeler),
    tiff: () => toTiff(modeler, options.print),
    bpmn: () => toBpmn(modeler),
    exportModel: () => buildExportModel(modeler),
  });
}

export async function runExportDiagram(modeler: Editor, command: ExportDiagramCommand): Promise<void> {
  const format = getExportFormat(command.format ?? 'studyflow');

  stampProvenance(modeler, format);
  sayPastedImagesLeftOut(modeler, format);

  const filename = command.filename ?? exportFilename(exportDiagramName(modeler), format);
  const payload = await encodeDiagram(modeler, format, { print: command.print });
  saveBlob(new Blob([payload], { type: format.mimeType }), filename);
}

/** Hand `blob` to the browser as a download named `filename`. */
function saveBlob(blob: Blob, filename: string): void {
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  // Not revoked at once: some browsers read the URL after `click()` returns.
  setTimeout(() => URL.revokeObjectURL(link.href), 250);
}
