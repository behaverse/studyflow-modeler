import { splitQName, toLocalName } from '../naming';
import { SCHEMAS } from '../constants';
import type { SchemaModel } from '../schema';
import { BPMN_ANCESTORS, bpmnSelfAndAncestors, isBpmnSubtypeOf } from './bpmn';
import type {
  AttributeSpec,
  EnumEntry,
  NsInfo,
  SchemaEntry,
  Template,
  TemplateFlowConnection,
  TemplateFlowElement,
  TemplateFlowNode,
  TypeEntry,
} from './types';

/** moddle built-ins: property type refs to these stay unqualified. */
const BUILTIN_TYPES = new Set(['String', 'Boolean', 'Integer', 'Real', 'Element']);

/** Super-class refs that never lead to a BPMN attach point. */
const NON_BPMN_SUPER_CLASSES = new Set(['Element', 'BaseElement', 'String', 'Boolean', 'Integer', 'Float', 'Double']);

/** Types whose `superClass` names one of these are value types, not elements. */
const VALUE_TYPE_SUPER_CLASSES = ['String', 'Boolean', 'Integer', 'Float', 'Double'];

/** Schema types backed by the static palette groups instead of schema items. */
export const HIDDEN_SCHEMA_TYPES = new Set(['Study', 'StartEvent', 'EndEvent', 'SequenceFlow']);

/** Palette category per BPMN ancestor; order matters (containers before Activity). */
const CATEGORY_RULES: Array<{ ancestor: string; category: string }> = [
  { ancestor: 'bpmn:Event', category: 'Events' },
  { ancestor: 'bpmn:Gateway', category: 'Gateways' },
  { ancestor: 'bpmn:SubProcess', category: 'Containers' },
  { ancestor: 'bpmn:Participant', category: 'Containers' },
  { ancestor: 'bpmn:Group', category: 'Containers' },
  { ancestor: 'bpmn:Activity', category: 'Activities' },
  { ancestor: 'bpmn:DataObjectReference', category: 'Data' },
  { ancestor: 'bpmn:DataStoreReference', category: 'Data' },
  { ancestor: 'bpmn:ItemAwareElement', category: 'Data' },
];

// Template-definition metadata keys; stripped before attributes flow onto the canvas.
const RESERVED_TEMPLATE_KEYS = new Set(['type', 'name', 'keywords', 'icon', 'attributes', 'mixins', 'flowElements']);
const RESERVED_FLOW_NODE_KEYS = new Set([...RESERVED_TEMPLATE_KEYS, 'id', 'x', 'y']);
const RESERVED_FLOW_CONNECTION_KEYS = new Set(['id', 'type', 'bpmn:type', 'sourceRef', 'targetRef']);

type RawType = Record<string, any>;

export class TypeCatalog {
  readonly schemas: SchemaEntry[] = [];

  private typesByName = new Map<string, TypeEntry>();
  private enumsByName = new Map<string, EnumEntry>();
  /** Trait attribute lists per direct BPMN target type. */
  private traitsByTarget = new Map<string, AttributeSpec[][]>();
  private traitCache = new Map<string, AttributeSpec[]>();

  /** Resolve a qualified-name ref, trying `ownerPrefix` and then every schema for unqualified refs. */
  private resolveIn<T>(byName: Map<string, T>, ref: string, ownerPrefix?: string): T | undefined {
    if (ref.includes(':')) return byName.get(ref);
    if (ownerPrefix) {
      const owned = byName.get(`${ownerPrefix}:${ref}`);
      if (owned) return owned;
    }
    for (const schema of this.schemas) {
      const found = byName.get(`${schema.prefix}:${ref}`);
      if (found) return found;
    }
    return undefined;
  }

  getType(ref: string | undefined, ownerPrefix?: string): TypeEntry | undefined {
    return ref ? this.resolveIn(this.typesByName, ref, ownerPrefix) : undefined;
  }

  enumOf(ref: string | undefined, ownerPrefix?: string): EnumEntry | undefined {
    return ref ? this.resolveIn(this.enumsByName, ref, ownerPrefix) : undefined;
  }

