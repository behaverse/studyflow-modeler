/**
 * The metamodel: what each element type of a study holds, read from the package definitions every schema is written
 * in (BPMN's own, its diagram interchange, and each skill's `*.moddle.yaml` compiled by `toModdlePackages`). The study
 * model (`./types.ts`) is plain data; this says which key of an element is a reference, a list, an attribute or a
 * child, in which order a file writes them, and what each type inherits.
 *
 * It computes each type's properties exactly as moddle does (`Registry#getEffectiveDescriptor`): super types first,
 * then the type's own properties, then the traits that extend it; a property that `redefines` or `replaces` another
 * takes its place. So the file a study is written as keeps the order the BPMN XML has always had.
 */

/** A name in a package's namespace: `bpmn:Task`, its prefix `bpmn`, its local name `Task`. */
export type Ns = { name: string; prefix: string; localName: string };

/** A property as a package defines it, with its namespace, as the metamodel registers it. */
export type PropertyDef = {
  name: string;
  ns: Ns;
  type: string;
  isMany?: boolean;
  isReference?: boolean;
  isAttr?: boolean;
  isBody?: boolean;
  isId?: boolean;
  isVirtual?: boolean;
  default?: unknown;
  redefines?: string;
  replaces?: string;
  meta?: Record<string, unknown>;
  /** Whether a type inherits it (from a super type), rather than declaring it or taking it from a trait. */
  inherited?: boolean;
  /** The type that declares it. */
  definedBy?: TypeDef;
  [key: string]: unknown;
};

export type TypeDef = {
  name: string;
  ns: Ns;
  superClass: string[];
  extends: string[];
  properties: PropertyDef[];
  propertiesByName: Record<string, PropertyDef>;
  /** The traits that extend this type, by name. */
  traits?: string[];
  meta: Record<string, unknown>;
  isAbstract?: boolean;
  pkg: PackageDef;
  [key: string]: unknown;
};

/** A package as its definition is written (moddle's JSON form). */
export type PackageDef = {
  name?: string;
  prefix: string;
  uri: string;
  types?: Record<string, unknown>[];
  enumerations?: unknown[];
  associations?: unknown[];
  xml?: { tagAlias?: string };
  [key: string]: unknown;
};

/** What an element of one type holds: every property, by name and in order, from its whole type hierarchy. */
export type Descriptor = {
  ns: Ns;
  name: string;
  /** Every type it is, its traits included. */
  allTypes: TypeDef[];
  allTypesByName: Record<string, TypeDef>;
  properties: PropertyDef[];
  /** By name and by local name. */
  propertiesByName: Record<string, PropertyDef>;
  bodyProperty?: PropertyDef;
  idProperty?: PropertyDef;
  pkg: PackageDef;
};

/** The types every package may use without declaring them. */
export const BUILTIN_TYPES = new Set(['String', 'Boolean', 'Integer', 'Real', 'Element']);

export function parseName(name: string, defaultPrefix?: string): Ns {
  const parts = name.split(/:/);
  if (parts.length > 2) throw new Error(`expected <prefix:localName> or <localName>, got ${name}`);
  const [prefix, localName] = parts.length === 1 ? [defaultPrefix, name] : parts;
  return { name: `${prefix ? `${prefix}:` : ''}${localName}`, prefix: prefix ?? '', localName };
}

export class Metamodel {
  private readonly packagesByKey = new Map<string, PackageDef>();
  private readonly packageList: PackageDef[] = [];
  private readonly typeMap = new Map<string, TypeDef>();
  private readonly descriptors = new Map<string, Descriptor>();

  constructor(packages: Iterable<PackageDef>) {
    for (const pkg of packages) this.register(pkg);
  }

  get packages(): readonly PackageDef[] {
    return this.packageList;
  }

  package(prefixOrUri: string): PackageDef | undefined {
    return this.packagesByKey.get(prefixOrUri);
  }

  /** Every type the packages define. */
  types(): TypeDef[] {
    return [...this.typeMap.values()];
  }

  /** The type `name` names, as its package defines it; undefined for one no package defines. */
  type(name: string): TypeDef | undefined {
    return this.typeMap.get(name);
  }

