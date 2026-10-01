import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { BpmnModdle } from 'bpmn-moddle';

import { installedSkills } from '@cli/skills';

import { choreographyToProcessRoot, looksLikeXml, extractStudyflowFromPng, extractStudyflowFromSvg, inlineIoSpecification, readerWarning, studyModelOf, tasksToExchanges, xmlToStudyflow, studyflowToXml } from '@core/document';
import type { Moddle } from '@core/element/moddle';
import { StudyModel } from '@core/model/index';
import type { Metamodel } from '@core/model/metamodel';
import { metamodelOf } from '@core/model/packages';
import { readStudy, studyText } from '@core/model/yaml';
import { loadAllSchemas } from '@core/notation/loader';

export type SourceKind = 'yaml' | 'xml';

export type StudyflowSource = {
  /** The studyflow as text: YAML (what a `.studyflow.png` embeds), or BPMN XML (what a `.studyflow.svg` does). */
  text: string;
  kind: SourceKind;
  /** Where the text came from; `png` and `svg` mean it was extracted from an image. */
  container: 'text' | 'png' | 'svg';
};

let schemasPromise: Promise<Record<string, any>> | undefined;
let moddlePromise: Promise<Moddle> | undefined;
let metamodelPromise: Promise<Metamodel> | undefined;

/** Every installed skill's schema, parsed once per process. */
function schemas(): Promise<Record<string, any>> {
  schemasPromise ??= loadAllSchemas(installedSkills().flatMap((skill) => (skill.schema ? [skill.schema] : [])));
  return schemasPromise;
}

/** One schema-aware moddle per process: what reads and writes BPMN XML. */
export function schemaModdle(): Promise<Moddle> {
  moddlePromise ??= schemas().then((packages) => new BpmnModdle(packages) as unknown as Moddle);
  return moddlePromise;
}

/** One metamodel per process: what a study model reads its types by. */
export function schemaMetamodel(): Promise<Metamodel> {
  metamodelPromise ??= schemas().then(metamodelOf);
  return metamodelPromise;
}

export async function readSource(path: string): Promise<StudyflowSource> {
  const extension = extname(path).toLowerCase();
  return sourceOf(await readFile(path), extension === '.png' ? 'png' : extension === '.svg' ? 'svg' : 'text');
}

/** A file's bytes as a source: the studyflow text, taken out of the image when the file is one. */
export function sourceOf(bytes: Uint8Array, container: StudyflowSource['container']): StudyflowSource {
  const text = container === 'png'
    ? extractStudyflowFromPng(bytes)
    : container === 'svg'
      ? extractStudyflowFromSvg(new TextDecoder().decode(bytes))
      : new TextDecoder().decode(bytes);
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
  model: StudyModel;
  warnings: string[];
};

/** Read a study model, collecting non-fatal reader warnings. XML is read into the form the YAML reader builds, compact
 * data associations included, so a study checks and digests alike in either spelling; `asWritten` keeps the data
 * inputs it declares, as a run hands them on. */
export async function parseSource(source: StudyflowSource, { asWritten = false } = {}): Promise<ParseResult> {
  const metamodel = await schemaMetamodel();
  const warnings: string[] = [];
  if (source.kind === 'yaml') return { model: new StudyModel(readStudy(source.text, metamodel, (message) => warnings.push(message)), metamodel), warnings };
  const { rootElement, warnings: xmlWarnings } = await (await schemaModdle()).fromXML(source.text);
  warnings.push(...xmlWarnings.map(readerWarning));
  tasksToExchanges(rootElement);
  choreographyToProcessRoot(rootElement);
  if (!asWritten) inlineIoSpecification(rootElement);
  return { model: studyModelOf(rootElement, metamodel), warnings };
}

/** The study as `.studyflow` YAML, or as the BPMN XML it spells. */
export async function studySource(model: StudyModel, kind: SourceKind): Promise<string> {
  const text = studyText(model.study, model.metamodel);
  return kind === 'yaml' ? text : studyflowToXml(text, await schemaModdle());
}