  /** BPMN element type a schema type attaches to; `bpmn:*` refs pass through. */
  bpmnTypeOf(ref: string | undefined, ownerPrefix?: string): string | null {
    if (!ref) return null;
    if (ref.startsWith('bpmn:')) return ref;
    return this.getType(ref, ownerPrefix)?.bpmnType ?? null;
  }

  /** Trait attributes mixed onto a BPMN business-object type (and its subtypes). */
  traitAttributesOf(bpmnType: string | undefined): AttributeSpec[] {
    if (!bpmnType || !bpmnType.startsWith('bpmn:')) return [];
    const cached = this.traitCache.get(bpmnType);
    if (cached) return cached;

    let merged: AttributeSpec[] = [];
    // Base-most traits first so more specific traits can redefine them.
    const chain = bpmnSelfAndAncestors(bpmnType).reverse();
    for (const ancestor of chain) {
      for (const traitAttrs of this.traitsByTarget.get(ancestor) ?? []) {
        merged = mergeAttributeSpecs(merged, traitAttrs);
      }
    }
    this.traitCache.set(bpmnType, merged);
    return merged;
  }

  /**
   * Attributes visible on an instance of `typeName`: for BPMN types the trait
   * attributes, for schema types the effective attributes plus the traits
   * applied via their BPMN super classes (mirrors moddle effective descriptors).
   */
  instanceAttributesOf(typeName: string | undefined): AttributeSpec[] {
    if (!typeName) return [];
    if (typeName.startsWith('bpmn:')) return this.traitAttributesOf(typeName);

    const entry = this.typesByName.get(typeName);
    if (!entry) return [];
    return mergeAttributeSpecs(this.traitAttributesOf(entry.bpmnType ?? undefined), entry.attributes);
  }

  /** Find one attribute by local or qualified name on an instance of `typeName`. */
  attributeOf(typeName: string | undefined, attrName: string | undefined): AttributeSpec | undefined {
    if (!typeName || !attrName) return undefined;
    const local = toLocalName(attrName);
    return this.instanceAttributesOf(typeName).find(
      (spec) => spec.name === attrName || spec.ns.name === attrName || spec.name === local,
    );
  }

  /** Default values across a schema type's inheritance chain, keyed by local name. */
  defaultsOf(typeName: string | undefined): Record<string, unknown> {
    if (!typeName) return {};
    return this.typesByName.get(typeName)?.defaults ?? {};
  }

  allTypes(): TypeEntry[] {
    return [...this.typesByName.values()];
  }

  allEnums(): EnumEntry[] {
    return [...this.enumsByName.values()];
  }

  allTemplates(): Template[] {
    return this.schemas.flatMap((schema) => schema.templates);
  }

  schemaFor(prefix: string | undefined): SchemaEntry | undefined {
    return this.schemas.find((schema) => schema.prefix === prefix);
  }

  /**
   * Schema-driven connection rule: a type may declare `meta.connectsTo` with
   * an allow-list of targets (qualified type names, `bpmn:*` matched against
   * the target's BPMN type and ancestors, or `'*'`). Returns `'defer'` when
   * the source declares no constraints, leaving the decision to the BPMN
   * default rules.
   */
  connectionVerdict(sourceRef: string | undefined, targetRef: string | undefined): boolean | 'defer' {
    const source = sourceRef && !sourceRef.startsWith('bpmn:') ? this.getType(sourceRef) : undefined;
    const allowed = source?.meta?.connectsTo;
    if (!Array.isArray(allowed) || allowed.length === 0) return 'defer';

    const target = targetRef && !targetRef.startsWith('bpmn:') ? this.getType(targetRef) : undefined;
    const targetBpmnType = targetRef?.startsWith('bpmn:') ? targetRef : target?.bpmnType ?? null;

    for (const ref of allowed) {
      if (typeof ref !== 'string') continue;
      if (ref === '*') return true;
      if (target && (target.name === ref || target.ns.localName === ref)) return true;
      if (ref.startsWith('bpmn:') && targetBpmnType && isBpmnSubtypeOf(targetBpmnType, ref)) return true;
    }
    return false;
  }

