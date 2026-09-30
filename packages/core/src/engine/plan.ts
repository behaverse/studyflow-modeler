import { getCatalog, hasCatalog } from '@core/notation';
import { getExtensionType } from '@core/element';
import type { ModdleElement } from '@core/element/moddle';
import { STUDY_EXTENSION_TYPE, primaryRoot } from '@core/document/format';
import { mergeParameters, parametersOf, splitAttributes } from '@core/document/parameters';

/**
 * The plan: a study as one JSON document, what a partial runner reads instead of the diagram (skills/local/SKILL.md,
 * "The plan") and what the walk walks. Everything is spelled as the XML spells it: an element by its tag's local name
 * (`task`, `sequenceFlow`), its attributes under their local names as text, a reference as the id it names. Nothing
 * is inferred: an attribute the diagram omits is absent.
 */

/** The version of the hand-off contract (skills/local/SKILL.md) a plan is written for. */
export const PROTOCOL = 1;

export type Expression = { body: string; language: string | null };

export type Binding = { target: string | null; transformation: string | null; language: string | null };

export type Extension = { namespace: string; type: string; attributes: Record<string, string | string[]> };

/** A loop or multi-instance marker, as the walk reads it. */
export type Loop =
  | { kind: 'standard'; testBefore: boolean; maximum: number | null; condition: Expression | null }
  | {
    kind: 'multiInstance';
    cardinality: Expression | null;
    /** The list a pass runs over, and the names its item and output take in the activity's own scope. */
    input: string | null;
    inputItem: string | null;
    outputItem: string | null;
    output: string | null;
  };

export type PlanElement = {
  id: string;
  type: string;
  name: string | null;
  attributes: Record<string, string>;
  extensions: Extension[];
  additionalArguments: string | null;
  ioSlots: Record<string, string>;
  inputs: (Binding & { source: string })[];
  outputs: Binding[];
  /** A choreography task's bands, in order. */
  participants: string[];
  /** The container, for lexical lookups outward; absent for what a collaboration or the definitions hold. */
  parent?: string | null;
  /** The `studyflow:Parameters` wired into the element, merged, less the keys that set its attributes. */
  parameters?: Record<string, unknown>;
  /** A sequence flow's `conditionExpression`, a conditional event's `condition`. */
  condition?: Expression;
  loop?: Loop;
  /** An event's definitions, by local name (`errorEventDefinition`). */
  events?: string[];
  /** A participant's `participantMultiplicity/@maximum`. */
  multiplicity?: number;
  /** How a gateway of its extension type picks its branch (the schema's `meta.branching`): `random`. */
  branching?: string;
};

export type Plan = {
  protocol: number;
  /** What the person running the study asked the runners for (`--option sim`): each runner reads what it knows. */
  options: Record<string, unknown>;
  study: { id: string | null; name: string | null; seed: string | null; dependencies: string[] };
  /** Directories a boundary input may be staged from. */
  sources: string[];
  elements: Record<string, PlanElement>;
  /** The names a placeholder may cite (`{Play.trials}`): one element each, never an id's twin. */
  names: Record<string, string>;
  /** The processes the walk walks, each a pool of its own: every one with a sequence flow, the study's first. */
  processes: string[];
};

const CONTAINERS = new Set(['bpmn:SubProcess', 'bpmn:AdHocSubProcess', 'bpmn:Transaction']);
const PROV_ACTIVITY = 'prov:Activity';

/** The local name an XML tag takes for a moddle type: `bpmn:ExclusiveGateway` is `exclusiveGateway`. */
function tagOf(element: ModdleElement): string {
  const local = element.$descriptor?.ns?.localName ?? String(element.$type).split(':').pop()!;
  const pkg = element.$model?.getPackage?.(element.$descriptor?.ns?.prefix);
  return pkg && pkg.xml?.tagAlias !== 'lowerCase' ? local : local.charAt(0).toLowerCase() + local.slice(1);
}

