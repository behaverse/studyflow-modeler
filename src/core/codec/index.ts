import * as yaml from 'js-yaml';

import { STUDYFLOW_NS } from '@/core/constants';
import { toLocalName } from '@/core/naming';
import { RESERVED_DOC_KEYS, YAML_DUMP_OPTIONS, type YamlDoc } from '@/core/codec/common';
import { definitionsToYamlDoc } from '@/core/codec/serialize';
import { foldIoSpecification } from '@/core/codec/io-specification';
import { studyflowToDefinitions } from '@/core/codec/deserialize';

export { studyflowToDefinitions } from '@/core/codec/deserialize';

/**
 * The `.studyflow` YAML file format — a lossless, semantic mapping between
 * the BPMN object tree and a YAML document.
 *
 * The mapping is *generic over the metamodel* (it walks moddle element
 * descriptors), so every construct the XML serialization can express —
 * extension wrappers, traits, nested sub-processes, pools, colors, diagram
 * geometry — survives the round trip by construction:
 *
 *   - containment becomes YAML nesting,
 *   - references become id strings,
 *   - raw/unknown XML attributes (`$attrs`) are kept verbatim,
 *   - values equal to the schema default are omitted (re-applied on load),
 *   - `type` is omitted where it equals the property's declared type.
 *
 * Four readability foldings sit on top of the generic walk. Each is reversed
 * on load, and the pre-folding (legacy) spellings are still accepted:
 *
 *   - containment lists whose items all carry ids serialize as `id -> body`
 *     mappings (`flowElements`, `participants`, `lanes`, ...); the `id` field
 *     becomes the key. Lists of id-less items (extension wrappers, waypoints)
 *     stay lists,
 *   - `bpmn:ExtensionElements` collapses to the plain list of its `values`
 *     (no `values:` wrapper),
 *   - YAML-bodied config wrappers (`cognitive:Configurations`,
 *     `cognitive:BotConfigurations`, ...) inline their parsed body as nested
 *     YAML instead of a `value: |` string block, and value-typed YAML
 *     properties (`studyflow:arguments`) inline their parsed mapping the same way,
 *   - diagram geometry attaches to the element it describes — `bounds` and
 *     `label` on shapes, `waypoint` on edges, plus DI-only flags and colors
 *     (`isMarkerVisible`, `bioc:stroke`, ...). DI ids are regenerated as
 *     `<elementId>_di` on load; `bounds`/`waypoint` are reserved keys.
 *
 * Top-level document shape — the definitions id sits at the root, and every
 * non-reserved root key is a bpmn root element keyed by its id:
 *
 * ```yaml
 * id: my_study                                # bpmn:Definitions id
 * definitions: { targetNamespace: ..., ... }  # remaining definitions attributes
 * My_Process:                                 # one entry per bpmn rootElement
 *   type: bpmn:Process
 *   flowElements: { Start: { type: bpmn:StartEvent, ... }, ... }
 * diagram: [ ... ]                            # only DI that cannot be folded inline
 * ```
 *
 * The studyflow format version is identified by the core namespace URI
 * (`xmlns:studyflow: http://behaverse.org/schemas/studyflow/v1`); the
 * unversioned URI written by older releases is rewritten on load.
 *
 * Loading additionally derives missing `incoming`/`outgoing` lists on flow
 * nodes from each sequence flow's `sourceRef`/`targetRef`, so hand-written
 * files may omit them.
 *
 * Layout: `serialize.ts` writes (moddle tree -> document), `deserialize.ts` reads
 * (document -> moddle tree), and each of the four foldings above lives in one
 * module under `foldings/` — its FOLD (serialize), UNFOLD (deserialize), and the
 * shared "does this qualify to fold?" predicate co-located so the round-trip
 * invariant sits in one place. `common.ts` holds the remaining shared plumbing.
 *
 * NOTE: this module reads and writes the serialized form and therefore may
 * use moddle's object model (`$descriptor`, `$attrs`) — the same exemption
 * as `parsers/`. Schema semantics still come from the catalog everywhere
 * else in the app.
 */

/** True when the text is an XML document (legacy `.studyflow`, `.bpmn`, `.xml`). */
export function looksLikeXml(text: string): boolean {
  return /^\uFEFF?\s*</.test(text);
}

/**
 * Rewrite the unversioned core namespace written by older releases to the
 * current versioned one. Quote-bounded, so the sub-schema namespaces
 * (`.../studyflow/cognitive`, ...) are untouched. Idempotent.
 */
export function normalizeStudyflowXml(xml: string): string {
  return xml.replace(/(["'])http:\/\/behaverse\.org\/schemas\/studyflow\1/g, `$1${STUDYFLOW_NS}$1`);
}

export type StudyflowMetadata = { id?: string; name?: string; description?: string };

/** First non-empty text in a folded `documentation` value (string, list, or `{text}`). */
function documentationText(value: unknown): string | undefined {
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (item && typeof item === 'object') {
      const text = (item as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim()) return text.trim();
    }
  }
  return undefined;
}

/**
 * Lightweight title/description probe for file pickers and galleries.
 *
 * Reads the primary root element — Process, then Choreography, then
 * Collaboration, then any root — without a moddle round-trip. Returns `{}`
 * for YAML that parses to something other than a document; throws on
 * unparseable YAML (mirroring how the XML path surfaces invalid input).
 */
export function readStudyflowMetadata(yamlText: string): StudyflowMetadata {
  const doc = yaml.load(yamlText);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return {};

  const roots = Object.entries(doc as YamlDoc).filter(
    ([key, value]) => !RESERVED_DOC_KEYS.has(key) && !!value && typeof value === 'object' && !Array.isArray(value),
  ) as Array<[string, Record<string, any>]>;

  const byType = (name: string) => roots.find(([, el]) => toLocalName(el.type) === name);
  const primary = byType('Process') ?? byType('Choreography') ?? byType('Collaboration') ?? roots[0];
  if (!primary) return {};

  const [id, root] = primary;
  return {
    id,
    name: typeof root.name === 'string' && root.name.trim() ? root.name.trim() : undefined,
    description: documentationText(root.documentation),
  };
}

/** BPMN 2.0 XML -> `.studyflow` YAML text. */
export async function xmlToStudyflow(xml: string, moddle: any): Promise<string> {
  const { rootElement: definitions } = await moddle.fromXML(normalizeStudyflowXml(xml));
  // Standard-form I/O (`ioSpecification`) collapses to the compact binding
  // attributes the YAML documents.
  foldIoSpecification(definitions);
  return yaml.dump(definitionsToYamlDoc(definitions), YAML_DUMP_OPTIONS);
}

/** `.studyflow` YAML text -> BPMN 2.0 XML. */
export async function studyflowToXml(yamlText: string, moddle: any): Promise<string> {
  const { xml } = await moddle.toXML(studyflowToDefinitions(yamlText, moddle), { format: true });
  return xml;
}
