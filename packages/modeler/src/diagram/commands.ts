import new_diagram from '#assets/new_diagram.studyflow.yaml?raw';
import { looksLikeXml } from '@core/document';
import { filenameStem } from '@modeler/diagram/file';
import { markOpened, unlinkFile } from '@modeler/diagram/fileHandle';
import { importableFormatFor, openerFor } from '@modeler/diagram/formats';
import { extractPastedImagesFromPng, extractStudyflowFromPng } from '@core/document/png';
import { extractStudyflowFromSvg } from '@core/document/svg';
import { extractPastedImagesFromTiff, extractStudyflowFromTiff, tiffResolution, tiffSize } from '@core/document/tiff';
import { notify } from '@modeler/app/noticeStore';
import { rememberOpenedPrintSize, type PrintSize } from '@modeler/export/printSize';
import { resetTrailStamping } from '@modeler/provenance/trail';
import type { Editor } from '@modeler/editor/port';

export type ResetZoomCommand = {
  type: 'ResetZoom';
};

export function runResetZoom(modeler: Editor, _command: ResetZoomCommand): void {
  modeler.canvas.zoom('fit');
}

export type TidyLayoutCommand = {
  type: 'TidyLayout';
};

/** Lay the diagram out afresh as one edit (the study's `layout`), and fit it. */
export function runTidyLayout(modeler: Editor, _command: TidyLayoutCommand): void {
  const result = modeler.study.layout();
  if (!result.ok) notify('error', `Tidy Layout failed: ${result.reason}`);
  else modeler.canvas.zoom('fit');
}


export type NewDiagramCommand = {
  type: 'NewDiagram';
};

export async function runNewDiagram(modeler: Editor, _command: NewDiagramCommand): Promise<void> {
  await openText(modeler, new_diagram);
  modeler.canvas.zoom('fit');
}

/** Put the study `text` spells on the canvas; `onWarning` hears what reading it could not place, and `pastedImages` are the bytes of the images it names. */
async function openText(
  modeler: Editor,
  text: string,
  onWarning?: (message: string) => void,
  pastedImages?: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  // Whatever was linked described the canvas being replaced. Carrying the link across would point
  // auto-save at that file and overwrite it with an unrelated diagram; `runOpenDiagram` links
  // again once it knows which file the new canvas actually came from.
  unlinkFile();
  // Whatever print size the last TIFF declared described the canvas being replaced.
  rememberOpenedPrintSize(undefined);

  await modeler.open(text, onWarning, pastedImages);
  // `open` starts the undo history over, so the trail bookkeeping restarts with it.
  resetTrailStamping(modeler);
  // The canvas is now exactly what was opened, whichever path got here. `runOpenDiagram` marks
  // again after its rename, which is the one edit that is part of opening rather than after it.
  markOpened();
}


export type OpenDiagramCommand = {
  type: 'OpenDiagram';
  filename: string;
  content: string | ArrayBuffer;
};

/** The file as text: what an image carries, else the file itself. */
function fileText(filename: string, content: string | ArrayBuffer): string {
  const format = importableFormatFor(filename);

  if (format?.id === 'png' || format?.id === 'tif') {
    if (typeof content === 'string') throw new Error('PNG and TIFF diagrams must be opened as binary data.');
    return format.id === 'png' ? extractStudyflowFromPng(content) : extractStudyflowFromTiff(content);
  }

  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  return format?.id === 'svg' ? extractStudyflowFromSvg(text) : text;
}

/** The images pasted on the study, which a PNG or a TIFF keeps beside it. */
function pastedImagesIn(filename: string, content: string | ArrayBuffer): ReadonlyMap<string, Uint8Array> | undefined {
  const format = importableFormatFor(filename);
  if (typeof content === 'string') return undefined;
  if (format?.id === 'png') return extractPastedImagesFromPng(content);
  if (format?.id === 'tif') return extractPastedImagesFromTiff(content);
  return undefined;
}

/** The size on paper a TIFF declares, its width in pixels over its dots per inch, so a save writes it back at that size. */
function printSizeOf(filename: string, content: string | ArrayBuffer): PrintSize | undefined {
  if (importableFormatFor(filename)?.id !== 'tif' || typeof content === 'string') return undefined;
  const resolution = tiffResolution(content);
  return resolution && { widthMm: Math.round((tiffSize(content).width / resolution.x) * 254) / 10, dpi: Math.round(resolution.x * 10) / 10 };
}

/** The study the file holds, as `.studyflow.yaml` or BPMN XML text. */
function studyText(modeler: Editor, filename: string, content: string | ArrayBuffer): string {
  const text = fileText(filename, content);
  if (looksLikeXml(text)) return text;
  // A foreign format a skill opens (a jsPsych timeline): converted to a studyflow on the way in, same "Open".
  const opener = openerFor(filename);
  if (!opener) return text;
  return opener.toStudyflow(text, {
    name: filenameStem(filename),
    metamodel: modeler.model.metamodel(),
    warn: (message) => notify('warning', message),
  });
}

export async function runOpenDiagram(modeler: Editor, command: OpenDiagramCommand): Promise<void> {
  // Anything the reader could not place will be missing from the next save, so report it, as `studyflow validate` does.
  const warnings: string[] = [];
  await openText(modeler, studyText(modeler, command.filename, command.content), (message) => { warnings.push(message); }, pastedImagesIn(command.filename, command.content));
  rememberOpenedPrintSize(printSizeOf(command.filename, command.content));
  if (warnings.length > 0) {
    notify('warning', [`Reading ${command.filename} raised warnings:`, ...warnings].join('\n'), { keep: true });
  }

  try {
    modeler.canvas.zoom('fit');
  } catch (err) {
    console.warn('Zoom to fit-viewport failed after open; leaving default zoom.', err);
  }

  const root = modeler.study.root;
  if (!root.name) modeler.study.set({ id: root.id, attribute: 'name', value: filenameStem(command.filename) });

  // Everything up to here is the file, not an edit of it, so auto-save has nothing to write yet.
  markOpened();
}
