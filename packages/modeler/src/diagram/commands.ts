import new_diagram from '#assets/examples/new_diagram.bpmn?raw';
import { applyXmlPasses, choreographyToProcessRoot, inlineIoSpecification, looksLikeXml, studyflowToXml } from '@core/document';
import { loadSchemas } from '@core/notation/loader';
import { setAttribute } from '@core/element';
import { ensureDiagramLayout } from '@modeler/diagram/autoLayout';
import { extractXmlFromSvg, filenameStem } from '@modeler/diagram/file';
import { importableFormatFor } from '@modeler/export/formats';
import { extractXmlFromPng } from '@core/document/png';
import { buildStudyflowXml, importJsPsychTimeline } from '@modeler/import';
import { modelingUpdater } from '@modeler/bpmn/modeling';
import { notify } from '@modeler/app/noticeStore';
import { resetTrailStamping } from '@modeler/provenance/trail';
import { getSettings } from '@modeler/settings/store';
import type { Modeler } from '@modeler/bpmn/types';

export type ResetZoomCommand = {
  type: 'ResetZoom';
};

export function runResetZoom(modeler: Modeler, _command: ResetZoomCommand): void {
  modeler.get('canvas').zoom('fit-viewport');
}


export type NewDiagramCommand = {
  type: 'NewDiagram';
};

export async function runNewDiagram(modeler: Modeler, _command: NewDiagramCommand): Promise<any> {
  const result = await importXml(modeler, { xml: new_diagram });
  modeler.get('canvas').zoom('fit-viewport');
  return result;
}


export type ImportJsPsychCommand = {
  type: 'ImportJsPsych';
  filename: string;
  content: string;
};

export async function runImportJsPsych(modeler: Modeler, command: ImportJsPsychCommand): Promise<any> {
  const name = filenameStem(command.filename);
  const study = importJsPsychTimeline(command.content, { name });
  for (const warning of study.warnings) console.warn(`jsPsych import: ${warning}`);
  if (study.warnings.length > 0) {
    notify('warning',
      `The jsPsych import made ${study.warnings.length} adjustment${study.warnings.length === 1 ? '' : 's'}. `
      + `Check in the inspector:\n• ${study.warnings.join('\n• ')}`);
  }

  const packages = await loadSchemas(getSettings().enabledSchemas);
  const xml = await buildStudyflowXml(study, packages);
  return runOpenDiagram(modeler, { type: 'OpenDiagram', filename: command.filename, content: xml });
}


type ImportXmlPayload = {
  xml: string;
};

async function importXml(modeler: Modeler, command: ImportXmlPayload): Promise<any> {
  const wireXml = await applyXmlPasses(command.xml, modeler.get('moddle'), [
    choreographyToProcessRoot,
    inlineIoSpecification,
  ]);
  const xml = await ensureDiagramLayout(wireXml, modeler.get('moddle'));
  const result = await modeler.importXML(xml);
  // `importXML` clears the command stack, so the trail bookkeeping has to restart with it.
  resetTrailStamping(modeler);
  return result;
}


export type OpenDiagramCommand = {
  type: 'OpenDiagram';
  filename: string;
  content: string | ArrayBuffer;
};

async function toXml(modeler: Modeler, filename: string, content: string | ArrayBuffer): Promise<string> {
  const format = importableFormatFor(filename);

  if (format?.id === 'png') {
    if (typeof content === 'string') throw new Error('PNG diagrams must be opened as binary data.');
    return extractXmlFromPng(content);
  }

  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  if (format?.id === 'svg') return extractXmlFromSvg(text);
  if (looksLikeXml(text)) return text;
  return studyflowToXml(text, modeler.get('moddle'));
}

export async function runOpenDiagram(modeler: Modeler, command: OpenDiagramCommand): Promise<any> {
  const xml = await toXml(modeler, command.filename, command.content);

  const result = await importXml(modeler, { xml });

  try {
    modeler.get('canvas').zoom('fit-viewport');
  } catch (err) {
    console.warn('Zoom to fit-viewport failed after open; leaving default zoom.', err);
  }

  const root = modeler.get('canvas').getRootElement();
  const embedded = root?.businessObject?.name;
  if (root && (typeof embedded !== 'string' || embedded.length === 0)) {
    setAttribute(root, 'name', filenameStem(command.filename), modelingUpdater(modeler.get('modeling')));
  }

  return result;
}
