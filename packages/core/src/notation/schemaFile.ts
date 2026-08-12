import * as yaml from 'js-yaml';

export type SchemaPropertyModel = {
  name: string;
  type?: string;
  description?: string;
  isAttr?: boolean;
  isMany?: boolean;
  isId?: boolean;
  isBody?: boolean;
  default?: unknown;
  /** Must spell `Type#property`; anything else silently declares a brand-new attribute. */
  redefines?: string;
  replaces?: string;
  meta?: Record<string, any>;
};

export type SchemaTypeModel = {
  name: string;
  description?: string;
  icon?: string;
  isAbstract?: boolean;
  /** Inheritance refs; declaring one makes the type instantiable (wrapper style, see `TypeStyle`). */
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
  name: string;
  description?: string;
  literalValues?: SchemaEnumLiteralModel[];
};

export type SchemaTemplateModel = {
  description?: string;
  object?: Record<string, any>;
};

export type SchemaModel = {
  prefix: string;
  name: string;
  uri: string;
  version?: string | number;
  description?: string;
  icon?: string;
  /** Core schemas back the default elements and are always loaded. */
  core?: boolean;
  order?: number;
  categories?: SchemaCategoryModel[];
  xml?: { tagAlias?: string };
  types: SchemaTypeModel[];
  enumerations: SchemaEnumModel[];
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

export function fromModdleYaml(yamlText: string, sourceName?: string): SchemaModel {
  const where = sourceName ? ` (${sourceName})` : '';
  const parsed: any = yaml.load(yamlText);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Schema YAML did not parse to an object${where}.`);
  }
  if (typeof parsed.prefix !== 'string' || typeof parsed.name !== 'string') {
    throw new Error(`Schema YAML must declare \`name\` and \`prefix\`${where}.`);
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

export const MODDLE_SIMPLE_TYPES: ReadonlySet<string> = new Set([
  'String', 'Boolean', 'Integer', 'Real',
]);

export function isValueType(type: SchemaTypeModel): boolean {
  return (type.superClass ?? []).some((ref) => MODDLE_SIMPLE_TYPES.has(ref));
}

function collectValueTypes(models: SchemaModel[]): Set<string> {
  const valueTypes = new Set<string>();
  for (const model of models) {
    for (const type of model.types) {
      if (isValueType(type)) valueTypes.add(`${model.prefix}:${type.name}`);
    }
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
