import * as yaml from 'js-yaml';

import { LEGACY_STUDYFLOW_NS, STUDYFLOW_NS } from './constants';

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
 *     `behaverse:BotConfigurations`, ...) inline their parsed body as nested
 *     YAML instead of a `value: |` string block,
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
 * NOTE: this module reads and writes the serialized form and therefore may
 * use moddle's object model (`$descriptor`, `$attrs`) — the same exemption
 * as `parseStudyflow.ts`. Schema semantics still come from the catalog
 * everywhere else in the app.
 */

type YamlDoc = Record<string, unknown>;

/** Top-level keys that are not root-element ids (`studyflow`/`elements` are legacy). */
const RESERVED_DOC_KEYS = new Set(['studyflow', 'id', 'definitions', 'elements', 'diagram']);

const YAML_DUMP_OPTIONS: yaml.DumpOptions = { noRefs: true, lineWidth: 120, quotingType: '"' };

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

function localName(type: string | undefined): string | undefined {
  return type?.includes(':') ? type.split(':').pop() : type;
}

/**
 * Authored value-type of a body property. `toModdlePackages` flattens a
 * value-typed body's wire type to `String` (so moddle XML-escapes its text) but
 * preserves the original in `bodyValueType`, so YAML-body detection — which must
 * fold `YAMLString` bodies but not `MarkdownString` ones — survives the flatten.
 */
function bodyValueType(prop: any): string | undefined {
  return prop.bodyValueType ?? prop.type;
}

/** The plane of the primary diagram is anchored here when not stated explicitly. */
function inferPlaneRoot(definitions: any): any | undefined {
  const roots: any[] = definitions.rootElements ?? [];
  return (
    roots.find((root) => root?.$instanceOf?.('bpmn:Collaboration'))
    ?? roots.find((root) => root?.$instanceOf?.('bpmn:Process'))
    ?? roots.find((root) => typeof root?.id === 'string')
  );
}

// ---------------------------------------------------------------------------
// moddle tree -> plain document
// ---------------------------------------------------------------------------

type SerializeContext = {
  /** Semantic element id -> foldable DI payload (bounds, label, waypoint, colors...). */
  di: Map<string, Record<string, unknown>>;
  /** Ids whose planeElement was folded into the element; drives leftover filtering. */
  foldedIds: Set<string>;
};

function isModdleElement(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && typeof (value as any).$type === 'string';
}

function serializeValue(value: any, declaredType: string | undefined, ctx?: SerializeContext): unknown {
  if (!isModdleElement(value)) return value;
  return inlineYamlBody(value) ?? unwrapElementList(value, ctx) ?? serializeElement(value, declaredType, ctx);
}

/**
 * Config wrappers whose whole content is a YAML body (`cognitive:Configurations`
 * and friends) inline that body as nested YAML. Bodies that don't parse to a
 * non-empty mapping — or that would be re-read as the wrapped form — stay wrapped.
 */
function inlineYamlBody(el: any): Record<string, unknown> | undefined {
  const props: any[] = el.$descriptor?.properties ?? [];
  const body = props.find((p) => p.isBody);
  if (!body || localName(bodyValueType(body)) !== 'YAMLString') return undefined;
  if (typeof el[body.name] !== 'string' || el[body.name] === '') return undefined;
  if (Object.keys(el.$attrs ?? {}).length > 0) return undefined;
  for (const p of props) {
    if (p === body) continue;
    const value = el[p.name];
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) return undefined;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(el[body.name]);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;

  const keys = Object.keys(parsed);
  const byName = el.$descriptor?.propertiesByName ?? {};
  if (keys.length === 0 || 'type' in parsed) return undefined;
  if (keys.every((key) => key in byName)) return undefined;
  return parsed as Record<string, unknown>;
}

/**
 * List wrappers — types whose only content property is a single isMany list
 * (`bpmn:ExtensionElements#values`) — collapse to the plain list.
 */
function unwrapElementList(el: any, ctx?: SerializeContext): unknown[] | undefined {
  const props: any[] = el.$descriptor?.properties ?? [];
  const content = props.filter((p) => !p.isAttr && !p.isReference && !p.isBody);
  if (content.length !== 1 || !content[0].isMany) return undefined;
  if (Object.keys(el.$attrs ?? {}).length > 0) return undefined;
  for (const p of props) {
    if (p === content[0]) continue;
    if (el[p.name] !== undefined && el[p.name] !== null) return undefined;
  }
  const items = el[content[0].name];
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return items.map((item: any) => serializeValue(item, undefined, ctx));
}

