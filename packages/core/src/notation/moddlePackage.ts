/**
 * A skill's schema: a moddle package written in YAML (`<name>.moddle.yaml`), with the app's own keys beside
 * moddle's. `fromModdleYaml` reads one, the catalog compiles it (`compile.ts`), and `toModdlePackages` hands
 * it to `BpmnModdle`.
 */
import * as yaml from 'js-yaml';

export type SchemaPropertyModel = {
  name: string;
  type?: string;
  description?: string;
  isAttr?: boolean;
  isMany?: boolean;
  isBody?: boolean;
  default?: unknown;
  /** Must spell `Type#property`; anything else silently declares a brand-new attribute. */
  redefines?: string;
  replaces?: string;
  xml?: { serialize?: string };
  meta?: Record<string, any>;
};

export type SchemaTypeModel = {
  name: string;
  description?: string;
  isAbstract?: boolean;
  /** Inheritance refs: a type with any is an element of its own (wrapper style, see `TypeStyle`), a trait has none. */
  superClass?: string[];
  /** Trait refs: with no `superClass`, the attributes mix onto the referenced BPMN type and its subtypes. */
  extends?: string[];
  meta?: Record<string, any>;
  properties?: SchemaPropertyModel[];
};

export type SchemaEnumLiteralModel = {
  name: string;
  value: unknown;
  icon?: string;
  description?: string;
};

export type SchemaEnumModel = {
  /** Absent when the entry only extends another schema's enum. */
  name?: string;
  description?: string;
  /** Qualified name of an enum, in any schema, that these literals are added to (`studyflow:ActorTypeEnum`). */
  extends?: string;
  literalValues?: SchemaEnumLiteralModel[];
};

/** A palette entry: elements a drop adds, spelled as in a `.studyflow.yaml` file. */
export type SchemaTemplateModel = {
  description?: string;
  /** Id-keyed, like a file's top level. The first is the element dropped; a pool's `processRef` names the process holding its flow. */
  elements?: Record<string, any>;
};

export type SchemaModel = {
  prefix: string;
  name: string;
  uri: string;
  version?: string | number;
  description?: string;
  icon?: string;
  /** `required: true` in the file: the schema always loads, and the modeler's settings cannot switch it off. */
  required?: boolean;
  order?: number;
  categories?: SchemaCategoryModel[];
  xml?: { tagAlias?: string };
  types: SchemaTypeModel[];
  enumerations: SchemaEnumModel[];
  /** Palette flyout entries: presets and design patterns dropped onto the canvas. */
  templates?: SchemaTemplateModel[];
};

export type SchemaCategoryModel = {
  /** Matched by string against a property's `meta.categories`. */
  name: string;
  order?: number;
  description?: string;
  /** Rendered by a dedicated inspector section, so the tab shows even with no attributes. */
  synthetic?: boolean;
};

/** A schema file read as it is written; a file that is no package at all (no `name`, `prefix` or `uri`) is refused. */
export function fromModdleYaml(yamlText: string, sourceName?: string): SchemaModel {
  const where = sourceName ? ` (${sourceName})` : '';
  const parsed: any = yaml.load(yamlText);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Schema YAML did not parse to an object${where}.`);
  }
  if (typeof parsed.name !== 'string' || typeof parsed.prefix !== 'string' || typeof parsed.uri !== 'string') {
    throw new Error(`Schema YAML must declare \`name\`, \`prefix\` and \`uri\`${where}.`);
  }

  return {
    ...parsed,
    types: parsed.types ?? [],
    enumerations: parsed.enumerations ?? [],
  } as SchemaModel;
}

/** Property `type:` refs to these stay unqualified; everything else gets a schema prefix. */
export const MODDLE_BUILTIN_TYPES: ReadonlySet<string> = new Set([
  'String', 'Boolean', 'Integer', 'Real', 'Element',
]);

const MODDLE_SIMPLE_TYPES: ReadonlySet<string> = new Set([
  'String', 'Boolean', 'Integer', 'Real',
]);

export function isValueType(type: SchemaTypeModel): boolean {
  return (type.superClass ?? []).some((ref) => MODDLE_SIMPLE_TYPES.has(ref));
}

/** Value types and enumerations: moddle-xml inlines a non-attribute (list) value only for its built-in simple types, so both ride as `String`. */
function collectValueTypes(models: SchemaModel[]): Set<string> {
  const valueTypes = new Set<string>();
  for (const model of models) {
    for (const type of model.types) {
      if (isValueType(type)) valueTypes.add(`${model.prefix}:${type.name}`);
    }
    for (const enumeration of model.enumerations) if (enumeration.name) valueTypes.add(`${model.prefix}:${enumeration.name}`);
  }
  return valueTypes;
}

export function toModdlePackages(model: SchemaModel, allModels: SchemaModel[] = [model]): any {
  const valueTypes = collectValueTypes(allModels);
  const pkg: any = structuredClone(model);

  for (const type of pkg.types ?? []) {
    const isValueType = valueTypes.has(`${pkg.prefix}:${type.name}`);

    if (!isValueType && Array.isArray(type.superClass) && type.superClass.length > 0
        && !type.superClass.includes('Element')) {
      type.superClass.push('Element');
    }

    for (const property of type.properties ?? []) {
      if (property.isAttr || !property.type) continue;
      const qualified = property.type.includes(':') ? property.type : `${pkg.prefix}:${property.type}`;
      if (!valueTypes.has(qualified)) continue;
      // Flattening the wire type to `String` is what makes moddle escape the body; `valueType` keeps the authored type so the YAML shorthand still recognizes it.
      property.valueType = qualified;
      property.type = 'String';
    }
  }

  return pkg;
}
