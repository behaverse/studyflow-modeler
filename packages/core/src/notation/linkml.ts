/**
 * The schema language: a skill's vocabulary is a LinkML schema (`<name>.linkml.yaml`), read here into
 * the moddle package descriptor the rest of the notation compiles (`moddlePackage.ts`). Only the LinkML
 * keys below are read; `skills/SCHEMAS.md` is the author's reference for the same mapping.
 *
 * Where LinkML has the same idea, it is used as LinkML spells it (`is_a`, `mixin`, `multivalued`,
 * `ifabsent`, `rank`, `in_subset`, `subsets`, `permissible_values`, `apply_to`, `implements`). What
 * belongs to BPMN or to the modeler alone rides in `annotations` (`redefines`, `replaces`, `element`,
 * `body`, `icon`, `roles`, `editor`, …) and lands in the type's or attribute's `meta`.
 */
import * as yaml from 'js-yaml';
import { splitQName } from '@core/naming';
import type {
  SchemaCategoryModel,
  SchemaEnumModel,
  SchemaModel,
  SchemaPropertyModel,
  SchemaTypeModel,
} from '@core/notation/moddlePackage';

type Annotations = Record<string, any>;

export type LinkmlSlot = {
  description?: string;
  /** Omitted when `implements` names the BPMN element the value rides in. */
  range?: string;
  multivalued?: boolean;
  /** Default value, LinkML-spelled: `string(csv)`, `int(3)`, `float(0.5)`, `true`. */
  ifabsent?: string;
  /** Sort order within the inspector tab. */
  rank?: number;
  /** The inspector tab (a `subsets` entry of this or another schema). */
  in_subset?: string[];
  /** Keeps a BPMN attribute in the BPMN namespace (`bpmn:documentation`). */
  slot_uri?: string;
  /** BPMN element the value is written as (`bpmn:Expression`); the value itself stays a flat string. */
  implements?: string[];
  annotations?: Annotations;
};

export type LinkmlClass = {
  description?: string;
  abstract?: boolean;
  /** A trait: its attributes mix onto every BPMN type it `implements`, instead of being an element. */
  mixin?: boolean;
  is_a?: string;
  /** The BPMN element this type is created as, or (on a mixin) every type it mixes onto. */
  implements?: string[];
  annotations?: Annotations;
  attributes?: Record<string, LinkmlSlot>;
};

/** A value type: text with an editor, or a narrowed primitive. */
export type LinkmlType = { typeof?: string; description?: string; annotations?: Annotations };

export type LinkmlEnum = {
  description?: string;
  /** Adds these literals to an enum of another schema instead of declaring one. */
  apply_to?: string[];
  permissible_values?: Record<string, { title?: string; description?: string; annotations?: Annotations } | null>;
  annotations?: Annotations;
};

export type LinkmlSchema = {
  /** The schema's URI, which is also the XML namespace of its elements. */
  id: string;
  /** The prefix its elements are named under (`studyflow:Study`). */
  name: string;
  /** The name the app shows. */
  title?: string;
  description?: string;
  version?: string;
  /** Load and display order among schemas. */
  rank?: number;
  /** Inspector tabs, declared by the core schema; an attribute joins one with `in_subset`. */
  subsets?: Record<string, { description?: string; rank?: number; annotations?: Annotations }>;
  classes?: Record<string, LinkmlClass>;
  types?: Record<string, LinkmlType>;
  enums?: Record<string, LinkmlEnum>;
  /** `icon`, `optional`, and `templates` (the palette flyout entries, a list in the expanded form). */
  annotations?: Annotations;
};

/** LinkML's built-in types, as moddle spells them. */
const MODDLE_TYPE: Record<string, string> = {
  string: 'String',
  boolean: 'Boolean',
  integer: 'Integer',
  float: 'Real',
  double: 'Real',
};

