import * as yaml from 'js-yaml';

import { Metamodel, type PackageDef } from '@core/model/metamodel';
import { StudyModel } from '@core/model/index';
import { readStudy } from '@core/model/yaml';
import type { Moddle } from '@core/element/moddle';

import { applyXmlPasses, dropForeignElements } from '@core/document/format';
import { YAML_DUMP_OPTIONS } from '@core/model/spelling';
import { definitionsToYamlDoc } from '@core/document/serialize';
import { inlineIoSpecification, expandIoSpecification } from '@core/document/io-specification';
import { choreographyToProcessRoot, exchangesToTasks, headlessPlaneToProcessRoot, tasksToExchanges } from '@core/document/choreography';
import { studyflowToDefinitions } from '@core/document/deserialize';

/* The package's surface: outside `core/document`, only this barrel, `png.ts`, `svg.ts` and `outline.ts` are imported. */
export { studyflowToDefinitions } from '@core/document/deserialize';
export { YAML_DUMP_OPTIONS } from '@core/model/spelling';
export {
  STUDY_EXTENSION_TYPE,
  applyXmlPasses,
  declaredRuntime,
  primaryRoot,
  studyExtensionOf,
} from '@core/document/format';
export {
  PARAMETERS_TYPE,
  attributeOverrides,
  effectiveAttribute,
  hasPath,
  mergeParameters,
  overridableAttributes,
  parametersOf,
  splitAttributes,
  wiredParameters,
  wiredProperties,
  type AttributeOverride,
} from '@core/document/parameters';
export {
  META_KEY,
  PLACEHOLDER,
  ensureStudyExtension,
  handOverStudy,
  isReservedStateKey,
  readState,
  resolvePlaceholders,
  resolveState,
  writeState,
  type StateTree,
} from '@core/document/state';
export {
  checklistItems,
  parseChecklistLines,
  serializeChecklistLines,
  type ChecklistItem,
  type ChecklistLine,
} from '@core/document/checklist';
export {
  DEFAULT_BOTTOM,
  DEFAULT_TOP,
  actorOf,
  ensureChoreographyParticipants,
  mintParticipant,
  choreographyToProcessRoot,
  exchangesToTasks,
  tasksToExchanges,
  isTypedChoreography,
  readChoreographyBands,
  toWireXml,
  type ParticipantIds,
} from '@core/document/choreography';
export {
  inlineIoSpecification,
  toStandardBpmnXml,
} from '@core/document/io-specification';
export { protocolDigest } from '@core/document/digest';
export { patchDoc } from '@core/document/patch';
export { ensureItemDefinition, setItemSubject, setMessageItem, type DocumentWriter } from '@core/document/items';
export {
  parseSchemaBody,
  type ParsedSchemaBody,
  type SchemaColumn,
  type SchemaFormat,
} from '@core/document/schema-body';

/* The `.studyflow` format is specified in docs. */

export function looksLikeXml(text: string): boolean {
  return /^\uFEFF?\s*</.test(text);
}

/** A moddle reader warning as text, led by the id of the element it is about: "unknown attribute <name>" alone points nowhere. */
export function readerWarning(warning: any): string {
  const message = warning?.message ?? String(warning);
  return warning?.element?.id ? `${warning.element.id}: ${message}` : message;
}

/** `onWarning` hears what the reader could not place, content it drops included; without it, nothing is said. */
export async function xmlToStudyflow(xml: string, moddle: Moddle, onWarning?: (message: string) => void): Promise<string> {
  const { rootElement: definitions, warnings } = await moddle.fromXML(xml);
  if (onWarning) for (const warning of warnings) onWarning(readerWarning(warning));
  dropForeignElements(definitions, onWarning);
  tasksToExchanges(definitions);
  choreographyToProcessRoot(definitions);
  inlineIoSpecification(definitions);
  return definitionsToStudyflow(definitions, onWarning);
}

/**
 * Definitions already in the form the canvas edits, as `.studyflow.yaml` text, synchronously. `onWarning` hears each
 * reference left out because it names an element the document does not hold; without it, nothing is said.
 */
export function definitionsToStudyflow(definitions: any, onWarning?: (message: string) => void): string {
  return yaml.dump(definitionsToYamlDoc(definitions, onWarning), YAML_DUMP_OPTIONS);
}

/**
 * What turns a file's definitions into the form the canvas edits: no element YAML cannot spell, a process root,
 * planes on the process, compact data associations.
 */
const INBOUND_PASSES = [dropForeignElements, tasksToExchanges, choreographyToProcessRoot, headlessPlaneToProcessRoot, inlineIoSpecification];

/**
 * Any BPMN the app reads (a file, an autosave, an embedded PNG) into the form the canvas edits. The
 * inverse of what saving applies (`toWireXml`, `toStandardBpmnXml`); every inbound path goes through
 * here, in one parse, whose warnings `onWarning` hears as {@link xmlToStudyflow}'s does.
 */
export async function fromWireXml(xml: string, moddle: Moddle, onWarning?: (message: string) => void): Promise<string> {
  return applyXmlPasses(xml, moddle, INBOUND_PASSES, (warning) => onWarning?.(readerWarning(warning)));
}

/** {@link fromWireXml} on definitions already built, in place: what a Study opens. `onWarning` hears what is dropped. */
export function fromWireDefinitions(definitions: any, onWarning?: (message: string) => void): void {
  for (const pass of INBOUND_PASSES) pass(definitions, onWarning);
}

/** `onWarning` as {@link studyflowToDefinitions} takes it: the console when not given. */
export async function studyflowToXml(yamlText: string, moddle: Moddle, onWarning?: (message: string) => void): Promise<string> {
  const definitions = studyflowToDefinitions(yamlText, moddle, onWarning);
  exchangesToTasks(definitions);
  expandIoSpecification(definitions);
  const { xml } = await moddle.toXML(definitions, { format: true });
  return xml;
}

export {
  dataUrlToBytes,
  embedStudyflowIntoPng,
  extractStudyflowFromPng,
} from '@core/document/png';
export { extractStudyflowFromSvg, replaceStudyflowInSvg } from '@core/document/svg';

const metamodels = new WeakMap<object, Metamodel>();

/** The study model of definitions moddle holds: what reads a study as data, for the paths that still hold moddle. */
export function studyModelOf(definitions: any): StudyModel {
  const moddle = definitions.$model;
  let metamodel = metamodels.get(moddle);
  if (!metamodel) {
    metamodel = new Metamodel(structuredClone(moddle.getPackages()) as PackageDef[]);
    metamodels.set(moddle, metamodel);
  }
  return new StudyModel(readStudy(definitionsToYamlDoc(definitions), metamodel, () => {}), metamodel);
}
