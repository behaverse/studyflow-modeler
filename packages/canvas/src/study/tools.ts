/**
 * A study as tools, in the shape an MCP server or an AI SDK hands a model: each a name, a description, the JSON
 * Schema of its one argument, and hints of what it does. `study.call(name, args)` runs one on parsed JSON and
 * answers with one JSON object; a write also says what it added, changed and removed, by id.
 */

import type { AttributeRecord } from '@canvas/study/attributes.ts';
import { SHAPE_TYPES, type Catalog } from '@canvas/study/catalog.ts';
import type { ElementRecord } from '@canvas/study/records.ts';
import type { StudyResult, Verdict } from '@canvas/study/Study.ts';

type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

/** As much of JSON Schema as the tools' arguments are written in, and `misfitOf` checks. */
export interface JsonSchema {
  readonly type?: JsonType | readonly JsonType[];
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: false;
  readonly items?: JsonSchema;
  readonly enum?: readonly unknown[];
}

export interface StudyTool {
  readonly name: ToolName;
  readonly description: string;
  /** The tool's one argument: always an object. */
  readonly inputSchema: JsonSchema & { readonly type: 'object' };
  /** MCP's hints. A read changes nothing; a destructive write may lose what was there; every write can be undone. */
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint: false;
  };
}

/** The write tools a batch runs as its steps. */
export const STEP_TOOLS = ['add', 'append', 'connect', 'replace', 'move', 'reconnect', 'rename', 'resize', 'reroute', 'paste', 'layout', 'set', 'item', 'bands', 'remove', 'style', 'expand', 'collapse'] as const;

export type StepTool = (typeof STEP_TOOLS)[number];
export type ToolName = StepTool | 'document' | 'get' | 'list' | 'attributes' | 'describe' | 'catalog' | 'can' | 'copy' | 'batch' | 'undo' | 'redo';

/** The verbs `can` answers for by the rules alone, so it may ask with part of the argument left out. */
export const ASKABLE_TOOLS = ['append', 'connect', 'replace'] as const;

export type AskableTool = (typeof ASKABLE_TOOLS)[number];

/** What an element of a type takes beside its schema's attributes: a property BPMN gives it, set as the file spells it. */
export interface StructureRecord {
  readonly name: string;
  /** What it holds: a BPMN type, or a built-in (`String`, `Boolean`). */
  readonly type: string;
  readonly many?: boolean;
  /** It names another element by id, rather than holding one. */
  readonly reference?: boolean;
  /** The concrete types it may hold, when `type` has several: each names itself with `type:`. */
  readonly of?: readonly string[];
}

/** What `call` answers: a write's result, or what a read found; `ok` false, and why, when the tool did nothing. */
export type ToolResult =
  | StudyResult
  | { readonly ok: true; readonly yaml: string }
  | { readonly ok: true; readonly element: ElementRecord }
  | { readonly ok: true; readonly elements: readonly ElementRecord[] }
  | { readonly ok: true; readonly attributes: readonly AttributeRecord[] }
  | { readonly ok: true; readonly attributes: readonly AttributeRecord[]; readonly structure: readonly StructureRecord[] }
  | ({ readonly ok: true } & Catalog)
  | Verdict;

const READ = { readOnlyHint: true, openWorldHint: false } as const;

function write(destructive: boolean, idempotent: boolean): StudyTool['annotations'] {
  return { readOnlyHint: false, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: false };
}

/** One tool, its schema kept as written (what `ArgsOf` reads): `required` names properties the schema has. */
function tool<const N extends ToolName, const P extends Record<string, JsonSchema>, const R extends readonly (keyof P & string)[]>(
  name: N,
  description: string,
  properties: P,
  required: R,
  annotations: StudyTool['annotations'] = READ,
) {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations } as const;
}

const STRING = { type: 'string' } as const;
const NUMBER = { type: 'number' } as const;
const ID = { type: 'string', description: "An element's id." } as const;
const IDS = { type: 'array', items: STRING, description: "Elements' ids." } as const;
const POINT = { type: 'object', properties: { x: NUMBER, y: NUMBER }, required: ['x', 'y'], additionalProperties: false } as const;
const BOUNDS = {
  type: 'object',
  properties: { x: NUMBER, y: NUMBER, width: NUMBER, height: NUMBER },
  required: ['x', 'y', 'width', 'height'],
  additionalProperties: false,
  description: 'The top-left corner and the size, in diagram coordinates.',
} as const;
const COLOR = { type: ['string', 'null'], description: "A CSS colour; null for the stock one." } as const;
const BAND = {
  type: ['object', 'null'],
  description: 'A participant by id, or a name, or null for none.',
  properties: { participant: STRING, name: STRING },
  additionalProperties: false,
} as const;

