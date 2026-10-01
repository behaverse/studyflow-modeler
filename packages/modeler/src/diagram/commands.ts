import new_diagram from '#assets/new_diagram.studyflow.yaml?raw';
import { looksLikeXml } from '@core/document';
import { filenameStem } from '@modeler/diagram/file';
import { markOpened, unlinkFile } from '@modeler/diagram/fileHandle';
import { importableFormatFor, openerFor } from '@modeler/diagram/formats';
import { extractStudyflowFromPng } from '@core/document/png';
import { extractStudyflowFromSvg } from '@core/document/svg';
import { notify } from '@modeler/app/noticeStore';
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

/** Put the study `text` spells on the canvas; `onWarning` hears what reading it could not place. */
async function openText(modeler: Editor, text: string, onWarning?: (message: string) => void): Promise<void> {
  // Whatever was linked described the canvas being replaced. Carrying the link across would point
  // auto-save at that file and overwrite it with an unrelated diagram; `runOpenDiagram` links
  // again once it knows which file the new canvas actually came from.
  unlinkFile();

  await modeler.open(text, onWarning);
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

  if (format?.id === 'png') {
    if (typeof content === 'string') throw new Error('PNG diagrams must be opened as binary data.');
    return extractStudyflowFromPng(content);
  }

  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  return format?.id === 'svg' ? extractStudyflowFromSvg(text) : text;
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
  // What reading could not place is gone from the next save, so say what it met, as `studyflow validate` does.
  const warnings: string[] = [];
  await openText(modeler, studyText(modeler, command.filename, command.content), (message) => { warnings.push(message); });
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
