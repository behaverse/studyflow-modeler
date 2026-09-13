import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { BpmnModdle } from 'bpmn-moddle';

import { looksLikeXml, extractStudyflowFromPng, extractStudyflowFromSvg, readerWarning, xmlToStudyflow, studyflowToXml, studyflowToDefinitions } from '@core/document';
import { loadAllSchemas } from '@core/notation/loader';
import type { Moddle } from '@core/element/moddle';

export type SourceKind = 'yaml' | 'xml';

export type StudyflowSource = {
  /** The studyflow as text: YAML (what a `.studyflow.png` or `.studyflow.svg` embeds), or BPMN XML. */
  text: string;
  kind: SourceKind;
  /** Where the text came from; `png` and `svg` mean it was extracted from an image. */
  container: 'text' | 'png' | 'svg';
};

let moddlePromise: Promise<Moddle> | undefined;

/** One schema-aware moddle per process; building it parses every shipped schema. */
export function schemaModdle(): Promise<Moddle> {
  moddlePromise ??= loadAllSchemas().then((schemas) => new BpmnModdle(schemas) as unknown as Moddle);
  return moddlePromise;
}

export async function readSource(path: string): Promise<StudyflowSource> {
  const extension = extname(path).toLowerCase();
  const container = extension === '.png' ? 'png' : extension === '.svg' ? 'svg' : 'text';
  const text = container === 'png'
    ? extractStudyflowFromPng(new Uint8Array(await readFile(path)))
    : container === 'svg'
      ? extractStudyflowFromSvg(await readFile(path, 'utf8'))
      : await readFile(path, 'utf8');
  return { text, kind: looksLikeXml(text) ? 'xml' : 'yaml', container };
}

/** The source as BPMN XML, whatever it arrived as. XML is passed through unread, so only YAML can warn. */
export async function asXml(source: StudyflowSource, onWarning?: (message: string) => void): Promise<string> {
  if (source.kind === 'xml') return source.text;
  return studyflowToXml(source.text, await schemaModdle(), onWarning);
}

/** The source as `.studyflow` YAML, whatever it arrived as. */
export async function asYaml(source: StudyflowSource, onWarning?: (message: string) => void): Promise<string> {
  const xml = await asXml(source, onWarning);
  // YAML was read on its way to XML; the XML written from it is not the input, so its reading is not reported.
  return xmlToStudyflow(xml, await schemaModdle(), source.kind === 'xml' ? onWarning : undefined);
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
  const { rootElement, warnings: xmlWarnings } = await moddle.fromXML(source.text);
  warnings.push(...xmlWarnings.map(readerWarning));
  return { definitions: rootElement, warnings };
}
