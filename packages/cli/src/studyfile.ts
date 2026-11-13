import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { installedSkills } from '@cli/skills';

import {
  extractPastedImagesFromPng,
  extractPastedImagesFromTiff,
  extractStudyflowFromPng,
  extractStudyflowFromSvg,
  extractStudyflowFromTiff,
  looksLikeXml,
  parseStudy,
  pngResolution,
  pngSize,
  protocolDigest,
  studyToXml,
  tiffResolution,
  tiffSize,
  type StudyflowTiffAbout,
} from '@core/document';
import type { StudyModel } from '@core/model/index';
import type { Metamodel } from '@core/model/metamodel';
import { metamodelOf } from '@core/model/packages';
import { withoutPastedImages } from '@core/model/pastedImages';
import { studyText } from '@core/model/yaml';
import { loadAllSchemas } from '@core/notation/loader';

export type SourceKind = 'yaml' | 'xml';

export type StudyflowSource = {
  /** The studyflow as text: YAML (what a `.studyflow.png` or `.studyflow.tif` embeds), or BPMN XML (what a `.studyflow.svg` does). */
  text: string;
  kind: SourceKind;
  /** Where the text came from; `png`, `tif` and `svg` mean it was extracted from an image. */
  container: 'text' | 'png' | 'tif' | 'svg';
  /** The bytes of the images pasted on the study, by the id each names, which only a PNG or a TIFF holds. */
  pastedImages: ReadonlyMap<string, Uint8Array>;
  /** A raster image's size in pixels and, when it says, its print size in dots per inch. */
  image?: { width: number; height: number; resolution?: { x: number; y: number } };
};

/** This CLI's name, as a run's record gives it for what ran the run (`with`) and a TIFF for what wrote it. */
export const TOOL = `studyflow-cli/${import.meta.env?.APP_VERSION ?? 'dev'}`;

let metamodelPromise: Promise<Metamodel> | undefined;

/** One metamodel per process, over every installed skill's schema; a study model reads its types from it. */
export function schemaMetamodel(): Promise<Metamodel> {
  metamodelPromise ??= loadAllSchemas(installedSkills().flatMap((skill) => skill.schemas)).then(metamodelOf);
  return metamodelPromise;
}

/** The container a file's extension says it is: an image carrying the study, or the study's own text. */
export function containerOf(path: string): StudyflowSource['container'] {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'png';
  if (extension === '.tif' || extension === '.tiff') return 'tif';
  if (extension === '.svg') return 'svg';
  return 'text';
}

export async function readSource(path: string): Promise<StudyflowSource> {
  return sourceOf(await readFile(path), containerOf(path));
}

/** A file's bytes as a source: the studyflow text, taken out of the image when the file is one. */
export function sourceOf(bytes: Uint8Array, container: StudyflowSource['container']): StudyflowSource {
  const text = container === 'png'
    ? extractStudyflowFromPng(bytes)
    : container === 'tif'
      ? extractStudyflowFromTiff(bytes)
      : container === 'svg'
        ? extractStudyflowFromSvg(new TextDecoder().decode(bytes))
        : new TextDecoder().decode(bytes);
  const pastedImages = container === 'png' ? extractPastedImagesFromPng(bytes) : container === 'tif' ? extractPastedImagesFromTiff(bytes) : new Map<string, Uint8Array>();
  const image = container === 'png'
    ? { ...pngSize(bytes), resolution: pngResolution(bytes) }
    : container === 'tif' ? { ...tiffSize(bytes), resolution: tiffResolution(bytes) } : undefined;
  return { text, kind: looksLikeXml(text) ? 'xml' : 'yaml', container, pastedImages, image };
}

/** The facts a `.studyflow.tif` states about the study it carries, beside the text: its id and name, its protocol digest, and this CLI. */
export async function tiffAbout(model: StudyModel): Promise<StudyflowTiffAbout> {
  const root = model.primaryRoot();
  return { id: root?.id, name: typeof root?.name === 'string' && root.name.trim() ? root.name : undefined, digest: await protocolDigest(model), creatorTool: TOOL };
}

/** The source as BPMN XML, whatever it arrived as. XML is passed through unread, so only YAML can warn. */
export async function asXml(source: StudyflowSource, onWarning?: (message: string) => void): Promise<string> {
  if (source.kind === 'xml') return source.text;
  return studyToXml(withoutPastedImages(await parseStudy(source.text, await schemaMetamodel(), { onWarning })));
}

/** The source as `.studyflow` YAML, whatever it arrived as, and without its pasted images unless they are kept beside it. */
export async function asYaml(source: StudyflowSource, onWarning?: (message: string) => void, { pastedImages = false } = {}): Promise<string> {
  const model = await parseStudy(source.text, await schemaMetamodel(), { onWarning });
  const { study, metamodel } = pastedImages ? model : withoutPastedImages(model);
  return studyText(study, metamodel);
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
  const onWarning = (message: string): void => { warnings.push(message); };
  return { model: await parseStudy(source.text, metamodel, { asWritten, onWarning }), warnings };
}

/** The study as `.studyflow` YAML, or as the BPMN XML it spells. */
export async function studySource(model: StudyModel, kind: SourceKind): Promise<string> {
  return kind === 'yaml' ? studyText(model.study, model.metamodel) : studyToXml(model);
}