function serializeElement(el: any, declaredType?: string, ctx?: SerializeContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (el.$type !== declaredType) out.type = el.$type;

  for (const p of el.$descriptor?.properties ?? []) {
    const value = el[p.name];
    if (value === undefined || value === null) continue;
    if (p.default !== undefined && value === p.default) continue;

    if (p.isMany) {
      if (!Array.isArray(value) || value.length === 0) continue;
      if (p.isReference) {
        out[p.name] = value.map((ref: any) => ref?.id);
        continue;
      }
      const items = value.map((item: any) => serializeValue(item, p.type, ctx));
      out[p.name] = keyItemsById(items) ?? items;
      continue;
    }

    out[p.name] = p.isReference ? value?.id : serializeValue(value, p.type, ctx);
  }

  // Raw XML attributes unknown to the schemas (e.g. template icon overrides).
  for (const [name, value] of Object.entries(el.$attrs ?? {})) {
    if (!(name in out)) out[name] = value;
  }

  // Fold this element's diagram geometry in (skipped on any key collision —
  // the planeElement then stays under the top-level `diagram:` instead).
  const di = ctx && typeof el.id === 'string' ? ctx.di.get(el.id) : undefined;
  if (di && ctx && Object.keys(di).every((key) => !(key in out))) {
    Object.assign(out, di);
    ctx.foldedIds.add(el.id);
  }

  return out;
}

/**
 * Containment lists whose items all carry unique ids fold into an `id -> body`
 * mapping; the `id` field becomes the key. Returns undefined (keep the list)
 * when any item is id-less.
 */
function keyItemsById(items: unknown[]): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const { id, ...body } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || id in out) return undefined;
    out[id] = body;
  }
  return out;
}

/** `id -> body` mapping form of a containment list back to a plain list. */
function keyedMapToList(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>).map(([id, body]) =>
    body && typeof body === 'object' && !Array.isArray(body) ? { id, ...(body as object) } : { id },
  );
}

/** DI reference properties point at other DI elements whose ids are regenerated on load. */
const UNFOLDABLE_DI_KEYS = new Set(['sourceElement', 'targetElement', 'choreographyActivityShape']);

/** Map semantic element ids to the DI payload of their planeElement (primary diagram only). */
function planDiFolding(definitions: any): Map<string, Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  const seen = new Set<string>();
  for (const pe of definitions.diagrams?.[0]?.plane?.planeElement ?? []) {
    const refId = pe?.bpmnElement?.id;
    if (typeof refId !== 'string' || refId === '') continue;
    if (seen.has(refId)) {
      byId.delete(refId); // two planeElements for one element: ambiguous, keep both in `diagram:`
      continue;
    }
    seen.add(refId);
    const payload = foldablePayload(pe);
    if (payload) byId.set(refId, payload);
  }
  return byId;
}

function foldablePayload(pe: any): Record<string, unknown> | undefined {
  if (pe.$type !== 'bpmndi:BPMNShape' && pe.$type !== 'bpmndi:BPMNEdge') return undefined;
  if (Object.keys(pe.$attrs ?? {}).length > 0) return undefined; // unclassifiable on load
  const node = serializeElement(pe, pe.$type);
  delete node.id; // regenerated as `<elementId>_di` on load
  delete node.bpmnElement;
  for (const key of Object.keys(node)) if (UNFOLDABLE_DI_KEYS.has(key)) return undefined;
  return node;
}

/** Whatever DI did not fold inline: extra diagrams, exotic planeElements. */
function serializeLeftoverDiagrams(definitions: any, ctx: SerializeContext): unknown[] {
  const diagrams: any[] = definitions.diagrams ?? [];
  const inferredRootId = inferPlaneRoot(definitions)?.id;
  return diagrams.flatMap((diagram, index) => {
    const node = serializeElement(diagram, 'bpmndi:BPMNDiagram') as Record<string, any>;
    const plane = node.plane as Record<string, any> | undefined;
    if (index === 0 && plane && plane.planeElement) {
      const folded = (pe: any) => typeof pe?.bpmnElement === 'string' && ctx.foldedIds.has(pe.bpmnElement);
      if (Array.isArray(plane.planeElement)) {
        const remaining = plane.planeElement.filter((pe: any) => !folded(pe));
        if (remaining.length > 0) plane.planeElement = remaining;
        else delete plane.planeElement;
      } else {
        const remaining = Object.entries(plane.planeElement).filter(([, pe]) => !folded(pe));
        if (remaining.length > 0) plane.planeElement = Object.fromEntries(remaining);
        else delete plane.planeElement;
      }
    }
    const redundant = index === 0 && diagrams.length === 1 && isRedundantDiagramNode(node, inferredRootId);
    return redundant ? [] : [node];
  });
}