/** An attribute value as the XML writes it. */
function text(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value && typeof value === 'object' && 'id' in value) return String((value as { id: unknown }).id);
  return String(value);
}

/** The XML attributes an element has, under their local names, as text; `skip` names the ones left out. */
function attributesOf(element: ModdleElement, skip: ReadonlySet<string> = new Set()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const property of element.$descriptor?.properties ?? []) {
    const local = property.ns?.localName ?? property.name;
    if (!property.isAttr || skip.has(local) || !Object.hasOwn(element, property.name)) continue;
    const value = element[property.name];
    if (value !== undefined && value !== null) out[local] = text(value);
  }
  // An element no loaded schema declares keeps its attributes as plain fields.
  const undeclared = element.$descriptor?.isGeneric ? Object.entries(element).filter(([key]) => !key.startsWith('$')) : [];
  for (const [key, value] of [...Object.entries(element.$attrs ?? {}), ...undeclared]) {
    const local = key.split(':').pop()!;
    if (!key.startsWith('xmlns') && !skip.has(local) && typeof value !== 'object' && typeof value !== 'function') out[local] = String(value);
  }
  return out;
}

/** An extension element under local names: its attributes, then its child elements' text (a list when a name repeats). */
function extensionOf(ext: ModdleElement): Extension {
  const attributes: Record<string, string | string[]> = attributesOf(ext);
  const add = (name: string, value: string): void => {
    const known = attributes[name];
    attributes[name] = known === undefined ? value : Array.isArray(known) ? [...known, value] : [known, value];
  };
  for (const property of ext.$descriptor?.properties ?? []) {
    if (property.isAttr || !Object.hasOwn(ext, property.name)) continue;
    const values = property.isMany ? ext[property.name] : [ext[property.name]];
    for (const value of values ?? []) if (typeof value === 'string') add(property.ns?.localName ?? property.name, value.trim());
  }
  for (const child of ext.$children ?? []) add(String(child.$type).split(':').pop()!, String(child.$body ?? '').trim());
  return { namespace: namespaceOf(ext), type: tagOf(ext), attributes };
}

/** The namespace an element's prefix is bound to: a loaded schema's, else the one the document declares for it. */
function namespaceOf(element: ModdleElement): string {
  const prefix = element.$descriptor?.ns?.prefix;
  const schema = element.$model?.getPackage?.(prefix)?.uri;
  if (schema) return schema;
  for (let at: ModdleElement | undefined = element; at; at = at.$parent) {
    const declared = at.$attrs?.[`xmlns:${prefix}`];
    if (typeof declared === 'string') return declared;
  }
  return '';
}

function expressionOf(expression: ModdleElement | undefined): Expression | undefined {
  const body = typeof expression?.body === 'string' ? expression.body.trim() : '';
  return body ? { body, language: expression?.language ?? null } : undefined;
}

function loopOf(marker: ModdleElement | undefined): Loop | undefined {
  if (marker?.$type === 'bpmn:StandardLoopCharacteristics') {
    return {
      kind: 'standard',
      testBefore: marker.testBefore === true,
      maximum: typeof marker.loopMaximum === 'number' ? marker.loopMaximum : null,
      condition: expressionOf(marker.loopCondition) ?? null,
    };
  }
  if (marker?.$type === 'bpmn:MultiInstanceLoopCharacteristics') {
    return {
      kind: 'multiInstance',
      cardinality: expressionOf(marker.loopCardinality) ?? null,
      input: marker.loopDataInputRef?.id ?? null,
      inputItem: marker.inputDataItem?.name ?? null,
      outputItem: marker.outputDataItem?.name ?? null,
      output: marker.loopDataOutputRef?.id ?? null,
    };
  }
  return undefined;
}

const id = (ref: any): string | null => (typeof ref === 'string' ? ref : ref?.id ?? null);

