import * as yaml from 'js-yaml';

import type { Moddle } from '@core/element/moddle';

import { YAML_DUMP_OPTIONS } from '@core/document/format';
import { definitionsToYamlDoc } from '@core/document/serialize';
import { inlineIoSpecification, expandIoSpecification } from '@core/document/io-specification';
import { studyflowToDefinitions } from '@core/document/deserialize';

/* The package's whole surface: `@core/document` is the only path anything outside `core/document` imports. */
export { studyflowToDefinitions } from '@core/document/deserialize';
export { YAML_DUMP_OPTIONS, applyXmlPasses, inferPlaneRoot, primaryRoots, type XmlPass, type YamlDoc } from '@core/document/format';
export { CHECKLIST_MARKER, isChecklistMarkerValue } from '@core/document/shorthand';
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
  choreographyToProcessRoot,
  fromWireXml,
  readChoreographyBands,
  toWireXml,
} from '@core/document/choreography';
export {
  fromStandardBpmnXml,
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

export async function studyflowToXml(yamlText: string, moddle: Moddle): Promise<string> {
  const definitions = studyflowToDefinitions(yamlText, moddle);
  expandIoSpecification(definitions);
  const { xml } = await moddle.toXML(definitions, { format: true });
  return xml;
}

export {
  dataUrlToBytes,
  embedDrawioIntoPng,
  embedStudyflowIntoPng,
  extractXmlFromPng,
} from '@core/document/png';