/** What a new shape is: `add`, `append` and `replace` take it. */
const SHAPE = {
  type: { type: 'string', enum: SHAPE_TYPES, description: 'Its BPMN type.' },
  extension: { type: 'string', description: 'A schema type extending `type`, paired with it as the catalog lists them.' },
  expanded: { type: 'boolean', description: 'A container drawn open, its contents in view; one is born closed.' },
  attributes: { type: 'object', description: "Set at birth. `{ eventDefinitions: [{ type: 'bpmn:TimerEventDefinition' }] }` makes a timer event." },
} as const;

/** A new element: a shape, or a template's elements. */
const NEW = {
  ...SHAPE,
  name: STRING,
  template: { type: 'string', description: "A template's id, as the catalog lists it, in place of `type`: its elements, laid out in the shape it drops as." },
  id: { type: 'string', description: 'Its id, when free; one is minted without it. A template keeps its own.' },
} as const;

const TOOLS = [
  tool('document', 'The whole study as its .studyflow.yaml file holds it: every element with its attributes, every flow, and the drawing.', {}, []),
  tool('get', "One element as a record: its kind, type (and the schema type extending it), name, parent, bounds, and flows in and out; a flow's ends and route. The root's id reads the root.", { id: ID }, ['id']),
  tool('list', 'The shapes and flows as records, in document order: all of them, or those of a kind (captions only this way), of a type (a BPMN or a schema type), within a container however deep, or whose name holds `name`. A record says what an element is and how it connects; with `geometry`, where it is drawn too.', {
    kind: { type: 'string', enum: ['node', 'edge', 'label'] },
    type: STRING,
    within: ID,
    name: { type: 'string', description: 'Part of a name, in any case.' },
    geometry: { type: 'boolean', description: 'With bounds, routes and colours.' },
  }, []),
  tool('attributes', "The attributes an element (or the root) takes, by the names `set` takes: each one's type, description and, for an enumeration, its values; when the inspector shows it; and what it holds now, when that is plain JSON.", { id: ID }, ['id']),
  tool('describe', "What an element of `type` takes, before one exists: its schema's attributes as `attributes` lists them (with `extension`, that schema type's too), and what BPMN gives it (`structure`): a loop marker, an event's definitions, a condition, the properties a scope declares, the data a step reads. `set` takes each by its name, a structured one as the document spells it.", {
    type: { type: 'string', description: 'A BPMN type: bpmn:Task.' },
    extension: { type: 'string', description: 'A schema type extending it, as the catalog lists them.' },
  }, ['type']),
  tool('catalog', "What add, append and replace make: the BPMN types, the schema types extending them, and the templates, each with a title and a description.", {}, []),
  tool('can', "Whether a write tool would run on `args`, without writing, and why not. Of append, connect and replace, leave out what is not decided yet to ask about any: append's `type`, whether anything may follow `from`; connect's `to`, whether a flow may leave it; replace's `type`, whether it may be retyped at all.", {
    tool: { type: 'string', enum: STEP_TOOLS },
    args: { type: 'object', description: "The verb's argument, as far as it is decided." },
  }, ['tool', 'args']),
  tool('copy', 'The shapes `ids` name, with what they hold, the boundary events on them and the flows between them, as a .studyflow.yaml document of their own: what paste takes. Pools, lanes and a flow without its ends stay behind, and so does every reference to what does.', {
    ids: { type: 'array', items: ID },
  }, ['ids']),
  tool('add', "Add a shape of `type` (or a template's elements) centred on `at`, or without it in free space beside what shares its container. `into` names the container; the root's id is the top level; without it, whatever is under `at`.", {
    ...NEW,
    at: { ...POINT, description: 'Its centre, in diagram coordinates.' },
    into: ID,
  }, [], write(false, false)),
  tool('append', 'Add a shape of `type` (or a template\'s elements) one gap to the right of `from`, clear of its neighbours, and connect it from `from`.', { from: ID, ...NEW }, ['from'], write(false, false)),
  tool('connect', 'Connect `from` to `to` with the flow the rules allow between them: a sequence or a message flow, a data or a plain association.', {
    from: ID,
    to: ID,
    id: { type: 'string', description: "The flow's id, when free." },
  }, ['from', 'to'], write(false, false)),
  tool('replace', 'Retype a shape: a new shape of `type` in its stead, keeping its name, its centre and its flows.', { id: ID, ...SHAPE }, ['id', 'type'], write(true, true)),
  tool('move', "Move shapes and captions by `by`, in diagram units, their contents and flows along; into a container (`into`, the root's id for the top level) when given, as the rules allow.", {
    ids: IDS,
    by: { ...POINT, description: 'How far, right and down.' },
    into: ID,
  }, ['ids', 'by'], write(false, false)),
  tool('reconnect', 'Move the ends of a flow onto other shapes: its source to `from`, its target to `to`, as the rules allow its kind of flow; routed afresh.', {
    id: ID,
    from: ID,
    to: ID,
    waypoints: { type: 'array', items: POINT, description: 'Its route, from its source to its target; without it, routed afresh.' },
  }, ['id'], write(false, true)),
  tool('rename', "Rename a shape or a flow, as its caption reads; with `band`, the participant a choreography task's top or bottom band shows. An empty name clears it.", {
    id: ID,
    name: { type: 'string' },
    band: { type: 'string', enum: ['top', 'bottom'] },
  }, ['id', 'name'], write(false, true)),
  tool('resize', 'Give a shape new bounds.', { id: ID, bounds: BOUNDS }, ['id', 'bounds'], write(false, true)),
  tool('reroute', 'Route a flow through `waypoints`, or squarely between its ends without them.', {
    id: ID,
    waypoints: { type: 'array', items: POINT, description: 'Two points at least, from its source to its target.' },
  }, ['id'], write(false, true)),
  tool('paste', "Add the shapes and flows of a .studyflow.yaml document's process (what copy gives, or one written in its spelling), centred on `at`, or without it a step right of and below where the document draws them; into the container `into` names, or whatever is under `at`. An id the study holds is swapped for a fresh one, and code naming it follows.", {
    yaml: { type: 'string', description: 'The document, as its .studyflow.yaml text.' },
    at: { ...POINT, description: 'Where its middle goes, in diagram coordinates.' },
    into: ID,
  }, ['yaml'], write(false, false)),
  tool('layout', 'Lay the whole diagram out afresh: each flow left to right, lanes as bands, pools stacked, data under its steps, groups round what they hold; shapes keep their sizes, and every flow is routed anew.', {}, [], write(false, true)),
  tool('set', "Set an attribute of an element, or of the root, where its schema keeps it (`attributes` lists them); 'name' renames, and null clears. What BPMN gives an element is set the same way, spelled as the document spells it (`describe` lists it): `loopCharacteristics: { type: StandardLoopCharacteristics, loopMaximum: 3 }`, `eventDefinitions: [{ type: TimerEventDefinition, timeDuration: PT5M }]`, `conditionExpression: \"score > 0.9\"`, `default: Flow_No`, `properties: { P_Count: { name: count, value: \"0\" } }`, `dataInputAssociations: { In_Trials: { sourceRef: [Trials] } }`. Such a value replaces what was there whole, and names other elements by id.", {
    id: ID,
    attribute: { type: 'string', description: "Its name, as the document spells it: 'name', 'duration', 'cognitive:instrument', 'loopCharacteristics'." },
    value: { description: 'Any JSON value the attribute takes.' },
  }, ['id', 'attribute', 'value'], write(false, true)),
  tool('item', "Say what a message flow carries, or what a property or a data object holds: `structure` names it (a schema type such as `behaverse:Trial`, or any text), and the document keeps one definition of each, made on first use. An empty `structure` says nothing of it.", {
    id: ID,
    structure: { type: 'string' },
  }, ['id', 'structure'], write(false, true)),
  tool('bands', "Say who takes a choreography task's two bands, and which starts the exchange. A band takes a participant the study declares, by id (`{ participant: Robot }`), or a name its participant takes (`{ name: Experimenter }`; a typed task's drawn pool keeps its own, and a new actor of that name takes the band), or none (null). `kinds` types the actor on a band as one of the kinds the schemas declare (`''` for none). Participants the task lacks are made.", {
    id: ID,
    top: BAND,
    bottom: BAND,
    initiator: { type: 'string', enum: ['top', 'bottom'] },
    kinds: { type: 'object', properties: { top: { type: 'string' }, bottom: { type: 'string' } }, additionalProperties: false },
  }, ['id'], write(false, true)),
  tool('remove', "Remove elements and all that goes with them: their contents and their flows. A caption's id clears the name it shows.", { ids: IDS }, ['ids'], write(true, true)),
  tool('style', "Colour elements and letter their captions; a caption's id styles what it captions. What is left out stays as it is.", {
    ids: IDS,
    fill: COLOR,
    stroke: COLOR,
    font: {
      type: 'object',
      properties: {
        bold: { type: 'boolean' },
        italic: { type: 'boolean' },
        align: { type: ['string', 'null'], enum: ['left', 'center', 'right', null] },
        color: COLOR,
      },
      additionalProperties: false,
    },
  }, ['ids'], write(false, true)),
  tool('expand', 'Draw a container open, its contents framed inside it.', { id: ID }, ['id'], write(false, true)),
  tool('collapse', 'Draw a container closed, its contents hidden until a view drills in.', { id: ID }, ['id'], write(false, true)),
  tool('batch', 'Run write tools as one edit and one undo step, all or nothing: when a step is refused, none is kept, and the reason names the step. Name what you add, to connect it in a later step.', {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { tool: { type: 'string', enum: STEP_TOOLS }, args: { type: 'object' } },
        required: ['tool', 'args'],
        additionalProperties: false,
      },
    },
  }, ['steps'], write(true, false)),
  tool('undo', 'Go back to the study before the last edit.', {}, [], write(false, false)),
  tool('redo', 'Go forward to the edit the last undo went back from.', {}, [], write(false, false)),
] as const;