/** True when the diagram is fully implied by the document and can be regenerated. */
function isRedundantDiagramNode(node: Record<string, any>, inferredRootId: string | undefined): boolean {
  if (Object.keys(node).some((key) => key !== 'id' && key !== 'plane')) return false;
  const plane = node.plane as Record<string, any> | undefined;
  if (!plane) return true;
  if (Object.keys(plane).some((key) => key !== 'id' && key !== 'bpmnElement')) return false;
  return plane.bpmnElement === undefined || plane.bpmnElement === inferredRootId;
}

/** Serialize a `bpmn:Definitions` tree into the `.studyflow` YAML document. */
function definitionsToYamlDoc(definitions: any): YamlDoc {
  const ctx: SerializeContext = { di: planDiFolding(definitions), foldedIds: new Set() };
  const serialized = serializeElement(definitions, 'bpmn:Definitions', ctx);
  const { rootElements, diagrams: _diagrams, id, ...rest } = serialized;
  const diagram = serializeLeftoverDiagrams(definitions, ctx);

  const doc: YamlDoc = {};
  if (id !== undefined) doc.id = id;
  doc.definitions = rest;

  // Root elements live at the document root, keyed by id; anything unkeyable
  // (no id, or an id that collides with a reserved key) falls back to the
  // legacy `elements:` list.
  const unkeyable: unknown[] = [];
  if (Array.isArray(rootElements)) {
    unkeyable.push(...rootElements);
  } else {
    for (const [key, body] of Object.entries((rootElements as Record<string, unknown>) ?? {})) {
      if (!RESERVED_DOC_KEYS.has(key) && !(key in doc)) doc[key] = body;
      else unkeyable.push({ id: key, ...(body as object) });
    }
  }
  if (unkeyable.length > 0) doc.elements = unkeyable;

  if (diagram.length > 0) doc.diagram = diagram;
  return doc;
}

// ---------------------------------------------------------------------------
// plain document -> moddle tree
// ---------------------------------------------------------------------------

type PendingRef = {
  element: any;
  property: string;
  ids: string[];
  isMany: boolean;
  context: string;
};

type InlineDi = {
  element: any;
  type: 'bpmndi:BPMNShape' | 'bpmndi:BPMNEdge';
  props: Record<string, unknown>;
};

class ModdleBuilder {
  private moddle: any;
  private pending: PendingRef[] = [];
  private byId = new Map<string, any>();
  private inlineDi: InlineDi[] = [];
  private descriptors = new Map<string, any>();

  constructor(moddle: any) {
    this.moddle = moddle;
  }

  build(node: Record<string, any>, declaredType: string | undefined): any {
    const { type, ...props } = node;
    const typeName = (type as string | undefined) ?? declaredType;
    if (!typeName) throw new Error(`Element is missing a 'type': ${JSON.stringify(node).slice(0, 120)}`);

    const el = this.createElement(typeName);
    const descriptor = this.moddle.getElementDescriptor(el);
    this.extractInlineDi(el, descriptor, props);

    for (const [name, raw] of Object.entries(props)) {
      if (raw === undefined || raw === null) continue;
      const p = descriptor.propertiesByName?.[name];

      if (!p) {
        // Unknown to the loaded schemas: keep as a raw XML attribute.
        el.$attrs[name] = raw;
        continue;
      }

      if (p.isReference) {
        const ids = (p.isMany ? (raw as unknown[]) : [raw]).map(String);
        this.pending.push({ element: el, property: p.name, ids, isMany: !!p.isMany, context: typeName });
        continue;
      }

      if (p.isMany) {
        const list = Array.isArray(raw) ? (raw as unknown[]) : keyedMapToList(raw);
        const items = list.map((item) => this.buildValue(item, p.type));
        for (const item of items) if (isModdleElement(item)) item.$parent = el;
        el.set(p.name, items);
        continue;
      }

      const value = this.buildValue(raw, p.type);
      if (isModdleElement(value)) value.$parent = el;
      el.set(p.name, value);
    }

    if (typeof el.id === 'string' && el.id) this.byId.set(el.id, el);
    return el;
  }

