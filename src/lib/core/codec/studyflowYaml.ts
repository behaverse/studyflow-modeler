import * as yaml from 'js-yaml';

/**
 * `.studyflow` YAML codec — a lossless, semantic mapping between the BPMN
 * object tree and a YAML document.
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
 * Top-level document shape:
 *
 * ```yaml
 * studyflow: '1'
 * definitions: { id: ..., targetNamespace: ... }
 * elements:    [ { type: studyflow:Study, ... } ]   # bpmn rootElements
 * diagram:     [ ... ]                              # bpmndi tree (geometry)
 * ```
 *
 * NOTE: this module is part of the serialization (codec) layer and therefore
 * may use moddle's object model (`$descriptor`, `$attrs`) — the same
 * exemption as `parsers/studyflow.ts`. Schema semantics still come from the
 * catalog everywhere else in the app.
 */

export const STUDYFLOW_YAML_VERSION = '1';

type YamlDoc = {
  studyflow: string;
  definitions: Record<string, unknown>;
  elements: unknown[];
  diagram: unknown[];
};

/** True when the text is an XML document (legacy `.studyflow`, `.bpmn`, `.xml`). */
export function looksLikeXml(text: string): boolean {
  return /^\uFEFF?\s*</.test(text);
}

// ---------------------------------------------------------------------------
// moddle tree -> plain document
// ---------------------------------------------------------------------------

function isModdleElement(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && typeof (value as any).$type === 'string';
}

function serializeValue(value: any, declaredType: string | undefined): unknown {
  if (!isModdleElement(value)) return value;
  return serializeElement(value, declaredType);
}

function serializeElement(el: any, declaredType?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (el.$type !== declaredType) out.type = el.$type;

  for (const p of el.$descriptor?.properties ?? []) {
    const value = el[p.name];
    if (value === undefined || value === null) continue;
    if (p.default !== undefined && value === p.default) continue;

    if (p.isMany) {
      if (!Array.isArray(value) || value.length === 0) continue;
      out[p.name] = p.isReference
        ? value.map((ref: any) => ref?.id)
        : value.map((item: any) => serializeValue(item, p.type));
      continue;
    }

    out[p.name] = p.isReference ? value?.id : serializeValue(value, p.type);
  }

  // Raw XML attributes unknown to the schemas (e.g. template icon overrides).
  for (const [name, value] of Object.entries(el.$attrs ?? {})) {
    if (!(name in out)) out[name] = value;
  }

  return out;
}

/** Serialize a `bpmn:Definitions` tree into the `.studyflow` YAML document. */
export function definitionsToYamlDoc(definitions: any): YamlDoc {
  const doc = serializeElement(definitions, 'bpmn:Definitions');
  const { rootElements, diagrams, ...rest } = doc;
  return {
    studyflow: STUDYFLOW_YAML_VERSION,
    definitions: rest,
    elements: (rootElements as unknown[]) ?? [],
    diagram: (diagrams as unknown[]) ?? [],
  };
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

class Reconstructor {
  private moddle: any;
  private pending: PendingRef[] = [];
  private byId = new Map<string, any>();

  constructor(moddle: any) {
    this.moddle = moddle;
  }

  build(node: Record<string, any>, declaredType: string | undefined): any {
    const { type, ...props } = node;
    const typeName = (type as string | undefined) ?? declaredType;
    if (!typeName) throw new Error(`Element is missing a 'type': ${JSON.stringify(node).slice(0, 120)}`);

    const el = this.createElement(typeName);
    const descriptor = this.moddle.getElementDescriptor(el);

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
        const items = (raw as unknown[]).map((item) => this.buildValue(item, p.type));
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

  /** Renamed schema prefixes accepted in older `.studyflow` YAML files. */
  private static LEGACY_PREFIXES: Record<string, string> = { core: 'studyflow' };

  private createElement(typeName: string): any {
    try {
      return this.moddle.create(typeName, {});
    } catch (error) {
      const [prefix, localName] = typeName.includes(':') ? typeName.split(':', 2) : [undefined, typeName];
      const renamed = prefix && Reconstructor.LEGACY_PREFIXES[prefix];
      if (!renamed) throw error;
      return this.moddle.create(`${renamed}:${localName}`, {});
    }
  }

  private buildValue(raw: unknown, declaredType: string | undefined): unknown {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const isElementType = declaredType && !isPrimitiveTypeRef(declaredType);
      if (isElementType || 'type' in (raw as Record<string, unknown>)) {
        return this.build(raw as Record<string, any>, declaredType);
      }
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
}

function isPrimitiveTypeRef(type: string): boolean {
  return ['String', 'Boolean', 'Integer', 'Real', 'Element'].includes(type);
}

/** Rebuild a `bpmn:Definitions` tree from a parsed `.studyflow` YAML document. */
export function yamlDocToDefinitions(doc: YamlDoc, moddle: any): any {
  if (!doc || typeof doc !== 'object' || !('studyflow' in doc)) {
    throw new Error("Not a studyflow YAML document (missing 'studyflow' version key).");
  }

  const reconstructor = new Reconstructor(moddle);
  const definitions = reconstructor.build(
    {
      type: 'bpmn:Definitions',
      ...(doc.definitions ?? {}),
      rootElements: doc.elements ?? [],
      diagrams: doc.diagram ?? [],
    },
    'bpmn:Definitions',
  );
  reconstructor.resolveReferences();
  return definitions;
}

// ---------------------------------------------------------------------------
// Text-level helpers
// ---------------------------------------------------------------------------

const YAML_DUMP_OPTIONS: yaml.DumpOptions = { noRefs: true, lineWidth: 120, quotingType: '"' };

/** BPMN 2.0 XML -> `.studyflow` YAML text. */
export async function xmlToStudyflowYaml(xml: string, moddle: any): Promise<string> {
  const { rootElement: definitions } = await moddle.fromXML(xml);
  return yaml.dump(definitionsToYamlDoc(definitions), YAML_DUMP_OPTIONS);
}

/** `.studyflow` YAML text -> BPMN 2.0 XML. */
export async function studyflowYamlToXml(yamlText: string, moddle: any): Promise<string> {
  const definitions = yamlDocToDefinitions(yaml.load(yamlText) as YamlDoc, moddle);
  const { xml } = await moddle.toXML(definitions, { format: true });
  return xml;
}
