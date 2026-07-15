import * as yaml from 'js-yaml';

/**
 * The `*.moddle.yaml` schema files: parsed shape (`SchemaModel`) and its two
 * consumers:
 *
 *   - `buildCatalog(models)` — compiles the app-wide type catalog
 *   - `toModdlePackages(model)` — generates the packages bpmn-moddle needs
 *     to read and write the XML
 */

export type SchemaPropertyModel = {
  name: string;
  /** `String`/`Boolean`/`Integer`/`Real`/`Element`, or a (qualified) schema type/enum ref. */
  type?: string;
  description?: string;
  isAttr?: boolean;
  isMany?: boolean;
  isId?: boolean;
  /** Serialized as the element's text body instead of an attribute. */
  isBody?: boolean;
  default?: unknown;
  /** `Type#property` ref this property overrides. */
  redefines?: string;
  replaces?: string;
  /** Modeler metadata: categories, pinned, order, condition, editable, optional, … */
  meta?: Record<string, any>;
};

export type SchemaTypeModel = {
  name: string;
  description?: string;
  icon?: string;
  isAbstract?: boolean;
  /** Inheritance refs; a type with `superClass` is instantiable (wrapper style). */
  superClass?: string[];
  /** Trait refs: attributes are mixed onto the referenced BPMN type and its subtypes. */
  extends?: string[];
  /** Modeler metadata: bpmnType, icon, categories, flowElements, templateScopedType, connectsTo, … */
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
  isAbstract?: boolean;
  literalValues?: SchemaEnumLiteralModel[];
};

export type SchemaTemplateModel = {
  description?: string;
  /** Template definition: `type`, attribute values, optional `flowElements`. */
  object?: Record<string, any>;
};

export type SchemaModel = {
  prefix: string;
  name: string;
  uri: string;
  version?: string | number;
  description?: string;
  icon?: string;
  xml?: { tagAlias?: string };
  associations?: unknown[];
  types: SchemaTypeModel[];
  enumerations: SchemaEnumModel[];
  templates?: SchemaTemplateModel[];
};

/**
 * Parses a `*.moddle.yaml` schema into a `SchemaModel`.
 *
 * The authored YAML shape is isomorphic to `SchemaModel`, so this is parse +
 * sanity checks. Unknown keys ride along untouched — `toModdlePackages` must
 * reproduce the file's intent byte-for-byte in the generated XML packages.
 */
export function fromModdleYaml(yamlText: string): SchemaModel {
  const parsed: any = yaml.load(yamlText);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Schema YAML did not parse to an object.');
  }
  if (typeof parsed.prefix !== 'string' || typeof parsed.name !== 'string') {
    throw new Error('Schema YAML must declare `name` and `prefix`.');
  }

  return {
    ...parsed,
    types: parsed.types ?? [],
    enumerations: parsed.enumerations ?? [],
  } as SchemaModel;
}

// ---------------------------------------------------------------------------
// moddle package generation
// ---------------------------------------------------------------------------

const VALUE_TYPE_SUPER_CLASSES = new Set(['String', 'Boolean', 'Integer', 'Float', 'Double']);

/** Qualified names of value types (String subtypes etc.) across all models. */
function collectValueTypes(models: SchemaModel[]): Set<string> {
  const valueTypes = new Set<string>();
  for (const model of models) {
    for (const type of model.types ?? []) {
      if ((type.superClass ?? []).some((sc) => VALUE_TYPE_SUPER_CLASSES.has(sc))) {
        valueTypes.add(`${model.prefix}:${type.name}`);
      }
    }
  }
  return valueTypes;
}

/**
 * Generates the package object bpmn-moddle consumes to read and write the
 * XML (`moddleExtensions` in bpmn-js, `new BpmnModdle(...)` in the runner's
 * parser).
 *
 * This is the ONLY place that knows moddle's package conventions:
 *
 * - Wrapper types get `Element` appended to `superClass` so instances can
 *   live inside `<bpmn:extensionElements>`. Value types (String subtypes
 *   such as `MarkdownString`) must NOT get it — it breaks nothing today but
 *   they are not elements.
 * - Non-attribute properties typed with a value type are rewritten to plain
 *   `String` on the wire. moddle only stores element text content for the
 *   built-in `String`, so e.g. `isMany` MarkdownString lists
 *   (`inclusionCriteria`, `strata`) silently lost their
 *   text on every load before this rewrite. The catalog keeps the authored
 *   type as the UI hint (markdown editor, YAML editor). The same goes for
 *   text bodies (`isBody`): moddle's `BodySerializer` XML-escapes a body only
 *   when the property's declared type is exactly `String` (not a
 *   `YAMLString`/`MarkdownString` subtype), so a config body carrying `<`/`&`
 *   — routine in stimuli — was written raw, producing invalid XML. The
 *   authored value-type is preserved in `valueType` so the `.studyflow` YAML
 *   codec's inline-folding can still tell a YAML value (config bodies, `with`
 *   arguments) from a markdown one.
 *
 * The result is a fresh object per call: moddle mutates registered packages
 * in place (qualifying property names), so generated packages must never be
 * shared with the catalog or reused across moddle instances.
 */
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
      // The (qualified) authored value-type survives in `valueType` so the
      // YAML codec's inline-folding can still recognize a YAML body or value
      // after the wire type is flattened to `String` (which is what makes
      // moddle escape it).
      property.valueType = qualified;
      property.type = 'String';
    }
  }

  return pkg;
}