  /**
   * Rebuild the bpmndi tree: leftover `diagram:` entries first, then the
   * geometry folded into elements (attached to the primary plane, which is
   * synthesized when the document carries none).
   */
  buildDiagrams(docDiagrams: unknown[], definitions: any): any[] {
    const diagrams = docDiagrams.map((node) => this.build(node as Record<string, any>, 'bpmndi:BPMNDiagram'));
    if (this.inlineDi.length === 0) return diagrams;

    let diagram = diagrams[0];
    if (!diagram) {
      diagram = this.moddle.create('bpmndi:BPMNDiagram', { id: 'BPMNDiagram_1' });
      diagrams.push(diagram);
    }
    let plane = diagram.plane;
    if (!plane) {
      plane = this.moddle.create('bpmndi:BPMNPlane', { id: 'BPMNPlane_1' });
      plane.$parent = diagram;
      diagram.set('plane', plane);
    }
    // A doc-provided bpmnElement reference wins — it overwrites this default
    // in resolveReferences.
    if (!plane.bpmnElement) plane.set('bpmnElement', inferPlaneRoot(definitions));

    const planeElements = plane.get('planeElement');
    for (const { element, type, props } of this.inlineDi) {
      const id = typeof element.id === 'string' && element.id ? `${element.id}_di` : undefined;
      const pe = this.build({ type, ...(id ? { id } : {}), ...props }, undefined);
      pe.set('bpmnElement', element);
      pe.$parent = plane;
      planeElements.push(pe);
    }
    return diagrams;
  }

  /** Renamed schema prefixes accepted in older `.studyflow` YAML files. */
  private static LEGACY_PREFIXES: Record<string, string> = { core: 'studyflow' };

  private createElement(typeName: string): any {
    try {
      return this.moddle.create(typeName, {});
    } catch (error) {
      const [prefix, localPart] = typeName.includes(':') ? typeName.split(':', 2) : [undefined, typeName];
      const renamed = prefix && ModdleBuilder.LEGACY_PREFIXES[prefix];
      if (!renamed) throw error;
      return this.moddle.create(`${renamed}:${localPart}`, {});
    }
  }

  private descriptorOf(typeName: string): any | undefined {
    if (!this.descriptors.has(typeName)) {
      let descriptor: any;
      try {
        descriptor = this.moddle.getElementDescriptor(this.createElement(typeName));
      } catch {
        descriptor = undefined;
      }
      this.descriptors.set(typeName, descriptor);
    }
    return this.descriptors.get(typeName);
  }

  /** The single isMany content property of list-wrapper types (`bpmn:ExtensionElements#values`). */
  private elementListPropertyOf(typeName: string): any | undefined {
    const props: any[] = this.descriptorOf(typeName)?.properties ?? [];
    const content = props.filter((p) => !p.isAttr && !p.isReference && !p.isBody);
    return content.length === 1 && content[0].isMany ? content[0] : undefined;
  }

  /** The YAML-typed body property of config-wrapper types (`cognitive:Configurations#value`). */
  private yamlBodyPropertyOf(typeName: string): any | undefined {
    const body = (this.descriptorOf(typeName)?.properties ?? []).find((p: any) => p.isBody);
    return body && localName(bodyValueType(body)) === 'YAMLString' ? body : undefined;
  }

  private allKeysDeclared(node: Record<string, unknown>, typeName: string): boolean {
    const byName = this.descriptorOf(typeName)?.propertiesByName ?? {};
    return Object.keys(node).every((key) => key in byName);
  }

  /**
   * Pull inline diagram geometry off a semantic element node: `bounds` marks a
   * shape, `waypoint` an edge; the remaining keys move along when they belong
   * to the DI descriptor and not the element's own (colors, label, DI flags).
   */
  private extractInlineDi(el: any, descriptor: any, props: Record<string, any>): void {
    const byName = descriptor.propertiesByName ?? {};
    const diType =
      'bounds' in props && !byName['bounds'] ? ('bpmndi:BPMNShape' as const)
      : 'waypoint' in props && !byName['waypoint'] ? ('bpmndi:BPMNEdge' as const)
      : undefined;
    if (!diType) return;

    const diByName = this.descriptorOf(diType)?.propertiesByName ?? {};
    const diProps: Record<string, unknown> = {};
    for (const key of Object.keys(props)) {
      if (key === 'id' || byName[key] || !diByName[key]) continue;
      diProps[key] = props[key];
      delete props[key];
    }
    this.inlineDi.push({ element: el, type: diType, props: diProps });
  }

