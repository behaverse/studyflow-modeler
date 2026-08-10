import { toLocalName } from '@/core/naming';
import { MODDLE_BUILTIN_TYPES } from '@/core/notation/schemaFile';
import { bpmnSelfAndAncestors, isBpmnSubtypeOf } from '@/core/notation/bpmn';
import type {
  AttributeSpec,
  CategoryEntry,
  EnumEntry,
  SchemaEntry,
  Template,
  TypeEntry,
  TypeRole,
} from '@/core/notation/types';

/** Super-class refs that never lead to a BPMN attach point: moddle built-ins, plus bare `BaseElement` (the metamodel root). */
export const NON_BPMN_SUPER_CLASSES: ReadonlySet<string> = new Set([...MODDLE_BUILTIN_TYPES, 'BaseElement']);

export function isSchemaSuperRef(ref: unknown): ref is string {
  if (typeof ref !== 'string' || ref.startsWith('bpmn:')) return false;
  return !NON_BPMN_SUPER_CLASSES.has(toLocalName(ref) ?? ref);
}

export class TypeCatalog {
  readonly schemas: SchemaEntry[] = [];

  readonly diagnostics: string[] = [];

  private typesByName = new Map<string, TypeEntry>();
  private enumsByName = new Map<string, EnumEntry>();
  private traitsByTarget = new Map<string, AttributeSpec[][]>();
  private traitCache = new Map<string, AttributeSpec[]>();
  private typesByRole = new Map<TypeRole, TypeEntry[]>();

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

  bpmnTypeOf(ref: string | undefined, ownerPrefix?: string): string | null {
    if (!ref) return null;
    if (ref.startsWith('bpmn:')) return ref;
    return this.getType(ref, ownerPrefix)?.bpmnType ?? null;
  }

  private traitAttributesOf(bpmnType: string | undefined): AttributeSpec[] {
    if (!bpmnType || !bpmnType.startsWith('bpmn:')) return [];
    const cached = this.traitCache.get(bpmnType);
    if (cached) return cached;

    let merged: AttributeSpec[] = [];
    const chain = bpmnSelfAndAncestors(bpmnType).reverse();
    for (const ancestor of chain) {
      for (const traitAttrs of this.traitsByTarget.get(ancestor) ?? []) {
        merged = mergeAttributeSpecs(merged, traitAttrs);
      }
    }
    this.traitCache.set(bpmnType, merged);
    return merged;
  }

  instanceAttributesOf(typeName: string | undefined): AttributeSpec[] {
    if (!typeName) return [];
    if (typeName.startsWith('bpmn:')) return this.traitAttributesOf(typeName);

    const entry = this.typesByName.get(typeName);
    if (!entry) return [];
    return mergeAttributeSpecs(this.traitAttributesOf(entry.bpmnType ?? undefined), entry.attributes);
  }

  attributeOf(typeName: string | undefined, attrName: string | undefined): AttributeSpec | undefined {
    if (!typeName || !attrName) return undefined;
    const local = toLocalName(attrName);
    return this.instanceAttributesOf(typeName).find(
      (spec) => spec.name === attrName || spec.ns.name === attrName
        || spec.name === local || spec.ns.localName === local,
    );
  }

  defaultsOf(typeName: string | undefined): Record<string, unknown> {
    if (!typeName) return {};
    return this.typesByName.get(typeName)?.defaults ?? {};
  }

  allTypes(): TypeEntry[] {
    return [...this.typesByName.values()];
  }

  allTemplates(): Template[] {
    return this.schemas.flatMap((schema) => schema.templates);
  }

  schemaFor(prefix: string | undefined): SchemaEntry | undefined {
    return this.schemas.find((schema) => schema.prefix === prefix);
  }

  typesWithRole(role: TypeRole): TypeEntry[] {
    return this.typesByRole.get(role) ?? [];
  }

  hasRole(typeName: string | undefined, role: TypeRole): boolean {
    if (!typeName) return false;
    return this.typesByName.get(typeName)?.roles.includes(role) === true;
  }

  categories(): CategoryEntry[] {
    const merged = new Map<string, CategoryEntry>();
    for (const schema of this.schemas) {
      for (const category of schema.categories) {
        if (!merged.has(category.name)) merged.set(category.name, category);
      }
    }
    return [...merged.values()].sort((a, b) => a.order - b.order);
  }

  /** The schema's own `connection.create` rule. `'defer'` means the source declares no allow-list, leaving BPMN's own rules to decide. */
  connectionRule(sourceRef: string | undefined, targetRef: string | undefined): boolean | 'defer' {
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

  register(schema: SchemaEntry, traits: Array<{ targets: string[]; attributes: AttributeSpec[] }>): void {
    this.schemas.push(schema);
    for (const type of schema.types) {
      this.typesByName.set(type.name, type);
      for (const role of type.roles) {
        const list = this.typesByRole.get(role) ?? [];
        list.push(type);
        this.typesByRole.set(role, list);
      }
    }
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
export function mergeAttributeSpecs(base: AttributeSpec[], incoming: AttributeSpec[]): AttributeSpec[] {
  const merged = [...base];
  for (const spec of incoming) {
    const replaces = spec.redefinedName ?? spec.ns.localName;
    const index = merged.findIndex((existing) => existing.ns.localName === replaces);
    if (index >= 0) merged[index] = spec;
    else merged.push(spec);
  }
  return merged;
}