export const STUDY_TOOLS: readonly StudyTool[] = TOOLS;

type Plain = { string: string; number: number; boolean: boolean; null: null; object: Record<string, unknown>; array: unknown[] };

/** The values a schema admits, as a TypeScript type. */
type Admits<S> =
  S extends { enum: readonly (infer Option)[] } ? Option
  : S extends { type: 'array'; items: infer Item } ? Admits<Item>[]
  : S extends { type: 'object'; properties: infer Properties; required: readonly (infer Required)[] }
    ? { -readonly [Key in keyof Properties as Key extends Required ? Key : never]: Admits<Properties[Key]> }
      & { -readonly [Key in keyof Properties as Key extends Required ? never : Key]?: Admits<Properties[Key]> }
  : S extends { type: 'object'; properties: infer Properties } ? { -readonly [Key in keyof Properties]?: Admits<Properties[Key]> }
  : S extends { type: readonly (infer Type extends JsonType)[] } ? Plain[Type]
  : S extends { type: infer Type extends JsonType } ? Plain[Type]
  : unknown;

/** What a tool's schema admits as its argument. `call` hands a verb what passed its schema, so a verb that takes
 * anything else no longer compiles: the schema and the verb's signature cannot drift apart. */
export type ArgsOf<Name extends ToolName> = Admits<Extract<(typeof TOOLS)[number], { name: Name }>['inputSchema']>;

