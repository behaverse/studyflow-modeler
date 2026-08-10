import { splitQName, toLocalName } from '@/core/naming';
import {
  MODDLE_BUILTIN_TYPES,
  type SchemaCategoryModel,
  type SchemaEnumModel,
  type SchemaModel,
  type SchemaPropertyModel,
  type SchemaTypeModel,
} from '@/core/notation/schemaFile';
import { BPMN_ANCESTORS, isBpmnSubtypeOf } from '@/core/notation/bpmn';
import { humanizeLabel, isHiddenFromPalette, paletteCategories, trimBpmnSuffix } from '@/core/notation/palette';
import { compileTemplates } from '@/core/notation/templates';
import { EDITOR_NAMES, type EditorName } from '@/core/notation/types';
import {
  NON_BPMN_SUPER_CLASSES,
  TypeCatalog,
  isSchemaSuperRef,
  mergeAttributeSpecs,
} from '@/core/notation/query';
import type {
  AttributeSpec,
  CategoryEntry,
  EnumEntry,
  NsInfo,
  SchemaEntry,
  TypeEntry,
  TypeRole,
} from '@/core/notation/types';

export function buildCatalog(models: SchemaModel[]): TypeCatalog {
  const catalog = new TypeCatalog();

  // Cloned so the catalog stays immune to later mutation of the source models.
  const rawSchemas: Record<string, SchemaModel> = {};
  for (const model of structuredClone(models)) {
    if (rawSchemas[model.prefix]) {
      catalog.diagnostics.push(
        `[${model.prefix}] duplicate schema prefix: '${model.name}' ignored (already provided by '${rawSchemas[model.prefix].name}')`);
      continue;
    }
    rawSchemas[model.prefix] = model;
  }

  const compiler = new Compiler(rawSchemas, catalog.diagnostics);

  for (const prefix of Object.keys(rawSchemas)) {
    const raw = rawSchemas[prefix];

    const types = raw.types.map((rawType) => compiler.compileType(prefix, rawType));
    const enums = raw.enumerations.map((rawEnum) => compileEnum(prefix, rawEnum));

    const schema: SchemaEntry = {
      prefix,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : prefix,
      description: raw.description,
      icon: typeof raw.icon === 'string' ? raw.icon : undefined,
      core: raw.core === true,
      uri: typeof raw.uri === 'string' ? raw.uri : undefined,
      categories: compileCategories(raw.categories),
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

    catalog.register(schema, traits);
  }

  // Templates take cross-schema type lookups, so they compile only after every schema is registered.
  for (const schema of catalog.schemas) {
    schema.templates = compileTemplates(schema.prefix, rawSchemas[schema.prefix], catalog);
  }

  checkAttributeMeta(catalog);

  return catalog;
}

/** Author-typo checks needing the full catalog; deduped because an effective attribute repeats on every subtype. */
function checkAttributeMeta(catalog: TypeCatalog): void {
  const seen = new Set<string>();
  const push = (message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    catalog.diagnostics.push(message);
  };

  for (const schema of catalog.schemas) {
    for (const type of schema.types) {
      for (const spec of type.attributes) {
        const where = `[${spec.ns.prefix ?? schema.prefix} ${type.ns.localName}.${spec.name}]`;
        if (spec.default !== undefined) {
          const enumEntry = catalog.enumOf(spec.type, spec.ns.prefix ?? schema.prefix);
          if (enumEntry && !enumEntry.literals.some((lit) => lit.value === spec.default)) {
            push(`${where} default '${String(spec.default)}' is not a literal of ${spec.type}`);
          }
        }
        const editor = spec.meta?.editor;
        if (typeof editor === 'string' && !EDITOR_NAMES.includes(editor as EditorName)) {
          push(`${where} names unknown editor '${editor}' (known: ${EDITOR_NAMES.join(', ')})`);
        }
      }
      const typeEditor = type.meta?.editor;
      if (typeof typeEditor === 'string' && !EDITOR_NAMES.includes(typeEditor as EditorName)) {
        push(`[${schema.prefix} ${type.ns.localName}] names unknown editor '${typeEditor}' (known: ${EDITOR_NAMES.join(', ')})`);
      }
    }
  }
}

function compileCategories(raw: unknown): CategoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is SchemaCategoryModel => !!entry && typeof entry.name === 'string')
    .map((entry, index) => ({
      name: entry.name,
      // A block with no explicit orders still reads top-to-bottom.
      order: typeof entry.order === 'number' ? entry.order : index,
      description: entry.description,
      synthetic: entry.synthetic === true,
    }));
}

