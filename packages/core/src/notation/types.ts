export type NsInfo = {
  /** Qualified, e.g. `cognitive:instrument`. */
  name: string;
  prefix: string;
  localName: string;
};

/** The inspector's input registry types off this list, and the compiler warns on any `meta.editor` outside it. */
export const EDITOR_NAMES = ['csvw-table', 'code', 'markdown', 'checklist'] as const;
export type EditorName = (typeof EDITOR_NAMES)[number];

export interface AttributeMeta {
  editor?: string;
  /** Visibility predicate: shown only when every entry of `body` matches the element. */
  condition?: { body?: Record<string, unknown> };
  categories?: string[];
  order?: number;
  /** Fixed value: never rendered, and preferred over a business-object default on read (`extensionValueWins`). */
  pinned?: boolean;
  optional?: boolean;
  editable?: boolean;
  readonly?: boolean;
  expression?: boolean;
  languageAttr?: string;
  icon?: string;
  /** Unit of a numeric attribute (`Hz`, `s`, `rad`), shown after the field label; never part of the name. */
  unit?: string;
  [key: string]: unknown;
}

export interface TypeMeta {
  bpmnType?: string;
  connectsTo?: string[];
  roles?: TypeRole[];
  branching?: string;
  categories?: string[];
  editor?: string;
  icon?: string;
  [key: string]: unknown;
}

/** Declared as `meta.roles` and inherited by subtypes, or inferred from the type's shape (`inferRoles`). */
export type TypeRole =
  | 'data-element'
  | 'signal'
  | 'instrument'
  | 'acquisition'
  | (string & {});

export type EnumLiteral = {
  name: string;
  value: unknown;
  icon?: string;
  description?: string;
};

export type EnumEntry = {
  name: string;
  ns: NsInfo;
  description?: string;
  literals: EnumLiteral[];
};

export type AttributeSpec = {
  name: string;
  ns: NsInfo;
  /** Qualified for schema types, bare for primitives (`String`, `Boolean`). */
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

  redefinedName?: string;
  /** When `type` is a body-wrapper element type: the property carrying its text. */
  bodyProp?: string;
  bodyType?: string;
  typeEditor?: string;
  isEnum?: boolean;
};

export type TypeStyle = 'wrapper' | 'trait';

export type TypeEntry = {
  name: string;
  ns: NsInfo;
  description?: string;
  icon?: string;
  iconClass?: string;
  isAbstract: boolean;
  style: TypeStyle;
  extends: string[];
  meta: TypeMeta;
  /** null for value and helper types, which are not creatable on the canvas. */
  bpmnType: string | null;
  /** Own plus inherited, `redefines`/`replaces` applied; BPMN natives excluded. */
  attributes: AttributeSpec[];
  defaults: Record<string, unknown>;
  roles: TypeRole[];
  hiddenFromPalette: boolean;
  paletteLabel: string;
  paletteCategories: string[];
};

export type SchemaEntry = {
  prefix: string;
  name: string;
  description?: string;
  icon?: string;
  core: boolean;
  uri?: string;
  categories: CategoryEntry[];
  types: TypeEntry[];
  enums: EnumEntry[];
  templates: Template[];
};

/** Sentinel `order` for categories no schema declares, so they sort after every declared one. */
export const UNDECLARED_CATEGORY_ORDER = Number.MAX_SAFE_INTEGER;

export type CategoryEntry = {
  name: string;
  order: number;
  description?: string;
  synthetic: boolean;
};

/* Field names below are the create/append template contract, plus studyflow extras. */

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
  id: string;
  name: string;
  description?: string;
  appliesTo: string[];
  elementType?: { value: string };
  category?: { id: string; name: string };
  keywords?: string[];
  extensionType?: string;
  bpmnType: string;
  iconClass?: string;
  overrideIconClass?: string;
  templateAttributes?: Record<string, any>;
  flowElements?: TemplateFlowElement[];
  templateSource?: 'schema-template' | 'schema-type';
  schemaPrefix?: string;
}