/** Whether `name` names a write tool a batch runs as a step. */
export function isStepTool(name: string): name is StepTool {
  return (STEP_TOOLS as readonly string[]).includes(name);
}

/** Why `args` is no argument for the tool `name`, or nothing when it is one; `leftOut` names required keys it may lack. */
export function misfitOf(name: string, args: unknown, leftOut: readonly string[] = []): string | undefined {
  const found = STUDY_TOOLS.find((candidate) => candidate.name === name);
  if (!found) return `no tool '${name}'`;
  const required = found.inputSchema.required?.filter((key) => !leftOut.includes(key));
  return misfit({ ...found.inputSchema, required }, args, '');
}

const A: Record<JsonType, string> = {
  object: 'an object',
  array: 'a list',
  string: 'a string',
  number: 'a number',
  boolean: 'true or false',
  null: 'null',
};

function misfit(schema: JsonSchema, value: unknown, path: string): string | undefined {
  const named = path ? `'${path}'` : 'the argument';
  const types = schema.type === undefined ? [] : [schema.type].flat();
  if (types.length > 0 && !types.some((type) => fits(type, value))) return `${named} should be ${types.map((type) => A[type]).join(' or ')}`;
  if (schema.enum && !schema.enum.includes(value)) return `${named} should be one of ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}`;
  if (Array.isArray(value) && schema.items) {
    for (const [index, item] of value.entries()) {
      const why = misfit(schema.items, item, `${path}[${index}]`);
      if (why) return why;
    }
  }
  if (isObject(value) && schema.properties) {
    const at = (key: string): string => (path ? `${path}.${key}` : key);
    const missing = schema.required?.find((key) => !(key in value));
    if (missing) return `'${at(missing)}' is required`;
    for (const [key, item] of Object.entries(value)) {
      const property = schema.properties[key];
      if (!property && schema.additionalProperties === false) return `${named} takes no '${key}'`;
      const why = property && misfit(property, item, at(key));
      if (why) return why;
    }
  }
  return undefined;
}

function fits(type: JsonType, value: unknown): boolean {
  switch (type) {
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'null': return value === null;
    default: return typeof value === type;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