/** Attribute a type declares -> the role that declaration implies, so most types never spell `meta.roles`. */
const ROLE_BY_ATTRIBUTE: Record<string, TypeRole> = {
  instrument: 'instrument',
  samplingRate: 'signal',
  device: 'acquisition',
};

export function inferRoles(bpmnType: string | null, attributes: AttributeSpec[]): TypeRole[] {
  const roles = new Set<TypeRole>();

  if (bpmnType && isBpmnSubtypeOf(bpmnType, 'bpmn:ItemAwareElement')) roles.add('data-element');

  for (const spec of attributes) {
    const role = ROLE_BY_ATTRIBUTE[spec.ns.localName];
    if (role) roles.add(role);
  }

  return [...roles];
}

class Compiler {
  private rawSchemas: Record<string, SchemaModel>;
  private rawByName = new Map<string, { prefix: string; raw: SchemaTypeModel }>();
  private enumNames = new Set<string>();
  private attrCache = new Map<string, AttributeSpec[]>();
  private ownAttrCache = new Map<string, AttributeSpec[]>();
  private ancestorCache = new Map<string, string[]>();
  private computingOwnAttrs = new Set<string>();
  private diagnostics: string[];

  constructor(rawSchemas: Record<string, SchemaModel>, diagnostics: string[]) {
    this.rawSchemas = rawSchemas;
    this.diagnostics = diagnostics;
    for (const [prefix, schema] of Object.entries(rawSchemas)) {
      for (const rawType of schema.types) {
        this.rawByName.set(`${prefix}:${rawType.name}`, { prefix, raw: rawType });
      }
      for (const rawEnum of schema.enumerations) {
        this.enumNames.add(`${prefix}:${rawEnum.name}`);
      }
    }
  }

  compileType(prefix: string, rawType: SchemaTypeModel): TypeEntry {
    const qualified = `${prefix}:${rawType.name}`;
    const extendsRefs: string[] = rawType.extends ?? [];
    const style = extendsRefs.length > 0 && (rawType.superClass ?? []).length === 0 ? 'trait' : 'wrapper';
    const meta = rawType.meta ?? {};
    const bpmnType = this.resolveBpmnType(qualified);
    const attributes = this.effectiveAttributes(qualified);

    // Keyed by qualified name, matching the property names moddle exposes.
    const defaults: Record<string, unknown> = {};
    for (const spec of attributes) {
      if (spec.default !== undefined) defaults[spec.ns.name] = spec.default;
    }

    return {
      name: qualified,
      ns: { name: qualified, prefix, localName: rawType.name },
      description: rawType.description,
      icon: typeof rawType.icon === 'string' ? rawType.icon : undefined,
      iconClass: typeof meta.icon === 'string'
        ? meta.icon
        : (typeof rawType.icon === 'string' ? rawType.icon : undefined),
      isAbstract: rawType.isAbstract === true,
      style,
      extends: extendsRefs,
      meta,
      bpmnType,
      attributes,
      defaults,
      roles: [...new Set([
        ...inferRoles(bpmnType, attributes),
        ...this.effectiveRoles(qualified),
      ])],
      hiddenFromPalette: isHiddenFromPalette(qualified, rawType, style),
      paletteLabel: humanizeLabel(trimBpmnSuffix(rawType.name, bpmnType ?? '')),
      paletteCategories: paletteCategories(meta, bpmnType),
    };
  }

  traitTargets(prefix: string, type: TypeEntry): string[] {
    const targets: string[] = [];
    for (const ref of type.extends) {
      if (typeof ref !== 'string') continue;
      if (ref.startsWith('bpmn:')) {
        targets.push(ref);
        continue;
      }
      const resolved = this.resolveRef(ref, prefix);
      if (!resolved) {
        this.warn(prefix, type.ns.localName, `trait extends unresolved type '${ref}'`);
        continue;
      }
      const target = this.resolveBpmnType(resolved.qualified);
      if (target) targets.push(target);
      else this.warn(prefix, type.ns.localName, `trait extends '${ref}', which has no BPMN attach point`);
    }
    if (targets.length === 0) {
      this.warn(prefix, type.ns.localName, 'trait resolved to no BPMN targets; its attributes are unreachable');
    }
    return targets;
  }