/** One element as a partial runner sees it: what the XML says, under local names, nothing inferred. */
export function planElement(element: ModdleElement): PlanElement {
  const ioSlots: Record<string, string> = {};
  for (const input of element.ioSpecification?.dataInputs ?? []) if (input?.id) ioSlots[input.id] = input.name ?? '';
  const binding = (association: ModdleElement): Binding => ({
    target: id(association.targetRef),
    transformation: typeof association.transformation?.body === 'string' ? association.transformation.body.trim() || null : null,
    language: association.transformation?.language ?? null,
  });
  const digest: PlanElement = {
    id: element.id,
    type: tagOf(element),
    name: element.name ?? null,
    attributes: attributesOf(element, new Set(['id', 'name'])),
    extensions: (element.extensionElements?.values ?? [])
      .filter((ext: ModdleElement) => ext.$type !== PROV_ACTIVITY)
      .map(extensionOf),
    additionalArguments: typeof element.additionalArguments === 'string' ? element.additionalArguments.trim() || null : null,
    ioSlots,
    inputs: (element.dataInputAssociations ?? []).flatMap((association: ModdleElement) => (association.sourceRef ?? [])
      .map((source: ModdleElement) => ({ source: id(source)!, ...binding(association) }))
      .filter((input: { source: string | null }) => input.source)),
    outputs: (element.dataOutputAssociations ?? []).map(binding),
    participants: (element.participantRef ?? []).map(id).filter(Boolean),
  };
  const condition = expressionOf(element.conditionExpression)
    ?? expressionOf(element.eventDefinitions?.find((d: ModdleElement) => d.$type === 'bpmn:ConditionalEventDefinition')?.condition);
  if (condition) digest.condition = condition;
  const loop = loopOf(element.loopCharacteristics);
  if (loop) digest.loop = loop;
  if (element.eventDefinitions?.length) digest.events = element.eventDefinitions.map(tagOf);
  if (typeof element.participantMultiplicity?.maximum === 'number') digest.multiplicity = element.participantMultiplicity.maximum;
  const extensionType = getExtensionType(element);
  const branching = extensionType && hasCatalog() ? getCatalog().getType(extensionType)?.meta?.branching : undefined;
  if (typeof branching === 'string') digest.branching = branching;
  return digest;
}

/** The Parameters wired into an element, merged and split into the attributes they set and the rest; undefined when
 * none is wired. */
function wired(element: ModdleElement): { attributes: Record<string, unknown>; rest: Record<string, unknown> } | undefined {
  const sources: [string, Record<string, unknown>][] = [];
  for (const association of element.dataInputAssociations ?? []) {
    for (const source of association.sourceRef ?? []) {
      const values = parametersOf(source);
      if (values && !sources.some(([known]) => known === source.id)) sources.push([source.id, values]);
    }
  }
  if (sources.length === 0) return undefined;
  return splitAttributes(element, mergeParameters(element.id, sources), element.id);
}

/** Identifier-shaped names, one element each: a name two elements share, or one that is also an id, binds nothing. */
export function boundNames(elements: Record<string, PlanElement>): Record<string, string> {
  const named = Object.values(elements).filter((element) => element.name && /^[A-Za-z_]\w*$/.test(element.name));
  const count = new Map<string, number>();
  for (const { name } of named) count.set(name!, (count.get(name!) ?? 0) + 1);
  return Object.fromEntries(named
    .filter(({ id: own, name }) => count.get(name!) === 1 && !(name! in elements && name !== own))
    .map(({ id: own, name }) => [own, name!]));
}

export type PlanOptions = { options?: Record<string, unknown>; sources?: string[] };

/** A study's elements as a run reads them. */
export type StudyIndex = {
  /** The processes to walk: every one with a sequence flow, the study's own first. */
  processes: ModdleElement[];
  /** The root carrying the study (a pool diagram's collaboration, else the process): its id and name are the run's. */
  root: ModdleElement;
  study: ModdleElement | undefined;
  /** Every element of the walked processes, by id, with its container. */
  walked: Map<string, { element: ModdleElement; parent: ModdleElement }>;
  /** What the collaborations and the definitions hold beside them: participants, message flows, messages, item definitions. */
  others: ModdleElement[];
};

