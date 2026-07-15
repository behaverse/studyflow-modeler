/**
 * Plain-data view of the `*.moddle.yaml` schemas, compiled once at schema-load
 * time (see `compile.ts`).
 *
 * The catalog replaces runtime moddle reflection (registry walking, descriptor
 * probing) everywhere in the app: the modeler, the inspector, the palette,
 * templates, and the runner all read the same compiled metadata. moddle's only
 * remaining job is reading and writing the BPMN XML inside bpmn-js.
 */

export type NsInfo = {
  /** Qualified name, e.g. `cognitive:instrument`. */
  name: string;
  prefix: string;
  localName: string;
};

/**
 * Typed view of an attribute's `meta:` block from the schema YAML. Authors may
 * add arbitrary keys (the index signature keeps that valid), but the ones the
 * inspector reads are named so consumers stop reaching into `any`.
 */
export interface AttributeMeta {
  /** Named editor override, resolved against the inspector's editor registry. */
  editor?: string;
  /** Visibility predicate: the attribute shows only when every entry matches. */
  condition?: { body?: Record<string, unknown> };
  /** Inspector category tabs this attribute appears under. */
  categories?: string[];
  /** Sort order within a category (lower first). */
  order?: number;
  /** Pinned attributes carry a fixed value and never render. */
  pinned?: boolean;
  /** String attribute rendered with the optional-string editor. */
  optional?: boolean;
  /** Enum attribute that also accepts a free-form custom value. */
  editable?: boolean;
  icon?: string;
  [key: string]: unknown;
}

/**
 * Typed view of a type's `meta:` block. Free-form keys stay valid via the
 * index signature; the named keys are those the app reads.
 */
export interface TypeMeta {
  /** BPMN element type this schema type attaches to / is created as. */
  bpmnType?: string;
  /** Allow-list of connection targets; see `connectionVerdict`. */
  connectsTo?: string[];
  /** Gateway branch selection, e.g. `random`. */
  branching?: string;
  /** Materialized sub-flow for template types (raw node/connection descriptors). */
  flowElements?: Record<string, any>[];
  glob?: string;
  core?: boolean;
  templateScopedType?: string;
  icon?: string;
  [key: string]: unknown;
}

export type EnumLiteral = {
  name: string;
  value: unknown;
  icon?: string;
  description?: string;
};

export type EnumEntry = {
  /** Qualified name, e.g. `cognitive:InstrumentEnum`. */
  name: string;
  ns: NsInfo;
  description?: string;
  literals: EnumLiteral[];
};

/**
 * Attribute definition. Field names mirror moddle property descriptors
 * (`name` is the local name, `ns.name` the qualified one) so consumers that
 * used to receive moddle descriptors keep working unchanged.
 */
export type AttributeSpec = {
  /** Local name, e.g. `instrument`. */
  name: string;
  ns: NsInfo;
  /**
   * Declared type; qualified when it refers to a schema type (e.g.
   * `cognitive:InstrumentEnum`), bare for primitives (`String`, `Boolean`).
   */
  type: string;
  isAttr?: boolean;
  isMany?: boolean;
  isId?: boolean;
  isBody?: boolean;
  default?: unknown;
  description?: string;
  redefines?: string;
  replaces?: string;
  meta?: AttributeMeta;

  // Compiled lookups; everything below used to require moddle reflection.
  /** Local name of the inherited property this one redefines/replaces. */
  redefinedName?: string;
  /** When `type` is a body-wrapper element type: its body property name. */
  bodyProp?: string;
  /** Declared type of that body property (e.g. `studyflow:YAMLString`). */
  bodyType?: string;
  /** True when `type` refers to a schema enumeration. */
  isEnum?: boolean;
};

/**
 * `wrapper`: concrete type instantiated inside `<bpmn:extensionElements>`.
 * `trait`: `extends:`-style type whose attributes are mixed onto matching BPMN
 * business objects (applied to the target type and all of its subtypes).
 */
export type TypeStyle = 'wrapper' | 'trait';

export type TypeEntry = {
  /** Qualified name, e.g. `cognitive:CognitiveTask`. */
  name: string;
  ns: NsInfo;
  description?: string;
  /** Top-level `icon:` from the YAML (templates fall back to it). */
  icon?: string;
  isAbstract: boolean;
  style: TypeStyle;
  /** Trait refs: attributes mix onto these BPMN types and their subtypes. */
  extends: string[];
  meta: TypeMeta;
  /**
   * BPMN element type created on the canvas for this type; null when the type
   * is not canvas-creatable (value/helper types such as body wrappers).
   */
  bpmnType: string | null;
  /**
   * Effective attributes: own plus inherited from custom super types, with
   * `redefines`/`replaces` applied. Does not include BPMN-native properties.
   */
  attributes: AttributeSpec[];
  /** Default values across the inheritance chain, keyed by local name. */
  defaults: Record<string, unknown>;
  hiddenFromPalette: boolean;
  paletteLabel: string;
  paletteCategories: string[];
};

export type SchemaEntry = {
  prefix: string;
  name: string;
  description?: string;
  icon?: string;
  /** Core schemas back the default elements and are always loaded. */
  core: boolean;
  types: TypeEntry[];
  enums: EnumEntry[];
  templates: Template[];
};

// ---------------------------------------------------------------------------
// Element templates (bpmn-js-create-append-anything contract + studyflow
// extras). Compiled from each schema's `templates:` section and from types
// declaring `meta.flowElements`.
// ---------------------------------------------------------------------------

export interface TemplateFlowNode {
  id: string;
  kind: 'node';
  extensionType?: string;
  bpmnType: string;
  iconClass?: string;
  overrideIconClass?: string;
  templateAttributes?: Record<string, any>;
  x?: number;
  y?: number;
}

export interface TemplateFlowConnection {
  id?: string;
  kind: 'connection';
  bpmnType: string;
  sourceRef: string;
  targetRef: string;
  templateAttributes?: Record<string, any>;
}

export type TemplateFlowElement = TemplateFlowNode | TemplateFlowConnection;

export interface Template {
  // bpmn-js-create-append-anything plugin contract
  id: string;
  name: string;
  description?: string;
  appliesTo: string[];
  elementType?: { value: string };
  category?: { id: string; name: string };
  keywords?: string[];

  // Studyflow-specific
  /** Extension stamped on creation; absent for templates rooted at a plain BPMN type. */
  extensionType?: string;
  bpmnType: string;
  iconClass?: string;
  overrideIconClass?: string;
  templateAttributes?: Record<string, any>;
  flowElements?: TemplateFlowElement[];
  templateSource?: 'schema-template' | 'schema-type';
  schemaPrefix?: string;
}