  /** Highest precedence first, self excluded — the reverse of moddle's property-application order, so build-up folds (attributes, roles) re-reverse it while nearest-answer folds (the BPMN attach point) read it as-is. */
  private ancestorsOf(qualified: string): string[] {
    const cached = this.ancestorCache.get(qualified);
    if (cached) return cached;

    const applicationOrder: string[] = [];
    this.collectAncestors(qualified, applicationOrder, new Set([qualified]));
    const chain = applicationOrder.reverse();
    this.ancestorCache.set(qualified, chain);
    return chain;
  }

  private selfAndAncestors(qualified: string): string[] {
    return [qualified, ...this.ancestorsOf(qualified)];
  }

  private collectAncestors(qualified: string, out: string[], seen: Set<string>): void {
    const found = this.rawByName.get(qualified);
    if (!found) return;
    const { prefix, raw } = found;

    for (const [kind, refs] of [['superClass', raw.superClass], ['extends', raw.extends]] as const) {
      for (const ref of refs ?? []) {
        if (typeof ref !== 'string') {
          this.warn(prefix, toLocalName(qualified) ?? qualified, `non-string ${kind} ref ${JSON.stringify(ref)}`);
          continue;
        }
        if (!isSchemaSuperRef(ref)) continue;
        const resolved = this.resolveRef(ref, prefix);
        if (!resolved) {
          this.warn(prefix, toLocalName(qualified) ?? qualified, `unresolved ${kind} ref '${ref}'`);
          continue;
        }
        if (seen.has(resolved.qualified)) continue;
        seen.add(resolved.qualified);
        this.collectAncestors(resolved.qualified, out, seen);
        out.push(resolved.qualified);
      }
    }
  }

  private resolveBpmnType(qualified: string): string | null {
    if (!this.rawByName.has(qualified)) {
      return qualified.startsWith('bpmn:') && BPMN_ANCESTORS[qualified] ? qualified : null;
    }

    for (const step of this.selfAndAncestors(qualified)) {
      const raw = this.rawByName.get(step)?.raw;
      if (!raw) continue;

      const metaBpmn = raw.meta?.bpmnType;
      if (typeof metaBpmn === 'string' && metaBpmn.startsWith('bpmn:')) {
        return this.checkedBpmnRef(qualified, metaBpmn, 'meta.bpmnType');
      }

      // `extends` before `superClass`: a trait names its attach point directly, and may legitimately name `bpmn:BaseElement`.
      for (const ref of raw.extends ?? []) {
        if (typeof ref === 'string' && ref.startsWith('bpmn:')) {
          return this.checkedBpmnRef(qualified, ref, 'extends');
        }
      }
      for (const ref of raw.superClass ?? []) {
        if (typeof ref !== 'string' || !ref.startsWith('bpmn:')) continue;
        if (NON_BPMN_SUPER_CLASSES.has(toLocalName(ref) ?? ref)) continue;
        return this.checkedBpmnRef(qualified, ref, 'superClass');
      }
    }
    return null;
  }

  private effectiveRoles(qualified: string): TypeRole[] {
    const roles = new Set<TypeRole>();
    for (const step of this.selfAndAncestors(qualified).reverse()) {
      for (const role of this.rawByName.get(step)?.raw.meta?.roles ?? []) {
        if (typeof role === 'string') roles.add(role);
      }
    }
    return [...roles];
  }

  private effectiveAttributes(qualified: string): AttributeSpec[] {
    const cached = this.attrCache.get(qualified);
    if (cached) return cached;

    let merged: AttributeSpec[] = [];
    for (const step of this.selfAndAncestors(qualified).reverse()) {
      merged = mergeAttributeSpecs(merged, this.ownAttributes(step));
    }

    this.attrCache.set(qualified, merged);
    return merged;
  }

  private ownAttributes(qualified: string): AttributeSpec[] {
    const cached = this.ownAttrCache.get(qualified);
    if (cached) return cached;

    const found = this.rawByName.get(qualified);
    if (!found) return [];
    // Re-entry guard: body-prop drilling re-enters here when a property's type refers back to its owner.
    if (this.computingOwnAttrs.has(qualified)) return [];
    this.computingOwnAttrs.add(qualified);

    const own = (found.raw.properties ?? []).map((p) => this.compileAttribute(found.prefix, p));

    this.computingOwnAttrs.delete(qualified);
    this.ownAttrCache.set(qualified, own);
    return own;
  }

