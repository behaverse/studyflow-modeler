import new_diagram from '#assets/new_diagram.bpmn?raw';
import { fromWireXml, looksLikeXml, studyflowToXml } from '@core/document';
import { loadSchemas } from '@core/notation/loader';
import { setAttribute } from '@core/element';
import { ensureDiagramLayout } from '@modeler/diagram/autoLayout';
import { extractXmlFromSvg, filenameStem } from '@modeler/diagram/file';
import { markOpened, unlinkFile } from '@modeler/diagram/fileHandle';
import { importableFormatFor, openerFor } from '@modeler/export/formats';
import { extractXmlFromPng } from '@core/document/png';
import { notify } from '@modeler/app/noticeStore';
import { resetTrailStamping } from '@modeler/provenance/trail';
import { getSettings } from '@modeler/settings/store';
import type { Editor } from '@modeler/editor/port';

export type ResetZoomCommand = {
  type: 'ResetZoom';
};

export function runResetZoom(modeler: Editor, _command: ResetZoomCommand): void {
  modeler.canvas.zoomToFit();
}


export type NewDiagramCommand = {
  type: 'NewDiagram';
};

export async function runNewDiagram(modeler: Editor, _command: NewDiagramCommand): Promise<any> {
  const result = await importXml(modeler, { xml: new_diagram });
  modeler.canvas.zoomToFit();
  return result;
}


type ImportXmlPayload = {
  xml: string;
};

async function importXml(modeler: Editor, command: ImportXmlPayload): Promise<any> {
  // Whatever was linked described the canvas being replaced. Carrying the link across would point
  // auto-save at that file and overwrite it with an unrelated diagram; `runOpenDiagram` links
  // again once it knows which file the new canvas actually came from.
  unlinkFile();

  const moddle = modeler.model.moddle();
  const xml = await ensureDiagramLayout(await fromWireXml(command.xml, moddle), moddle);
  const result = await modeler.importXML(xml);
  // `importXML` clears the command stack, so the trail bookkeeping has to restart with it.
  resetTrailStamping(modeler);
  // The canvas is now exactly what was imported, whichever path got here. `runOpenDiagram` marks
  // again after its rename, which is the one edit that is part of opening rather than after it.
  markOpened();
  return result;
}


export type OpenDiagramCommand = {
  type: 'OpenDiagram';
  filename: string;
  content: string | ArrayBuffer;
};

async function toXml(modeler: Editor, filename: string, content: string | ArrayBuffer): Promise<string> {
  const format = importableFormatFor(filename);

  if (format?.id === 'png') {
    if (typeof content === 'string') throw new Error('PNG diagrams must be opened as binary data.');
    return extractXmlFromPng(content);
  }

  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  if (format?.id === 'svg') return extractXmlFromSvg(text);
  if (looksLikeXml(text)) return text;
  // A foreign format a skill opens (a jsPsych timeline): converted to a studyflow on the way in, same "Open".
  const opener = openerFor(filename);
  if (opener) {
    return opener.toXml(text, {
      name: filenameStem(filename),
      packages: await loadSchemas(getSettings().enabledSchemas),
      warn: (message) => notify('warning', message),
    });
  }
  return studyflowToXml(text, modeler.model.moddle());
}

export async function runOpenDiagram(modeler: Editor, command: OpenDiagramCommand): Promise<any> {
  const xml = await toXml(modeler, command.filename, command.content);

  const result = await importXml(modeler, { xml });

  try {
    modeler.canvas.zoomToFit();
  } catch (err) {
    console.warn('Zoom to fit-viewport failed after open; leaving default zoom.', err);
  }

  const root = modeler.canvas.getRoot();
  const embedded = root?.businessObject?.name;
  if (root && (typeof embedded !== 'string' || embedded.length === 0)) {
    setAttribute(root, 'name', filenameStem(command.filename), modeler.canvas);
  }

  // Everything up to here is the file, not an edit of it, so auto-save has nothing to write yet.
  markOpened();

  return result;
}
