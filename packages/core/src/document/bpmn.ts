/**
 * BPMN XML in and out of a study model, the one place moddle reads and writes. What moddle reads is put in the form
 * a study holds (an exchange, compact data inputs) and read as a study model from its long form, as a file is read;
 * a study is written by building moddle's tree from the study as its file holds it.
 */
import { BpmnModdle } from 'bpmn-moddle';

import { exchangesToTasks, tasksToExchanges } from '@core/document/choreography';
import { studyToDefinitions } from '@core/document/deserialize';
import { dropForeignElements } from '@core/document/format';
import { expandIoSpecification, inlineIoSpecification } from '@core/document/io-specification';
import { definitionsToYamlDoc } from '@core/document/serialize';
import type { Moddle } from '@core/document/moddle';
import { liftState, lowerState } from '@core/document/state';
import { StudyModel } from '@core/model/index';
import { choreographyToProcessIn, headlessPlaneToProcessIn } from '@core/model/choreography';
import type { Metamodel } from '@core/model/metamodel';
import { bpmnPackages } from '@core/model/packages';
import { readStudy, writtenStudy } from '@core/model/yaml';

const BPMN_PREFIXES = new Set(bpmnPackages().map((pkg) => pkg.prefix));

const moddles = new WeakMap<Metamodel, Moddle>();

/** Whether file text is XML rather than YAML. */
export function looksLikeXml(text: string): boolean {
  return /^﻿?\s*</.test(text);
}

/** The moddle over the schemas `metamodel` reads: one per metamodel, given its own copy of their packages. */
export function moddleOf(metamodel: Metamodel): Moddle {
  let moddle = moddles.get(metamodel);
  if (!moddle) {
    const schemas = metamodel.packages.filter((pkg) => !BPMN_PREFIXES.has(pkg.prefix));
    moddle = new BpmnModdle(structuredClone(Object.fromEntries(schemas.map((pkg) => [pkg.prefix, pkg])))) as Moddle;
    moddles.set(metamodel, moddle);
  }
  return moddle;
}

/** A moddle reader warning as text, led by the id of the element it is about: "unknown attribute <name>" alone points nowhere. */
function readerWarning(warning: any): string {
  const message = warning?.message ?? String(warning);
  return warning?.element?.id ? `${warning.element.id}: ${message}` : message;
}

/**
 * The study model of BPMN XML. Its data inputs are read into the compact form the YAML writes, so a study checks and
 * digests alike in either spelling; `asWritten` keeps the ones the XML declares, as a run hands them on. `onWarning`
 * hears what the reader could not place, content it drops included.
 */
export async function xmlToStudy(xml: string, metamodel: Metamodel, { asWritten = false, onWarning }: { asWritten?: boolean; onWarning?: (message: string) => void } = {}): Promise<StudyModel> {
  const { rootElement: definitions, warnings } = await moddleOf(metamodel).fromXML(xml);
  for (const warning of warnings) onWarning?.(readerWarning(warning));
  dropForeignElements(definitions, onWarning);
  tasksToExchanges(definitions);
  if (!asWritten) inlineIoSpecification(definitions);
  // moddle's reader has said what it could not place, which the study's reader would only say again.
  const model = new StudyModel(readStudy(definitionsToYamlDoc(definitions), metamodel, () => {}), metamodel);
  choreographyToProcessIn(model);
  headlessPlaneToProcessIn(model);
  liftState(model);
  return model;
}

/** The study model of file text, a `.studyflow.yaml` or BPMN XML (read as {@link xmlToStudy} reads it). */
export async function parseStudy(text: string, metamodel: Metamodel, options: { asWritten?: boolean; onWarning?: (message: string) => void } = {}): Promise<StudyModel> {
  if (looksLikeXml(text)) return xmlToStudy(text, metamodel, options);
  const model = new StudyModel(readStudy(text, metamodel, options.onWarning), metamodel);
  choreographyToProcessIn(model);
  return model;
}

/** The study as BPMN XML, written from the study its file holds: the run state on its Study, an exchange written as
 * the BPMN task it is, a compact data input with the data input it stands for. */
export async function studyToXml(model: StudyModel): Promise<string> {
  const moddle = moddleOf(model.metamodel);
  const written = new StudyModel(writtenStudy(model.study, model.metamodel), model.metamodel);
  lowerState(written);
  const definitions = studyToDefinitions(written.study, written.metamodel, moddle);
  exchangesToTasks(definitions);
  expandIoSpecification(definitions);
  const { xml } = await moddle.toXML(definitions, { format: true });
  return declareStructurePrefixes(xml, written);
}

/** The XML with the namespace declared of each skill an item definition's `structureRef` names by its prefix
 * (`cognitive:Trial`), when nothing else the study writes uses that skill. moddle declares only the packages whose
 * elements or attributes it writes, and a QName in an attribute's value is neither, so without this a study that names
 * a skill's message, and no element of that skill, would not be BPMN 2.0 (`structureRef` is an `xs:QName`). */
function declareStructurePrefixes(xml: string, model: StudyModel): string {
  const root = /<([\w.-]+:)?definitions\b[^>]*>/.exec(xml);
  if (!root) return xml;
  const declarations = new Set<string>();
  for (const element of model.study.roots) {
    if (model.host(element) !== 'bpmn:ItemDefinition' || typeof element.structureRef !== 'string') continue;
    const prefix = /^([A-Za-z_][\w.-]*):/.exec(element.structureRef)?.[1];
    const pkg = prefix ? model.metamodel.package(prefix) : undefined;
    if (prefix && pkg?.uri && !root[0].includes(`xmlns:${prefix}=`)) declarations.add(` xmlns:${prefix}="${pkg.uri}"`);
  }
  const end = root.index + root[0].length - 1; // the root tag's closing `>`
  return declarations.size ? xml.slice(0, end) + [...declarations].join('') + xml.slice(end) : xml;
}