  has(name: string): boolean {
    return this.typeMap.has(name);
  }

  /** What an element of type `name` holds; throws for a type no package defines. */
  descriptor(name: string): Descriptor {
    const known = this.descriptors.get(name);
    if (known) return known;
    const ns = parseName(name);
    const builder = new DescriptorBuilder(ns);
    this.mapTypes(ns, (type, inherited) => builder.addTrait(type, inherited));
    const descriptor = builder.build();
    this.descriptors.set(name, descriptor);
    return descriptor;
  }

  /** Whether a `type` element is an `ancestor`: it, a super type of it, or a trait that extends one. */
  isA(type: string, ancestor: string): boolean {
    return this.has(type) && ancestor in this.descriptor(type).allTypesByName;
  }

  /** The property `name` (a name or a local name) of a `type` element. */
  property(type: string, name: string): PropertyDef | undefined {
    return this.has(type) ? this.descriptor(type).propertiesByName[name] : undefined;
  }

  private register(definition: PackageDef): void {
    const pkg = { ...definition };
    for (const key of ['prefix', 'uri'] as const) {
      if (this.packagesByKey.has(pkg[key])) throw new Error(`package with ${key} <${pkg[key]}> already defined`);
    }
    for (const type of pkg.types ?? []) this.registerType(type, pkg);
    this.packagesByKey.set(pkg.uri, pkg);
    this.packagesByKey.set(pkg.prefix, pkg);
    this.packageList.push(pkg);
  }

  private registerType(definition: Record<string, unknown>, pkg: PackageDef): void {
    const ns = parseName(String(definition.name), pkg.prefix);
    const properties = ((definition.properties as Record<string, unknown>[] | undefined) ?? []).map((raw): PropertyDef => {
      const propertyNs = parseName(String(raw.name), ns.prefix);
      const type = String(raw.type);
      return { ...raw, type: BUILTIN_TYPES.has(type) ? type : parseName(type, propertyNs.prefix).name, ns: propertyNs, name: propertyNs.name } as PropertyDef;
    });
    const type: TypeDef = {
      ...definition,
      superClass: [...((definition.superClass as string[] | undefined) ?? [])],
      extends: [...((definition.extends as string[] | undefined) ?? [])],
      properties,
      propertiesByName: Object.fromEntries(properties.map((p) => [p.name, p])),
      meta: { ...((definition.meta as Record<string, unknown> | undefined) ?? {}) },
      ns,
      name: ns.name,
      pkg,
    };
    for (const extended of type.extends) {
      const target = this.typeMap.get(parseName(extended, ns.prefix).name);
      if (!target) throw new Error(`<${type.name}> extends <${extended}>, which no package defines`);
      (target.traits ??= []).push(type.name);
    }
    this.typeMap.set(type.name, type);
  }

  /** The type hierarchy of `ns`, bottom to top as moddle walks it: super types, the type itself, then its traits. */
  private mapTypes(ns: Ns, iterator: (type: TypeDef, inherited: boolean) => void, trait = false): void {
    // A built-in a type extends (a `String` subtype) is a type it is too, one that holds nothing.
    const type = BUILTIN_TYPES.has(ns.name) ? builtin(ns.name) : this.typeMap.get(ns.name);
    if (!type) throw new Error(`unknown type <${ns.name}>`);
    const traverse = (name: string, asTrait: boolean): void => {
      this.mapTypes(parseName(name, BUILTIN_TYPES.has(name) ? '' : ns.prefix), iterator, asTrait);
    };
    for (const name of type.superClass) traverse(name, trait);
    iterator(type, !trait);
    for (const name of type.traits ?? []) traverse(name, true);
  }
}

const BUILTIN_PACKAGE: PackageDef = { prefix: '', uri: '' };

function builtin(name: string): TypeDef {
  return { name, ns: parseName(name), superClass: [], extends: [], properties: [], propertiesByName: {}, meta: {}, pkg: BUILTIN_PACKAGE };
}

/** One type's descriptor, assembled as moddle's `DescriptorBuilder` does. */
class DescriptorBuilder {
  private readonly ns: Ns;
  private readonly allTypes: TypeDef[] = [];
  private readonly allTypesByName: Record<string, TypeDef> = Object.create(null);
  private readonly properties: PropertyDef[] = [];
  private readonly propertiesByName: Record<string, PropertyDef> = Object.create(null);
  private bodyProperty?: PropertyDef;
  private idProperty?: PropertyDef;