export function parseLinkml(yamlText: string, sourceName?: string): LinkmlSchema {
  const where = sourceName ? ` (${sourceName})` : '';
  const parsed: any = yaml.load(yamlText);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Schema YAML did not parse to an object${where}.`);
  }
  if (typeof parsed.name !== 'string' || typeof parsed.id !== 'string') {
    throw new Error(`A LinkML schema must declare \`name\` and \`id\`${where}.`);
  }
  return parsed as LinkmlSchema;
}

/** Every schema at once, returned in the order given. A name declared by another schema resolves to it, as
 * LinkML resolves an import; `imports` itself is not read, because no two schemas declare the same name
 * (`tests/schemas.unit.spec.ts`), so one table of every schema's names answers the same way. */
export function fromLinkml(docs: LinkmlSchema[]): SchemaModel[] {
  const owner = new Map<string, string>();
  for (const doc of docs) {
    for (const name of elementNames(doc)) if (!owner.has(name)) owner.set(name, doc.name);
  }
  return docs.map((doc) => toSchemaModel(doc, owner));
}

function elementNames(doc: LinkmlSchema): string[] {
  return [...Object.keys(doc.classes ?? {}), ...Object.keys(doc.types ?? {}), ...Object.keys(doc.enums ?? {})];
}

function toSchemaModel(doc: LinkmlSchema, owner: Map<string, string>): SchemaModel {
  const prefix = doc.name;
  const own = new Set(elementNames(doc));
  /** A ref as moddle needs it: bare for the file's own names, qualified for another schema's. A name no
   * loaded schema declares is left bare, for the catalog to resolve or report. */
  const qualify = (ref: string): string => {
    if (ref.includes(':') || own.has(ref)) return ref;
    const from = owner.get(ref);
    return from ? `${from}:${ref}` : ref;
  };

  const annotations = annotationValues(doc.annotations);

  return {
    prefix,
    name: doc.title ?? prefix,
    uri: doc.id,
    version: doc.version,
    description: doc.description,
    icon: typeof annotations.icon === 'string' ? annotations.icon : undefined,
    // A schema is optional unless it says otherwise; `optional: false` makes it core, always loaded.
    core: annotations.optional === false,
    order: doc.rank,
    categories: toCategories(doc.subsets),
    // Every studyflow element is tagged in lowerCamelCase; no schema differs, so it is not authored.
    xml: { tagAlias: 'lowerCase' },
    types: [
      ...Object.entries(doc.types ?? {}).map(([name, type]) => toValueType(name, type)),
      ...Object.entries(doc.classes ?? {}).map(([name, cls]) => toType(name, cls, prefix, qualify)),
    ],
    enumerations: Object.entries(doc.enums ?? {}).map(([name, entry]) => toEnum(name, entry, qualify)),
    templates: Array.isArray(annotations.templates) ? annotations.templates : undefined,
  };
}

function toCategories(subsets: LinkmlSchema['subsets']): SchemaCategoryModel[] | undefined {
  if (!subsets) return undefined;
  return Object.entries(subsets).map(([name, subset]) => ({
    name,
    order: subset?.rank,
    description: subset?.description,
    synthetic: annotationValues(subset?.annotations).synthetic === true,
  }));
}

function toValueType(name: string, type: LinkmlType): SchemaTypeModel {
  return {
    name,
    description: type.description,
    superClass: [MODDLE_TYPE[type.typeof ?? 'string'] ?? 'String'],
    meta: toMeta(type.annotations),
  };
}

