import * as yaml from 'js-yaml';

import type { Moddle } from '@core/element/moddle';

import { YAML_DUMP_OPTIONS, applyXmlPasses } from '@core/document/format';
import { definitionsToYamlDoc } from '@core/document/serialize';
import { inlineIoSpecification, expandIoSpecification } from '@core/document/io-specification';
import { choreographyToProcessRoot, headlessPlaneToProcessRoot } from '@core/document/choreography';
import { studyflowToDefinitions } from '@core/document/deserialize';

/* The package's surface: outside `core/document`, only this barrel and `png.ts` are imported. */
export { studyflowToDefinitions } from '@core/document/deserialize';
export { YAML_DUMP_OPTIONS, applyXmlPasses, declaredRuntime, primaryRoot, studyExtensionOf } from '@core/document/format';
export { CHECKLIST_MARKER, isChecklistMarkerValue } from '@core/document/shorthand';
export {
  META_KEY,
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

export async function xmlToStudyflow(xml: string, moddle: Moddle): Promise<string> {
  const { rootElement: definitions } = await moddle.fromXML(xml);
  inlineIoSpecification(definitions);
  return yaml.dump(definitionsToYamlDoc(definitions), YAML_DUMP_OPTIONS);
}

/**
 * Any BPMN the app reads (a file, an autosave, an embedded PNG) into the form the canvas edits: a process
 * root, planes on the process, compact data associations. The inverse of what saving applies
 * (`toWireXml`, `toStandardBpmnXml`); every inbound path goes through here, in one parse.
 */
export async function fromWireXml(xml: string, moddle: Moddle): Promise<string> {
  return applyXmlPasses(xml, moddle, [choreographyToProcessRoot, headlessPlaneToProcessRoot, inlineIoSpecification]);
}

export async function studyflowToXml(yamlText: string, moddle: Moddle): Promise<string> {
  const definitions = studyflowToDefinitions(yamlText, moddle);
  expandIoSpecification(definitions);
  const { xml } = await moddle.toXML(definitions, { format: true });
  return xml;
}

export {
  dataUrlToBytes,
  embedStudyflowIntoPng,
  extractXmlFromPng,
} from '@core/document/png';