  private warn(prefix: string, typeName: string, message: string): void {
    this.diagnostics.push(`[${prefix}:${typeName}] ${message}`);
  }

  private compileAttribute(prefix: string, raw: SchemaPropertyModel): AttributeSpec {
    // An explicitly prefixed property (`bpmn:loopCondition`) keeps that namespace — how a redefine stays a *bpmn* element on the wire.
    const sep = raw.name.indexOf(':');
    const nsPrefix = sep > 0 ? raw.name.slice(0, sep) : prefix;
    const nsLocal = sep > 0 ? raw.name.slice(sep + 1) : raw.name;
    const ns: NsInfo = { name: `${nsPrefix}:${nsLocal}`, prefix: nsPrefix, localName: nsLocal };
    const type = this.qualifyTypeRef(raw.type ?? 'String', prefix);
    const override = raw.redefines ?? raw.replaces;
    const redefinedName = parseRedefinedName(override);
    if (typeof override === 'string' && redefinedName === undefined) {
      this.warn(prefix, raw.name, `'${override}' is not a 'Type#property' ref; nothing is overridden`);
    }

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

    if (!spec.isEnum && type.includes(':') && !type.startsWith('bpmn:')) {
      const bodyProp = this.effectiveAttributes(type).find((p) => p.isBody);
      if (bodyProp) {
        spec.bodyProp = bodyProp.name;
        spec.bodyType = bodyProp.type;
      }
    }
    // BPMN's own children carry their text in a native body property, which no schema declares; fold them so they read and write as flat strings.
    if (!spec.isAttr && (type === 'bpmn:Expression' || type === 'bpmn:FormalExpression')) {
      spec.bodyProp = 'body';
      spec.bodyType = 'String';
    }
    if (!spec.isAttr && type === 'bpmn:Documentation') {
      spec.bodyProp = 'text';
      spec.bodyType = 'String';
    }

    spec.typeEditor = this.editorOfType(spec.bodyType) ?? this.editorOfType(type);

    return spec;
  }

  private editorOfType(ref: string | undefined): string | undefined {
    if (!ref || !ref.includes(':') || ref.startsWith('bpmn:')) return undefined;
    const editor = this.rawByName.get(ref)?.raw.meta?.editor;
    return typeof editor === 'string' ? editor : undefined;
  }

  private qualifyTypeRef(ref: string, ownerPrefix: string): string {
    if (ref.includes(':') || MODDLE_BUILTIN_TYPES.has(ref)) return ref;
    return `${ownerPrefix}:${ref}`;
  }

  resolveRef(ref: string, ownerPrefix: string): { qualified: string; raw: SchemaTypeModel } | undefined {
    const { localName } = splitQName(ref);
    const candidates = ref.includes(':')
      ? [ref]
      : [`${ownerPrefix}:${ref}`, ...Object.keys(this.rawSchemas).map((p) => `${p}:${localName ?? ref}`)];

    const matches = [...new Set(candidates)].filter((candidate) => this.rawByName.has(candidate));
    if (matches.length > 1) {
      this.warn(ownerPrefix, ref,
        `unqualified ref matches ${matches.length} schemas (${matches.join(', ')}); using '${matches[0]}' — qualify the ref to choose`);
    }
    const found = matches.length > 0 ? this.rawByName.get(matches[0]) : undefined;
    return found ? { qualified: matches[0], raw: found.raw } : undefined;
  }

  private checkedBpmnRef(qualified: string, ref: string, where: string): string | null {
    if (ref in BPMN_ANCESTORS) return ref;
    const { prefix, localName } = splitQName(qualified);
    this.warn(prefix ?? qualified, localName ?? qualified,
      `${where} names unknown BPMN type '${ref}'; the type will not be creatable`);
    return null;
  }
}

function compileEnum(prefix: string, rawEnum: SchemaEnumModel): EnumEntry {
  return {
    name: `${prefix}:${rawEnum.name}`,
    ns: { name: `${prefix}:${rawEnum.name}`, prefix, localName: rawEnum.name },
    description: rawEnum.description,
    literals: (rawEnum.literalValues ?? []).map((lit) => ({
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
