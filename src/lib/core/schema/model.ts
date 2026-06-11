/**
 * Schema intermediate representation (IR).
 *
 * `SchemaModel` is the format-neutral contract between schema *front-ends*
 * (moddle YAML today, LinkML via `fromLinkml`) and the two consumers:
 *
 *   - `buildCatalog(models)` — compiles the app-wide type catalog
 *   - `toModdlePackages(model)` — generates the package format the
 *     bpmn-moddle XML codec needs (moddle is an output here, not a source)
 *
 * The shape is deliberately isomorphic to the moddle YAML files (types,
 * properties, superClass/extends, enumerations, templates) because that
 * structure is generic — but the contract is defined here, by us, and any
 * front-end that produces it plugs into the whole app.
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
