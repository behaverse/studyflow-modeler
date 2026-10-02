/**
 * BPMN XML in and out of a study model, the one place moddle reads and writes. What moddle reads is put in the form
 * a study holds (an exchange, compact data inputs) and read as a study model from its long form, as a file is read;
 * a study is written by building moddle's tree from its YAML.
 */
import { BpmnModdle } from 'bpmn-moddle';

import { exchangesToTasks, tasksToExchanges } from '@core/document/choreography';
import { studyflowToDefinitions } from '@core/document/deserialize';
import { dropForeignElements } from '@core/document/format';
import { expandIoSpecification, inlineIoSpecification } from '@core/document/io-specification';
import { definitionsToYamlDoc } from '@core/document/serialize';
import type { Moddle } from '@core/document/moddle';
import { liftState } from '@core/document/state';
import { StudyModel } from '@core/model/index';
import { choreographyToProcessIn, headlessPlaneToProcessIn } from '@core/model/choreography';
import type { Metamodel } from '@core/model/metamodel';
import { bpmnPackages } from '@core/model/packages';
import { readStudy, studyText } from '@core/model/yaml';

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

/** The study as BPMN XML: an exchange written as the BPMN task it is, a compact data input with the data input it
 * stands for. */
export async function studyToXml(model: StudyModel): Promise<string> {
  const moddle = moddleOf(model.metamodel);
  const definitions = studyflowToDefinitions(studyText(model.study, model.metamodel), moddle);
  exchangesToTasks(definitions);
  expandIoSpecification(definitions);
  const { xml } = await moddle.toXML(definitions, { format: true });
  return xml;
}
