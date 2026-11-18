export type NsInfo = {
  /** Qualified, e.g. `cognitive:instrument`. */
  name: string;
  prefix: string;
  localName: string;
};

/** The inspector's input registry types off this list, and the compiler warns on any `meta.widget` outside it. */
export const WIDGET_NAMES = ['csvw-table', 'code', 'markdown', 'checklist'] as const;
export type WidgetName = (typeof WIDGET_NAMES)[number];

export interface AttributeMeta {
  widget?: string;
  /** Visibility predicate: shown only when every entry matches the element's attribute of that name. */
  condition?: Record<string, unknown>;
  categories?: string[];
  order?: number;
  /** Fixed value: never rendered. */
  hidden?: boolean;
  /** Shown in the inline inspector on the canvas, under the name, as well as in the inspector. */
  showInline?: boolean;
  /** A checkbox opens the field. */
  nullable?: boolean;
  /** An enumeration that also takes a value outside its list. */
  allowCustom?: boolean;
  expression?: boolean;
  /** The sibling attribute that holds the language of the code editor (`widget: code`). */
  codeEditorLanguage?: string;
  icon?: string;
  /** Unit of a numeric attribute (`Hz`, `s`, `rad`), shown after the field label; never part of the name. */
  unit?: string;
  /** The field's label, where the one shared by every attribute of its name would mislead. */
  label?: string;
  [key: string]: unknown;
}

export interface TypeMeta {
  connectsTo?: string[];
  /** What the type stands for to exports, reports and checks; inherited by subtypes. */
  tags?: TypeTag[];
  /** How a gateway of this type picks its branch: `random` or `condition`. */
  strategy?: string;
  /** Its group in the tools, where its BPMN ancestor does not say. */
  paletteGroup?: string;
  widget?: string;
  icon?: string;
  /** The attribute whose value is written over the icon. */
  glyph?: string;
  /** The upper band's text on a task drawn as a choreography task, its attributes in angle brackets. */
  choreographyBandLabel?: string;
  /** On a pool type: the enumeration attribute that lists its kinds of actor, or the one kind it is. */
  actorKind?: string;
  /** The type that describes what a step of this type hands back. */
  returns?: string;
  /** The event definition an event of this type is minted with: its type and what it holds. */
  eventDefinition?: { type: string; [key: string]: unknown };
  [key: string]: unknown;
}

/** Declared as `meta.tags` and inherited by subtypes; `data-element` alone follows from the BPMN attach point (`inferTags`). */
export type TypeTag =
  | 'data-element'
  | 'signal'
  | 'instrument'
  | 'acquisition'
  | 'screening'
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
  typeWidget?: string;
  isEnum?: boolean;
};

export type TypeStyle = 'wrapper' | 'trait';

export type TypeEntry = {
  name: string;
  ns: NsInfo;
  description?: string;
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
  tags: TypeTag[];
  hiddenFromPalette: boolean;
  paletteLabel: string;
  paletteGroup?: string;
};

export type SchemaEntry = {
  prefix: string;
  name: string;
  description?: string;
  icon?: string;
  required: boolean;
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

/** A palette template: what the palette shows, read off its first element, and the elements a drop builds. */
export interface Template {
  id: string;
  name: string;
  description?: string;
  extensionType?: string;
  bpmnType: string;
  iconClass?: string;
  /** As the schema spells them (`.studyflow.yaml`); see `SchemaTemplateModel`. */
  elements: Record<string, unknown>;
}