  private buildValue(raw: unknown, declaredType: string | undefined): unknown {
    const isElementType = !!declaredType && !isPrimitiveTypeRef(declaredType);

    if (Array.isArray(raw)) {
      // `extensionElements: [ ... ]` — a list given for a list-wrapper type
      // collapses back into its only isMany property.
      const listProp = isElementType ? this.elementListPropertyOf(declaredType) : undefined;
      return listProp ? this.build({ type: declaredType, [listProp.name]: raw }, declaredType) : raw;
    }

    if (raw && typeof raw === 'object') {
      const node = raw as Record<string, any>;
      if ('type' in node) return this.build(node, declaredType);
      if (!isElementType) return raw;
      const body = this.yamlBodyPropertyOf(declaredType);
      if (body && !this.allKeysDeclared(node, declaredType)) {
        // Inlined config body: dump the mapping back into the wrapper's YAML string.
        return this.build({ type: declaredType, [body.name]: yaml.dump(node, YAML_DUMP_OPTIONS) }, declaredType);
      }
      return this.build(node, declaredType);
    }

    if (typeof raw === 'string' && isElementType) {
      const body = this.yamlBodyPropertyOf(declaredType);
      if (body) return this.build({ type: declaredType, [body.name]: raw }, declaredType);
    }

    return raw;
  }

  resolveReferences(): void {
    for (const { element, property, ids, isMany, context } of this.pending) {
      const targets = ids.map((id) => {
        const target = this.byId.get(id);
        if (!target) throw new Error(`Unresolved reference '${id}' on ${context}#${property}`);
        return target;
      });
      element.set(property, isMany ? targets : targets[0]);
    }
  }

  /**
   * Hand-written files may omit `incoming`/`outgoing` on flow nodes; derive
   * them from each sequence flow's `sourceRef`/`targetRef` after resolution.
   */
  linkSequenceFlows(): void {
    for (const el of this.byId.values()) {
      if (!el.$instanceOf?.('bpmn:SequenceFlow') || !el.sourceRef || !el.targetRef) continue;
      const outgoing = el.sourceRef.get?.('outgoing');
      if (Array.isArray(outgoing) && !outgoing.includes(el)) outgoing.push(el);
      const incoming = el.targetRef.get?.('incoming');
      if (Array.isArray(incoming) && !incoming.includes(el)) incoming.push(el);
    }
  }
}

function isPrimitiveTypeRef(type: string): boolean {
  return ['String', 'Boolean', 'Integer', 'Real', 'Element'].includes(type);
}

/** Rebuild a `bpmn:Definitions` tree from `.studyflow` YAML text. */
export function studyflowToDefinitions(yamlText: string, moddle: any): any {
  const doc = yaml.load(yamlText) as YamlDoc;
  if (!doc || typeof doc !== 'object' || !('definitions' in doc || 'studyflow' in doc)) {
    throw new Error("Not a studyflow YAML document (missing 'definitions').");
  }

  // Root elements: id-keyed top-level entries, plus the legacy `elements:` list.
  const rootElements: unknown[] = [];
  for (const [key, body] of Object.entries(doc)) {
    if (RESERVED_DOC_KEYS.has(key)) continue;
    rootElements.push(...keyedMapToList({ [key]: body }));
  }
  if (Array.isArray(doc.elements)) rootElements.push(...doc.elements);
  else if (doc.elements) rootElements.push(...keyedMapToList(doc.elements));

  // Older files declare the unversioned core namespace; rewrite it so the
  // declaration matches the registered (versioned) package.
  const definitionAttrs: Record<string, unknown> = { ...((doc.definitions as Record<string, unknown>) ?? {}) };
  for (const [key, value] of Object.entries(definitionAttrs)) {
    if (key.startsWith('xmlns') && value === LEGACY_STUDYFLOW_NS) definitionAttrs[key] = STUDYFLOW_NS;
  }

  const builder = new ModdleBuilder(moddle);
  const definitions = builder.build(
    {
      type: 'bpmn:Definitions',
      ...definitionAttrs,
      ...(doc.id !== undefined ? { id: doc.id } : {}),
      rootElements,
    },
    'bpmn:Definitions',
  );
  const diagrams = builder.buildDiagrams((doc.diagram as unknown[]) ?? [], definitions);
  for (const diagram of diagrams) diagram.$parent = definitions;
  if (diagrams.length > 0) definitions.set('diagrams', diagrams);
  builder.resolveReferences();
  builder.linkSequenceFlows();
  return definitions;
}

// ---------------------------------------------------------------------------
// Text-level helpers
// ---------------------------------------------------------------------------

/** BPMN 2.0 XML -> `.studyflow` YAML text. */
export async function xmlToStudyflow(xml: string, moddle: any): Promise<string> {
  const { rootElement: definitions } = await moddle.fromXML(normalizeStudyflowXml(xml));
  return yaml.dump(definitionsToYamlDoc(definitions), YAML_DUMP_OPTIONS);
}

/** `.studyflow` YAML text -> BPMN 2.0 XML. */
export async function studyflowToXml(yamlText: string, moddle: any): Promise<string> {
  const { xml } = await moddle.toXML(studyflowToDefinitions(yamlText, moddle), { format: true });
  return xml;
}