  constructor(ns: Ns) {
    this.ns = ns;
  }

  build(): Descriptor {
    return {
      ns: this.ns,
      name: this.ns.name,
      allTypes: this.allTypes,
      allTypesByName: this.allTypesByName,
      properties: this.properties,
      propertiesByName: this.propertiesByName,
      ...(this.bodyProperty ? { bodyProperty: this.bodyProperty } : {}),
      ...(this.idProperty ? { idProperty: this.idProperty } : {}),
      pkg: this.allTypes[this.allTypes.length - 1]?.pkg,
    };
  }

  addTrait(type: TypeDef, inherited: boolean): void {
    if (inherited && type.extends.length > 0) throw new Error(`cannot create <${type.name}> extending <${type.extends}>`);
    if (type.name in this.allTypesByName) return;
    for (const declared of type.properties) {
      const p: PropertyDef = { ...declared, name: declared.ns.localName, inherited };
      Object.defineProperty(p, 'definedBy', { value: type });
      const { replaces, redefines } = p;
      if (replaces || redefines) {
        this.redefineProperty(p, (replaces ?? redefines)!, !!replaces);
      } else {
        if (p.isBody) this.setBodyProperty(p, true);
        if (p.isId) this.setIdProperty(p, true);
        this.addProperty(p, undefined, true);
      }
    }
    this.allTypes.push(type);
    this.allTypesByName[type.name] = type;
  }

  private addProperty(p: PropertyDef, index: number | undefined, validate: boolean): void {
    this.addNamedProperty(p, validate);
    if (index === undefined) this.properties.push(p);
    else this.properties.splice(index, 0, p);
  }

  private addNamedProperty(p: PropertyDef, validate: boolean): void {
    if (validate) {
      const defined = this.propertiesByName[p.name];
      if (defined) throw new Error(`property <${p.name}> already defined; override of <${defined.definedBy?.ns.name}#${defined.ns.name}> by <${p.definedBy?.ns.name}#${p.ns.name}> not allowed without redefines`);
    }
    this.propertiesByName[p.ns.name] = p;
    this.propertiesByName[p.ns.localName] = p;
  }

  private redefineProperty(p: PropertyDef, target: string, replace: boolean): void {
    const [typeName, attribute] = target.split('#');
    const name = parseName(typeName, p.ns.prefix);
    const attrName = parseName(attribute, name.prefix).name;
    const redefined = this.propertiesByName[attrName];
    if (!redefined) throw new Error(`refined property <${attrName}> not found`);
    this.replaceProperty(redefined, p, replace);
    delete p.redefines;
  }

  private replaceProperty(old: PropertyDef, next: PropertyDef, replace: boolean): void {
    if (old.isId) {
      if (!next.isId) throw new Error(`property <${next.ns.name}> must be id property to refine <${old.ns.name}>`);
      this.setIdProperty(next, false);
    }
    if (old.isBody) {
      if (!next.isBody) throw new Error(`property <${next.ns.name}> must be body property to refine <${old.ns.name}>`);
      this.setBodyProperty(next, false);
    }
    const index = this.properties.indexOf(old);
    if (index === -1) throw new Error(`property <${old.ns.name}> not found in property list`);
    this.properties.splice(index, 1);
    this.addProperty(next, replace ? undefined : index, old.name !== next.name);
    this.propertiesByName[old.ns.name] = next;
    this.propertiesByName[old.ns.localName] = next;
  }

  private setBodyProperty(p: PropertyDef, validate: boolean): void {
    if (validate && this.bodyProperty) throw new Error(`body property defined multiple times (<${this.bodyProperty.ns.name}>, <${p.ns.name}>)`);
    this.bodyProperty = p;
  }

  private setIdProperty(p: PropertyDef, validate: boolean): void {
    if (validate && this.idProperty) throw new Error(`id property defined multiple times (<${this.idProperty.ns.name}>, <${p.ns.name}>)`);
    this.idProperty = p;
  }
}
