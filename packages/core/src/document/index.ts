import * as yaml from 'js-yaml';

import type { Moddle } from '@core/element/moddle';

import { YAML_DUMP_OPTIONS, applyXmlPasses } from '@core/document/format';
import { definitionsToYamlDoc } from '@core/document/serialize';
import { inlineIoSpecification, expandIoSpecification } from '@core/document/io-specification';
import { choreographyToProcessRoot, headlessPlaneToProcessRoot } from '@core/document/choreography';
import { studyflowToDefinitions } from '@core/document/deserialize';

/* The package's surface: outside `core/document`, only this barrel and `png.ts` are imported. */
export { studyflowToDefinitions } from '@core/document/deserialize';
export {
  STUDY_EXTENSION_TYPE,
  YAML_DUMP_OPTIONS,
  applyXmlPasses,
  declaredRuntime,
  primaryRoot,
  studyExtensionOf,
} from '@core/document/format';
export { isChecklistEntry } from '@core/document/shorthand';
export {
  META_KEY,
  PLACEHOLDER,
  ensureStudyExtension,
  isReservedStateKey,
  readState,
  renameStateEntry,
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
  choreographyToProcessRoot,
  isTypedChoreography,
  readChoreographyBands,
  toWireXml,
} from '@core/document/choreography';
export {
  inlineIoSpecification,
  toStandardBpmnXml,
} from '@core/document/io-specification';

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
  inlineIoSpecification(definitions);
  return yaml.dump(definitionsToYamlDoc(definitions), YAML_DUMP_OPTIONS);
}

/** What turns a file's definitions into the form the canvas edits: a process root, planes on the process, compact data associations. */
const INBOUND_PASSES = [choreographyToProcessRoot, headlessPlaneToProcessRoot, inlineIoSpecification];

/**
 * Any BPMN the app reads (a file, an autosave, an embedded PNG) into the form the canvas edits. The
 * inverse of what saving applies (`toWireXml`, `toStandardBpmnXml`); every inbound path goes through
 * here, in one parse.
 */
export async function fromWireXml(xml: string, moddle: Moddle): Promise<string> {
  return applyXmlPasses(xml, moddle, INBOUND_PASSES);
}

/** {@link fromWireXml} on definitions already built, in place: a YAML example drawn for its gallery card. */
export function fromWireDefinitions(definitions: any): void {
  for (const pass of INBOUND_PASSES) pass(definitions);
}

/** `onWarning` as {@link studyflowToDefinitions} takes it: the console when not given. */
export async function studyflowToXml(yamlText: string, moddle: Moddle, onWarning?: (message: string) => void): Promise<string> {
  const definitions = studyflowToDefinitions(yamlText, moddle, onWarning);
  expandIoSpecification(definitions);
  const { xml } = await moddle.toXML(definitions, { format: true });
  return xml;
}

export {
  dataUrlToBytes,
  embedStudyflowIntoPng,
  extractXmlFromPng,
} from '@core/document/png';
