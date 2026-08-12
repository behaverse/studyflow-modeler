import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { BpmnModdle } from 'bpmn-moddle';

import { looksLikeXml, extractXmlFromPng, xmlToStudyflow, studyflowToXml, studyflowToDefinitions } from '@core/document';
import { loadAllSchemas } from '@core/notation/loader';
import type { Moddle } from '@core/element/moddle';

export type SourceKind = 'yaml' | 'xml';

export type StudyflowSource = {
  /** The studyflow as text: YAML, or BPMN XML (what a `.studyflow.png` embeds). */
  text: string;
  kind: SourceKind;
  /** Where the text came from; `png` means it was extracted from an image. */
  container: 'text' | 'png';
};

let moddlePromise: Promise<Moddle> | undefined;

/** One schema-aware moddle per process; building it parses every shipped schema. */
export function schemaModdle(): Promise<Moddle> {
  moddlePromise ??= loadAllSchemas().then((schemas) => new BpmnModdle(schemas) as unknown as Moddle);
  return moddlePromise;
}

export async function readSource(path: string): Promise<StudyflowSource> {
  if (extname(path).toLowerCase() === '.png') {
    const xml = extractXmlFromPng(new Uint8Array(await readFile(path)));
    return { text: xml, kind: 'xml', container: 'png' };
  }
  const text = await readFile(path, 'utf8');
  return { text, kind: looksLikeXml(text) ? 'xml' : 'yaml', container: 'text' };
}

/** The source as BPMN XML, whatever it arrived as. */
export async function asXml(source: StudyflowSource): Promise<string> {
  if (source.kind === 'xml') return source.text;
  return studyflowToXml(source.text, await schemaModdle());
}

/** The source as `.studyflow` YAML, whatever it arrived as. */
export async function asYaml(source: StudyflowSource): Promise<string> {
  const xml = await asXml(source);
  return xmlToStudyflow(xml, await schemaModdle());
}

export type ParseResult = {
  definitions: any;
  warnings: string[];
};

/** Parse to a moddle `bpmn:Definitions`, collecting non-fatal reader warnings. */
export async function parseSource(source: StudyflowSource): Promise<ParseResult> {
  const moddle = await schemaModdle();
  const warnings: string[] = [];
  if (source.kind === 'yaml') {
    const definitions = studyflowToDefinitions(source.text, moddle, (message) => warnings.push(message));
    return { definitions, warnings };
  }
  const { rootElement, warnings: xmlWarnings } = await (moddle as any).fromXML(source.text);
  warnings.push(...(xmlWarnings ?? []).map((w: any) => w?.message ?? String(w)));
  return { definitions: rootElement, warnings };
}
