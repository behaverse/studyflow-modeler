/**
 * BPMN XML in and out of a study model. moddle reads and writes the XML; what it reads is put in the form the YAML
 * reader builds (an exchange, a process root) and read as a study model.
 */
import { BpmnModdle } from 'bpmn-moddle';

import { choreographyToProcessRoot, tasksToExchanges } from '@core/document/choreography';
import { inlineIoSpecification } from '@core/document/io-specification';
import { readerWarning, studyModelOf } from '@core/document/index';
import type { Moddle } from '@core/element/moddle';
import type { StudyModel } from '@core/model/index';
import type { Metamodel } from '@core/model/metamodel';
import { bpmnPackages } from '@core/model/packages';

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
  tasksToExchanges(rootElement);
  choreographyToProcessRoot(rootElement);
  if (!asWritten) inlineIoSpecification(rootElement);
  return studyModelOf(rootElement, metamodel);
}