  /** @internal compile-time registration */
  _register(schema: SchemaEntry, traits: Array<{ targets: string[]; attributes: AttributeSpec[] }>): void {
    this.schemas.push(schema);
    for (const type of schema.types) this.typesByName.set(type.name, type);
    for (const enumEntry of schema.enums) this.enumsByName.set(enumEntry.name, enumEntry);
    for (const trait of traits) {
      for (const target of trait.targets) {
        const list = this.traitsByTarget.get(target) ?? [];
        list.push(trait.attributes);
        this.traitsByTarget.set(target, list);
      }
    }
    this.traitCache.clear();
  }
}

/** Merge attribute lists; later specs replace earlier ones they redefine or shadow. */
function mergeAttributeSpecs(base: AttributeSpec[], incoming: AttributeSpec[]): AttributeSpec[] {
  const merged = [...base];
  for (const spec of incoming) {
    const replaces = spec.redefinedName ?? spec.ns.localName;
    const index = merged.findIndex((existing) => existing.ns.localName === replaces);
    if (index >= 0) merged[index] = spec;
    else merged.push(spec);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

/** Compile schema models (see `src/lib/core/schema`) into the catalog. */
export function buildCatalog(models: SchemaModel[]): TypeCatalog {
  // Defensive copy: the input must stay shareable, and the catalog must stay
  // immune to later mutation of the source models.
  const rawSchemas: Record<string, any> = {};
  for (const model of structuredClone(models)) rawSchemas[model.prefix] = model;

  const catalog = new TypeCatalog();
  const compiler = new Compiler(rawSchemas);

  for (const prefix of Object.keys(rawSchemas)) {
    const raw = rawSchemas[prefix];
    const meta = SCHEMAS.find((s) => s.prefix === prefix);

    const types = (raw.types ?? []).map((rawType: RawType) => compiler.compileType(prefix, rawType));
    const enums = (raw.enumerations ?? []).map((rawEnum: RawType) => compileEnum(prefix, rawEnum));

    const schema: SchemaEntry = {
      prefix,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : prefix,
      description: raw.description,
      icon: typeof raw.icon === 'string' ? raw.icon : undefined,
      core: meta?.core === true,
      types,
      enums,
      templates: [],
    };

    const traits = types
      .filter((type: TypeEntry) => type.style === 'trait')
      .map((type: TypeEntry) => ({
        targets: compiler.traitTargets(prefix, type),
        attributes: type.attributes,
      }));

    catalog._register(schema, traits);
  }

  // Templates need cross-schema type lookups, so compile them after all
  // schemas are registered.
  for (const schema of catalog.schemas) {
    schema.templates = compileTemplates(schema.prefix, rawSchemas[schema.prefix], catalog);
  }

  return catalog;
}

class Compiler {
  private rawSchemas: Record<string, any>;
  private rawByName = new Map<string, { prefix: string; raw: RawType }>();
  private enumNames = new Set<string>();
  private attrCache = new Map<string, AttributeSpec[]>();

  constructor(rawSchemas: Record<string, any>) {
    this.rawSchemas = rawSchemas;
    for (const [prefix, schema] of Object.entries(rawSchemas)) {
      for (const rawType of schema.types ?? []) {
        this.rawByName.set(`${prefix}:${rawType.name}`, { prefix, raw: rawType });
      }
      for (const rawEnum of schema.enumerations ?? []) {
        this.enumNames.add(`${prefix}:${rawEnum.name}`);
      }
    }
  }

  compileType(prefix: string, rawType: RawType): TypeEntry {
    const qualified = `${prefix}:${rawType.name}`;
    const extendsRefs: string[] = rawType.extends ?? [];
    const style = extendsRefs.length > 0 && (rawType.superClass ?? []).length === 0 ? 'trait' : 'wrapper';
    const meta = rawType.meta ?? {};
    const bpmnType = this.resolveBpmnType(qualified, new Set());
    const attributes = this.effectiveAttributes(qualified, new Set());

    // Keyed by qualified name, matching the property names moddle exposes.
    // BPMN-native defaults are deliberately absent: moddle applies those on
    // instantiation by itself.
    const defaults: Record<string, unknown> = {};
    for (const spec of attributes) {
      if (spec.default !== undefined) defaults[spec.ns.name] = spec.default;
    }

    return {
      name: qualified,
      ns: { name: qualified, prefix, localName: rawType.name },
      description: rawType.description,
      icon: typeof rawType.icon === 'string' ? rawType.icon : undefined,
      isAbstract: rawType.isAbstract === true,
      style,
      extends: extendsRefs,
      meta,
      bpmnType,
      attributes,
      defaults,
      hiddenFromPalette: isHiddenFromPalette(rawType, style),
      paletteLabel: humanizeLabel(trimBpmnSuffix(rawType.name, bpmnType ?? '')),
      paletteCategories: paletteCategories(meta, bpmnType),
    };
  }

  /** BPMN target types a trait applies to (resolving custom `extends` refs). */
  traitTargets(prefix: string, type: TypeEntry): string[] {
    const targets: string[] = [];
    for (const ref of type.extends) {
      if (ref.startsWith('bpmn:')) {
        targets.push(ref);
        continue;
      }
      const resolved = this.resolveRef(ref, prefix);
      if (resolved) {
        const target = this.resolveBpmnType(resolved.qualified, new Set());
        if (target) targets.push(target);
      }
    }
    return targets;
  }

  /**
   * Port of `walkForBpmnType`: `meta.bpmnType`, then `extends`, then `bpmn`
   * prefix, then the `superClass` chain (skipping primitives).
   */
  private resolveBpmnType(qualified: string, seen: Set<string>): string | null {
    if (seen.has(qualified)) return null;
    seen.add(qualified);

    const found = this.rawByName.get(qualified);
    if (!found) return qualified.startsWith('bpmn:') && BPMN_ANCESTORS[qualified] ? qualified : null;
    const { prefix, raw } = found;

    const metaBpmn = raw.meta?.bpmnType;
    if (typeof metaBpmn === 'string' && metaBpmn.startsWith('bpmn:')) return metaBpmn;

    for (const ref of raw.extends ?? []) {
      if (typeof ref !== 'string') continue;
      if (ref.startsWith('bpmn:')) return ref;
      const resolved = this.resolveRef(ref, prefix);
      if (!resolved) continue;
      const result = this.resolveBpmnType(resolved.qualified, seen);
      if (result) return result;
    }

    for (const ref of raw.superClass ?? []) {
      if (typeof ref !== 'string') continue;
      const local = toLocalName(ref) ?? ref;
      if (NON_BPMN_SUPER_CLASSES.has(local)) continue;
      if (ref.startsWith('bpmn:')) return ref;
      const resolved = this.resolveRef(ref, prefix);
      if (!resolved) continue;
      const result = this.resolveBpmnType(resolved.qualified, seen);
      if (result) return result;
    }

    return null;
  }

  /** Own attributes plus inherited custom ones, with redefines applied. */
  private effectiveAttributes(qualified: string, stack: Set<string>): AttributeSpec[] {
    const cached = this.attrCache.get(qualified);
    if (cached) return cached;
    if (stack.has(qualified)) return [];
    stack.add(qualified);

    const found = this.rawByName.get(qualified);
    if (!found) return [];
    const { prefix, raw } = found;

    let merged: AttributeSpec[] = [];
    for (const ref of [...(raw.superClass ?? []), ...(raw.extends ?? [])]) {
      if (typeof ref !== 'string' || ref.startsWith('bpmn:')) continue;
      if (NON_BPMN_SUPER_CLASSES.has(toLocalName(ref) ?? ref)) continue;
      const resolved = this.resolveRef(ref, prefix);
      if (!resolved) continue;
      merged = mergeAttributeSpecs(merged, this.effectiveAttributes(resolved.qualified, stack));
    }

    const own = (raw.properties ?? []).map((p: RawType) => this.compileAttribute(prefix, p));
    merged = mergeAttributeSpecs(merged, own);

    this.attrCache.set(qualified, merged);
    return merged;
  }

  private compileAttribute(prefix: string, raw: RawType): AttributeSpec {
    const ns: NsInfo = { name: `${prefix}:${raw.name}`, prefix, localName: raw.name };
    const type = this.qualifyTypeRef(raw.type ?? 'String', prefix);
    const redefinedName = parseRedefinedName(raw.redefines ?? raw.replaces);

    const spec: AttributeSpec = {
      name: raw.name,
      ns,
      type,
      isAttr: raw.isAttr,
      isMany: raw.isMany,
      isId: raw.isId,
      isBody: raw.isBody,
      default: raw.default,
      description: raw.description,
      redefines: raw.redefines,
      replaces: raw.replaces,
      meta: raw.meta,
      redefinedName,
      isEnum: this.enumNames.has(type),
    };

    // Body-wrapper drilling: resolve the wrapped value property once, here.
    if (!spec.isEnum && type.includes(':') && !type.startsWith('bpmn:')) {
      const bodyProp = this.effectiveAttributes(type, new Set()).find((p) => p.isBody);
      if (bodyProp) {
        spec.bodyProp = bodyProp.name;
        spec.bodyType = bodyProp.type;
      }
    }

    return spec;
  }

  /** Qualify a type ref like moddle does: built-ins stay bare, the rest get a prefix. */
  private qualifyTypeRef(ref: string, ownerPrefix: string): string {
    if (ref.includes(':') || BUILTIN_TYPES.has(ref)) return ref;
    return `${ownerPrefix}:${ref}`;
  }

  resolveRef(ref: string, ownerPrefix: string): { qualified: string; raw: RawType } | undefined {
    const { localName } = splitQName(ref);
    const candidates = ref.includes(':')
      ? [ref]
      : [`${ownerPrefix}:${ref}`, ...Object.keys(this.rawSchemas).map((p) => `${p}:${localName ?? ref}`)];

    for (const candidate of candidates) {
      const found = this.rawByName.get(candidate);
      if (found) return { qualified: candidate, raw: found.raw };
    }
    return undefined;
  }
}

function compileEnum(prefix: string, rawEnum: RawType): EnumEntry {
  return {
    name: `${prefix}:${rawEnum.name}`,
    ns: { name: `${prefix}:${rawEnum.name}`, prefix, localName: rawEnum.name },
    description: rawEnum.description,
    literals: (rawEnum.literalValues ?? []).map((lit: RawType) => ({
      name: lit.name,
      value: lit.value,
      icon: lit.icon,
      description: lit.description,
    })),
  };
}

function parseRedefinedName(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined;
  const match = ref.match(/^[^#]+#(.+)$/);
  return match ? toLocalName(match[1]) : undefined;
}

// ---------------------------------------------------------------------------
// Palette metadata
// ---------------------------------------------------------------------------

/** Skip abstract types, value types, trait-only types, and template-only types. */
function isHiddenFromPalette(rawType: RawType, style: 'wrapper' | 'trait'): boolean {
  if (rawType.isAbstract || HIDDEN_SCHEMA_TYPES.has(rawType.name)) return true;
  if (rawType.superClass?.some((sc: string) => VALUE_TYPE_SUPER_CLASSES.includes(sc))) return true;
  if (Array.isArray(rawType.meta?.flowElements) && rawType.meta.flowElements.length > 0) return true;
  if (style === 'trait') return true;
  if (rawType.meta?.templateScopedType) return true;
  return false;
}

const STRIPPABLE_SUFFIXES = ['Gateway', 'Event'];

/** Drop the BPMN base-type suffix (e.g. "ExclusiveGateway" -> "Exclusive"). */
function trimBpmnSuffix(typeName: string, bpmnType: string): string {
  const bpmnLocal = toLocalName(bpmnType) ?? bpmnType;
  for (const suffix of STRIPPABLE_SUFFIXES) {
    if (!bpmnLocal.endsWith(suffix)) continue;
    if (typeName === suffix) continue;
    if (typeName.endsWith(suffix) && typeName.length - suffix.length >= 3) {
      return typeName.slice(0, -suffix.length);
    }
  }
  return typeName;
}

function humanizeLabel(typeName: string): string {
  return typeName
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function paletteCategories(meta: Record<string, any>, bpmnType: string | null): string[] {
  const explicit = meta?.categories;
  if (Array.isArray(explicit) && explicit.length > 0) return explicit;
  if (!bpmnType) return [];
  for (const { ancestor, category } of CATEGORY_RULES) {
    if (isBpmnSubtypeOf(bpmnType, ancestor)) return [category];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Templates (port of the former buildTemplatesRegistry/mixins/normalizeFlow)
// ---------------------------------------------------------------------------

function compileTemplates(prefix: string, rawSchema: RawType, catalog: TypeCatalog): Template[] {
  const templates: Template[] = [];
  const schemaTemplates: RawType[] = rawSchema?.templates ?? [];

  for (const [index, template] of schemaTemplates.entries()) {
    const definition = template?.object;
    if (!definition?.type) continue;

    const mixinData = resolveTemplateMixins(definition, prefix, catalog);
    const merged: Record<string, any> = { ...mixinData.attributes, ...definition };

    const typeName: string = merged.type;
    const qualifiedName = typeName.includes(':') ? typeName : `${prefix}:${typeName}`;
    const entry = catalog.getType(qualifiedName);
    if (!entry || entry.isAbstract) continue;

    const bpmnType = mixinData.bpmnTypeOverride ?? entry.bpmnType;
    if (!bpmnType) continue;

    const attrs = extractAttributes(merged, RESERVED_TEMPLATE_KEYS);

    templates.push({
      id: `${qualifiedName}::template:${index + 1}`,
      name: merged.name ?? merged['bpmn:name'] ?? typeName,
      description: template.description ?? entry.description ?? '',
      appliesTo: [bpmnType],
      elementType: { value: bpmnType },
      category: { id: prefix, name: capitalize(prefix) },
      keywords: merged.keywords ?? [],
      extensionType: qualifiedName,
      bpmnType,
      iconClass: merged.icon ?? entry.icon,
      overrideIconClass: merged.icon,
      templateAttributes: Object.keys(attrs).length > 0 ? attrs : undefined,
      flowElements: normalizeFlowElements(merged, prefix, catalog),
      templateSource: 'schema-template',
      schemaPrefix: prefix.toLowerCase(),
    });
  }

  // Implicit SubProcess template for any type declaring `meta.flowElements`.
  for (const entry of catalog.schemaFor(prefix)?.types ?? []) {
    if (entry.isAbstract) continue;
    const flowElements: Array<Record<string, any>> | undefined = entry.meta?.flowElements;
    if (!flowElements?.length) continue;

    templates.push({
      id: `${entry.name}::type-default`,
      name: entry.ns.localName,
      description: entry.description ?? '',
      appliesTo: ['bpmn:SubProcess'],
      elementType: { value: 'bpmn:SubProcess' },
      category: { id: prefix, name: capitalize(prefix) },
      keywords: [],
      extensionType: entry.name,
      bpmnType: 'bpmn:SubProcess',
      iconClass: entry.meta?.icon ?? entry.icon,
      overrideIconClass: undefined,
      templateAttributes: undefined,
      flowElements: normalizeFlowElements({ flowElements }, prefix, catalog),
      templateSource: 'schema-type',
      schemaPrefix: prefix.toLowerCase(),
    });
  }

  return templates;
}

/** Resolve a `mixins:` chain; each contributes defaults, `bpmn:*` mixins override the BPMN type. */
function resolveTemplateMixins(
  definition: Record<string, any>,
  prefix: string,
  catalog: TypeCatalog,
): { bpmnTypeOverride?: string; attributes: Record<string, any> } {
  const mixins = Array.isArray(definition.mixins) ? definition.mixins : [];
  const attrs: Record<string, any> = {};
  let bpmnTypeOverride: string | undefined;

  for (const mixinRef of mixins) {
    if (typeof mixinRef !== 'string' || mixinRef.trim() === '') continue;

    if (mixinRef.startsWith('bpmn:')) {
      bpmnTypeOverride = mixinRef;
      continue;
    }

    const entry = catalog.getType(mixinRef, prefix);
    if (!entry) {
      console.warn(`[catalog] Unable to resolve template mixin '${mixinRef}'`);
      continue;
    }
    Object.assign(attrs, entry.defaults);
  }

  return { bpmnTypeOverride, attributes: attrs };
}

function normalizeFlowElements(
  definition: Record<string, any>,
  prefix: string,
  catalog: TypeCatalog,
): TemplateFlowElement[] | undefined {
  if (!Array.isArray(definition.flowElements) || definition.flowElements.length === 0) return undefined;

  const normalized: TemplateFlowElement[] = [];

  for (const flowElement of definition.flowElements) {
    if (!flowElement || typeof flowElement !== 'object') continue;

    const isConnection =
      typeof flowElement.sourceRef === 'string'
      && typeof flowElement.targetRef === 'string'
      && (typeof flowElement.type === 'string' || typeof flowElement['bpmn:type'] === 'string');

    const result = isConnection
      ? normalizeFlowConnection(flowElement)
      : (typeof flowElement.type === 'string' ? normalizeFlowNode(flowElement, prefix, catalog) : null);

    if (result) normalized.push(result);
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeFlowNode(
  flowElement: Record<string, any>,
  prefix: string,
  catalog: TypeCatalog,
): TemplateFlowNode | null {
  if (typeof flowElement?.type !== 'string' || flowElement.type.trim() === '') return null;

  const mixinData = resolveTemplateMixins(flowElement, prefix, catalog);
  const merged: Record<string, any> = { ...mixinData.attributes, ...flowElement };

  let extensionType: string | undefined;
  let bpmnType: string | undefined;
  let icon: string | undefined;

  if (merged.type.startsWith('bpmn:')) {
    bpmnType = mixinData.bpmnTypeOverride ?? merged.type;
  } else {
    const qualifiedName = merged.type.includes(':') ? merged.type : `${prefix}:${merged.type}`;
    const entry = catalog.getType(qualifiedName);
    if (!entry || entry.isAbstract) return null;
    extensionType = qualifiedName;
    bpmnType = mixinData.bpmnTypeOverride ?? entry.bpmnType ?? undefined;
    icon = entry.icon;
  }

  if (!bpmnType) return null;

  return {
    id: String(merged.id),
    kind: 'node',
    extensionType,
    bpmnType,
    iconClass: merged.icon ?? icon,
    overrideIconClass: merged.icon,
    templateAttributes: extractAttributes(merged, RESERVED_FLOW_NODE_KEYS),
    x: typeof merged.x === 'number' ? merged.x : undefined,
    y: typeof merged.y === 'number' ? merged.y : undefined,
  };
}

function normalizeFlowConnection(flowElement: Record<string, any>): TemplateFlowConnection | null {
  const bpmnType = flowElement?.['bpmn:type'] ?? flowElement?.type;
  const sourceRef = flowElement?.sourceRef;
  const targetRef = flowElement?.targetRef;

  if (typeof bpmnType !== 'string' || typeof sourceRef !== 'string' || typeof targetRef !== 'string') {
    return null;
  }

  return {
    id: typeof flowElement.id === 'string' ? flowElement.id : undefined,
    kind: 'connection',
    bpmnType,
    sourceRef,
    targetRef,
    templateAttributes: extractAttributes(flowElement, RESERVED_FLOW_CONNECTION_KEYS),
  };
}

/** Keep only keys not in `reservedKeys`, dropping `undefined` values. */
function extractAttributes(definition: Record<string, any>, reservedKeys: Set<string>): Record<string, any> {
  const attributes: Record<string, any> = {};
  for (const [key, value] of Object.entries(definition)) {
    if (!reservedKeys.has(key) && value !== undefined) attributes[key] = value;
  }
  return attributes;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
