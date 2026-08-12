import * as yaml from 'js-yaml';

import type { Moddle } from '@behaverse/studyflow-core/element/moddle';

import { YAML_DUMP_OPTIONS } from '@behaverse/studyflow-core/document/format';
import { definitionsToYamlDoc } from '@behaverse/studyflow-core/document/serialize';
import { inlineIoSpecification, expandIoSpecification } from '@behaverse/studyflow-core/document/io-specification';
import { studyflowToDefinitions } from '@behaverse/studyflow-core/document/deserialize';

/* The package's whole surface: `@behaverse/studyflow-core/document` is the only path anything outside `core/document` imports. */
export { studyflowToDefinitions } from '@behaverse/studyflow-core/document/deserialize';
export { YAML_DUMP_OPTIONS, applyXmlPasses, inferPlaneRoot, primaryRoots, type XmlPass, type YamlDoc } from '@behaverse/studyflow-core/document/format';
export { CHECKLIST_MARKER, isChecklistMarkerValue } from '@behaverse/studyflow-core/document/shorthand';
export {
  checklistItems,
  parseChecklistLines,
  serializeChecklistLines,
  type ChecklistItem,
  type ChecklistLine,
} from '@behaverse/studyflow-core/document/checklist';
export {
  DEFAULT_BOTTOM,
  DEFAULT_TOP,
  choreographyToProcessRoot,
  fromWireXml,
  readChoreographyBands,
  toWireXml,
} from '@behaverse/studyflow-core/document/choreography';
export {
  fromStandardBpmnXml,
  inlineIoSpecification,
  toStandardBpmnXml,
} from '@behaverse/studyflow-core/document/io-specification';

/**
 * The `.studyflow` YAML file format — a lossless, semantic mapping between the
 * BPMN object tree and a YAML document.
 *
 * The mapping is *generic over the metamodel* (it walks moddle element
 * descriptors), so everything the XML can express survives the round trip:
 *
 *   - containment becomes YAML nesting,
 *   - references become id strings,
 *   - raw/unknown XML attributes (`$attrs`) are kept verbatim,
 *   - values equal to the schema default are omitted (re-applied on load),
 *   - `type` is omitted where it equals the property's declared type.
 *
 * On top sit six cosmetic *shorthands*, specified in `shorthand.ts`: `inline*`
 * writes one, `expand*` reads it back, and the pre-shorthand spellings are
 * still accepted on load:
 *
 *   1. `yaml-body`        YAML-bodied config wrappers and value-typed YAML properties
 *   2. `element-list`     list wrappers collapse to a plain list
 *   3. `inline-di`        diagram geometry attaches to the element it describes
 *   4. `id-keyed`         containment maps keyed by element id
 *   5. `expression-body`  expression elements collapse to their body string
 *   6. `documentation`    inline documentation, and the checklist entry inside it
 *
 * Top-level shape — the definitions id at the root, every non-reserved root
 * key a bpmn root element keyed by its id:
 *
 * ```yaml
 * id: my_study                                # bpmn:Definitions id
 * definitions: { targetNamespace: ..., ... }  # remaining definitions attributes
 * My_Process:                                 # one entry per bpmn rootElement
 *   type: bpmn:Process
 *   flowElements: { Start: { type: bpmn:StartEvent, ... }, ... }
 * diagram: [ ... ]                            # only DI that cannot be collapsed inline
 * ```
 *
 * The format version is identified by the core namespace URI. Loading derives
 * missing `incoming`/`outgoing` from each flow's `sourceRef`/`targetRef`, so
 * hand-written files may omit them. This is the one part of the app that may
 * use moddle's object model directly (`$descriptor`, `$attrs`); everywhere
 * else, schema semantics come from the catalog.
 */

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