export function indexOf(definitions: ModdleElement): StudyIndex {
  const roots: ModdleElement[] = definitions.rootElements ?? [];
  const processes_ = roots.filter((root) => root.$type === 'bpmn:Process');
  let walkable = processes_.filter((root) => (root.flowElements ?? []).some((element: ModdleElement) => element.$type === 'bpmn:SequenceFlow'));
  // A study of steps and no flow is walked from its one step (the walk refuses more than one).
  if (walkable.length === 0) walkable = processes_.filter((root) => (root.flowElements ?? []).length > 0).slice(0, 1);
  if (walkable.length === 0) throw new Error('no process with a sequence flow to walk');
  const studyOf = (root: ModdleElement): ModdleElement | undefined =>
    root?.extensionElements?.values?.find((ext: ModdleElement) => ext.$type === STUDY_EXTENSION_TYPE);
  const process = walkable.find((candidate) => studyOf(candidate)) ?? walkable[0];
  const root = roots.find((candidate) => studyOf(candidate)) ?? primaryRoot(definitions) ?? process;

  const walked: StudyIndex['walked'] = new Map();
  const index = (container: ModdleElement): void => {
    for (const element of [...(container.properties ?? []), ...(container.flowElements ?? []), ...(container.artifacts ?? [])]) {
      if (!element?.id) continue;
      walked.set(element.id, { element, parent: container });
      if (CONTAINERS.has(element.$type)) index(element);
      // A plain element's properties are its own scope's (`Excluded (n={count})`).
      else for (const property of element.properties ?? []) if (property?.id) walked.set(property.id, { element: property, parent: element });
    }
  };
  const processes = [process, ...walkable.filter((other) => other !== process)];
  for (const each of processes) index(each);

  const others = roots.flatMap((definition) => {
    if (definition.$type === 'bpmn:Message' || definition.$type === 'bpmn:ItemDefinition') return definition.id ? [definition] : [];
    if (definition.$type !== 'bpmn:Collaboration') return [];
    return [...(definition.participants ?? []), ...(definition.messageFlows ?? [])].filter((child) => child?.id);
  });
  return { processes, root, study: studyOf(root) ?? studyOf(process), walked, others };
}

/** The plan of a study: every element by id (pool participants, message flows, messages and item definitions
 * included), the study, and the processes to walk. */
export function planOf(definitions: ModdleElement, { options = {}, sources = [] }: PlanOptions = {}): Plan {
  const { processes, root, study, walked, others } = indexOf(definitions);
  const elements: Record<string, PlanElement> = {};
  for (const [id, { element, parent }] of walked) {
    const digest = planElement(element);
    digest.parent = parent.id;
    const read = wired(element);
    if (read) {
      // A key naming one of the element's attributes sets it (`instrument: WO`); the rest is its `parameters`.
      digest.parameters = read.rest;
      const ext = digest.extensions[0];
      if (ext) for (const [key, value] of Object.entries(read.attributes)) ext.attributes[key] = text(value);
    }
    elements[id] = digest;
  }
  const names = boundNames(elements);
  for (const other of others) elements[other.id] = planElement(other);

  const pool = others.find((other) => other.$type === 'bpmn:Participant' && other.processRef === processes[0]);
  const seed = study?.seed;
  return {
    protocol: PROTOCOL,
    options,
    study: {
      id: root.id ?? null,
      name: root.name || processes[0].name || pool?.name || root.id || null,
      seed: seed === undefined || seed === null ? null : String(seed),
      dependencies: (study?.dependencies ?? []).map((spec: unknown) => String(spec).trim()).filter(Boolean),
    },
    sources,
    elements,
    names,
    processes: processes.map((walkedProcess) => walkedProcess.id),
  };
}