function toType(name: string, cls: LinkmlClass, prefix: string, qualify: (ref: string) => string): SchemaTypeModel {
  const bpmn = cls.implements ?? [];
  const type: SchemaTypeModel = {
    name,
    description: cls.description,
    isAbstract: cls.abstract === true || cls.mixin === true,
    meta: toMeta(cls.annotations),
    properties: Object.entries(cls.attributes ?? {}).map(([slot, spec]) => toProperty(slot, spec, prefix, qualify)),
  };

  if (cls.mixin) {
    // A trait attaches to BPMN types; it is never created, so it has no super class of its own.
    type.extends = bpmn;
  } else {
    const parents = [...(cls.is_a ? [qualify(cls.is_a)] : []), ...bpmn];
    // `Element` is moddle's own root: what a type with no parent of its own inherits from.
    type.superClass = parents.length > 0 ? parents : ['Element'];
  }
  return type;
}

function toProperty(slot: string, spec: LinkmlSlot, prefix: string, qualify: (ref: string) => string): SchemaPropertyModel {
  // A BPMN element the value is written as (an expression, a documentation entry) instead of a plain value.
  const wire = spec.implements?.[0];
  const { redefines, replaces, element, body, ...meta } = annotationValues(spec.annotations);
  if (spec.rank !== undefined) meta.order = spec.rank;
  if (spec.in_subset?.length) meta.categories = spec.in_subset;
  // The inspector edits a BPMN expression as a flat string with a language picker.
  if (wire === 'bpmn:Expression') meta.expression = true;

  const property: SchemaPropertyModel = {
    name: moddleName(slot, spec.slot_uri, prefix),
    description: spec.description,
    type: wire ?? moddleType(spec.range, qualify),
    // An XML attribute holds one scalar; everything else is a child element.
    isAttr: !wire && spec.multivalued !== true && element !== true,
    isMany: spec.multivalued === true,
    isBody: body === true,
    default: fromIfabsent(spec.ifabsent),
    redefines: typeof redefines === 'string' ? redefines : undefined,
    replaces: typeof replaces === 'string' ? replaces : undefined,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
  };

  // BPMN writes an expression's own type on the element (`xsi:type="tFormalExpression"`).
  if (wire === 'bpmn:Expression') property.xml = { serialize: 'xsi:type' };

  return property;
}

/** A slot whose URI is another vocabulary's keeps that name on the wire (`bpmn:documentation`). */
function moddleName(slot: string, slotUri: string | undefined, prefix: string): string {
  const uriPrefix = splitQName(slotUri).prefix;
  return uriPrefix && uriPrefix !== prefix ? slotUri! : slot;
}

function moddleType(range: string | undefined, qualify: (ref: string) => string): string {
  if (!range) return 'String';
  return MODDLE_TYPE[range] ?? qualify(range);
}

/** LinkML's spelling of a default: `string(csv)`, `int(3)`, `float(0.5)`, `true`. */
function fromIfabsent(spec: string | undefined): unknown {
  if (spec === undefined) return undefined;
  if (spec === 'true' || spec === 'false') return spec === 'true';
  const match = /^(string|int|integer|float|double)\((.*)\)$/.exec(spec);
  if (!match) return spec;
  return match[1] === 'string' ? match[2] : Number(match[2]);
}

/** An annotation's value: a scalar, or any YAML in LinkML's expanded form (`roles: {value: [signal]}`). */
function annotationValues(annotations: Annotations | undefined): Annotations {
  return Object.fromEntries(Object.entries(annotations ?? {}).map(([tag, value]) => [
    tag,
    value && typeof value === 'object' && 'value' in value ? value.value : value,
  ]));
}

function toMeta(annotations: Annotations | undefined): Annotations | undefined {
  const meta = annotationValues(annotations);
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function toEnum(name: string, entry: LinkmlEnum, qualify: (ref: string) => string): SchemaEnumModel {
  const literalValues = Object.entries(entry.permissible_values ?? {}).map(([value, literal]) => ({
    name: literal?.title ?? value,
    value,
    description: literal?.description,
    icon: annotationValues(literal?.annotations).icon,
  }));
  const extended = entry.apply_to?.[0];
  return extended
    ? { extends: qualify(extended), description: entry.description, literalValues }
    : { name, description: entry.description, literalValues };
}
