/**
 * BPMN XML in and out of a study model. moddle reads and writes the XML; what it reads is put in the form the YAML
 * reader builds (an exchange, a process root) and read as a study model.
 */
import { BpmnModdle } from 'bpmn-moddle';

import { choreographyToProcessRoot, headlessPlaneToProcessRoot, tasksToExchanges } from '@core/document/choreography';
import { dropForeignElements } from '@core/document/format';
import { inlineIoSpecification } from '@core/document/io-specification';
import { looksLikeXml, readerWarning, studyModelOf, studyflowToXml } from '@core/document/index';
import type { Moddle } from '@core/element/moddle';
import { StudyModel } from '@core/model/index';
import { choreographyToProcessIn } from '@core/model/choreography';
import type { Metamodel } from '@core/model/metamodel';
import { bpmnPackages } from '@core/model/packages';
import { readStudy, studyText } from '@core/model/yaml';

const BPMN_PREFIXES = new Set(bpmnPackages().map((pkg) => pkg.prefix));

const moddles = new WeakMap<Metamodel, Moddle>();

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

/**
 * The study model of BPMN XML. Its data inputs are read into the compact form the YAML writes, so a study checks and
 * digests alike in either spelling; `asWritten` keeps the ones the XML declares, as a run hands them on. `onWarning`
 * hears what the reader could not place.
 */
export async function xmlToStudy(xml: string, metamodel: Metamodel, { asWritten = false, onWarning }: { asWritten?: boolean; onWarning?: (message: string) => void } = {}): Promise<StudyModel> {
  const { rootElement, warnings } = await moddleOf(metamodel).fromXML(xml);
  for (const warning of warnings) onWarning?.(readerWarning(warning));
  dropForeignElements(rootElement, onWarning);
  tasksToExchanges(rootElement);
  choreographyToProcessRoot(rootElement);
  headlessPlaneToProcessRoot(rootElement);
  if (!asWritten) inlineIoSpecification(rootElement);
  return studyModelOf(rootElement, metamodel);
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
export function studyToXml(model: StudyModel): Promise<string> {
  return studyflowToXml(studyText(model.study, model.metamodel), moddleOf(model.metamodel));
}
