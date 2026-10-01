import { getCatalog, hasCatalog } from '@core/notation';
import type { Timer } from '@core/engine/timer';
import { expressionOf as modelExpression, idOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index';
import { wiredIn } from '@core/model/parameters';
import { expandInline, splitBinding } from '@core/model/spelling';

const isMapping = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The plan: a study as one JSON document, what a partial runner reads instead of the diagram (packages/runtime-local/CONTRACT.md,
 * "The plan") and what the walk walks. Everything is spelled as the XML spells it: an element by its tag's local name
 * (`task`, `sequenceFlow`), its attributes under their local names as text, a reference as the id it names. Nothing
 * is inferred: an attribute the diagram omits is absent.
 */

/** The version of the hand-off contract (packages/runtime-local/CONTRACT.md) a plan is written for. */
export const PROTOCOL = 2;

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
  /** A timer event's time, as written. */
  timer?: Timer;
  /** A participant's `participantMultiplicity/@maximum`. */
  multiplicity?: number;
  /** A pool with no process that remembers the conversation of each instance of the pool asking it: its actor's
   * `memory`. */
  memory?: 'conversation';
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

/* --- the plan of a study model --- */

/** The local name an XML tag takes for a type: `bpmn:ExclusiveGateway` is `exclusiveGateway`. */
function tagIn(model: StudyModel, type: string): string {
  const [prefix, local] = type.includes(':') ? type.split(':') : ['', type];
  const pkg = model.metamodel.package(prefix);
  return pkg && pkg.xml?.tagAlias !== 'lowerCase' ? local : local.charAt(0).toLowerCase() + local.slice(1);
}

/** A value as the XML writes it: text, a truth value, a reference's id, a YAML mapping as its text. */
function textIn(value: Value): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (isElement(value)) return String(value.id);
  if (value && typeof value === 'object' && !Array.isArray(value)) return expandInline(value as Record<string, unknown>);
  return String(value);
}

/** The XML attributes `element` has as `type` (its BPMN element, or its schema type for its entry), as text. */
function attributesIn(model: StudyModel, element: Element, type: string, skip: ReadonlySet<string> = new Set()): Record<string, string> {
  const out: Record<string, string> = {};
  const descriptor = model.metamodel.descriptor(type);
  for (const property of descriptor.properties) {
    const local = property.ns.localName;
    if (!property.isAttr || skip.has(local) || !(local in element)) continue;
    const value = element[local];
    if (value !== undefined && value !== null) out[local] = textIn(value);
  }
  // A key no schema declares stays an attribute of the element, as the XML keeps it.
  for (const [key, value] of Object.entries(element)) {
    if (key === 'type' || model.property(element, key) || key.startsWith('xmlns')) continue;
    const local = key.split(':').pop()!;
    if (!skip.has(local) && value !== null && typeof value !== 'object') out[local] = String(value);
  }
  return out;
}

/** An extension entry under local names: its attributes, then its text-valued children (a list when a name repeats). */
function extensionIn(model: StudyModel, entry: Element): Extension {
  const prefix = entry.type.split(':')[0];
  const declared = model.study.definitions[`xmlns:${prefix}`];
  const namespace = model.metamodel.package(prefix)?.uri ?? (typeof declared === 'string' ? declared : '');
  if (!model.metamodel.has(entry.type)) {
    // A foreign element: its attributes and its children's texts, one text where a name does not repeat.
    const attributes: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'type' || value === undefined || value === null) continue;
      if (Array.isArray(value)) attributes[key] = value.length === 1 ? String(value[0]) : value.map(String);
      else if (typeof value !== 'object') attributes[key] = String(value);
    }
    return { namespace, type: tagIn(model, entry.type), attributes };
  }
  const attributes: Record<string, string | string[]> = attributesIn(model, entry, entry.type);
  const add = (name: string, value: string): void => {
    const known = attributes[name];
    attributes[name] = known === undefined ? value : Array.isArray(known) ? [...known, value] : [known, value];
  };
  for (const property of model.metamodel.descriptor(entry.type).properties) {
    const local = property.ns.localName;
    if (property.isAttr || !(local in entry)) continue;
    const values = property.isMany ? entry[local] as Value[] : [entry[local]];
    // A YAML-typed child the model holds as its mapping is the text the XML writes.
    for (const value of values ?? []) if (typeof value === 'string' || (isMapping(value) && !isElement(value))) add(local, textIn(value).trim());
  }
  return { namespace, type: tagIn(model, entry.type), attributes };
}

function loopIn(marker: Value | undefined): Loop | undefined {
  if (!isElement(marker)) return undefined;
  if (marker.type === 'bpmn:StandardLoopCharacteristics') {
    return {
      kind: 'standard',
      testBefore: marker.testBefore === true,
      maximum: typeof marker.loopMaximum === 'number' ? marker.loopMaximum : null,
      condition: expressionIn(marker.loopCondition) ?? null,
    };
  }
  if (marker.type === 'bpmn:MultiInstanceLoopCharacteristics') {
    const nameOf = (item: Value | undefined): string | null => (isElement(item) && typeof item.name === 'string' ? item.name : null);
    return {
      kind: 'multiInstance',
      cardinality: expressionIn(marker.loopCardinality) ?? null,
      input: idOf(marker.loopDataInputRef),
      inputItem: nameOf(marker.inputDataItem),
      outputItem: nameOf(marker.outputDataItem),
      output: idOf(marker.loopDataOutputRef),
    };
  }
  return undefined;
}

function expressionIn(value: Value | undefined): Expression | undefined {
  return modelExpression(value);
}

const listIn = (value: Value | undefined): Value[] => (Array.isArray(value) ? value : []);

/**
 * An activity's data associations as its BPMN XML spells them. A compact input (one targeting no `bpmn:DataInput`)
 * is written to XML (`expandIoSpecification`) as targeting a data input `<activity>_in_<slot>` its slot names, with the
 * selection alone as its transformation; a compact output keeps its selection alone. An activity whose
 * `ioSpecification` is written out is read as it is.
 */
function dataAssociationsIn(model: StudyModel, element: Element): Pick<PlanElement, 'ioSlots' | 'inputs' | 'outputs'> {
  const ioSlots: Record<string, string> = {};
  const io = element.ioSpecification;
  for (const input of isElement(io) ? listIn(io.dataInputs) : []) if (isElement(input) && input.id) ioSlots[input.id] = typeof input.name === 'string' ? input.name : '';
  const compact = !isElement(io);
  const binding = (association: Element, lowered: boolean): Binding => {
    const transformation = association.transformation;
    const expression = expressionIn(transformation);
    const body = lowered ? splitBinding(expression?.body).selection : expression?.body;
    return {
      target: idOf(association.targetRef),
      transformation: body || null,
      language: (!lowered || body) && isElement(transformation) && typeof transformation.language === 'string' ? transformation.language : null,
    };
  };
  const used = new Set<string>();
  const inputs = listIn(element.dataInputAssociations).filter(isElement).flatMap((association) => {
    const sources = listIn(association.sourceRef).map(idOf).filter((source): source is string => !!source);
    if (!compact || association.targetRef !== undefined) return sources.map((source) => ({ source, ...binding(association, false) }));
    const first = model.get(sources[0]);
    const slot = splitBinding(expressionIn(association.transformation)?.body).slot
      || (typeof first?.name === 'string' && first.name) || sources[0] || 'input';
    const stem = `${element.id}_in_${slot.replace(/[^A-Za-z0-9_]+/g, '_')}`;
    let target = stem;
    for (let n = 2; used.has(target); n += 1) target = `${stem}_${n}`;
    used.add(target);
    ioSlots[target] = slot;
    return sources.map((source) => ({ source, ...binding(association, true), target }));
  });
  const outputs = listIn(element.dataOutputAssociations).filter(isElement)
    .map((association) => binding(association, compact && listIn(association.sourceRef).length === 0));
  return { ioSlots, inputs, outputs };
}

/** One element of a study model as a partial runner sees it: what its BPMN XML says, under local names. */
export function planElement(model: StudyModel, element: Element): PlanElement {
  const host = model.host(element);
  const { ioSlots, inputs, outputs } = dataAssociationsIn(model, element);
  const extensions = [model.typedEntry(element), ...model.entries(element)]
    .filter((entry): entry is Element => !!entry && entry.type !== PROV_ACTIVITY);
  const args = element.additionalArguments;
  const digest: PlanElement = {
    id: element.id!,
    type: tagIn(model, host),
    name: typeof element.name === 'string' ? element.name : null,
    attributes: attributesIn(model, element, host, new Set(['id', 'name'])),
    extensions: extensions.map((entry) => extensionIn(model, entry)),
    additionalArguments: args === undefined || args === null ? null : textIn(args).trim() || null,
    ioSlots,
    inputs,
    outputs,
    participants: listIn(element.participantRef).map(idOf).filter((id): id is string => !!id),
  };
  const definitions = listIn(element.eventDefinitions).filter(isElement);
  const condition = expressionIn(element.conditionExpression)
    ?? expressionIn(definitions.find((definition) => definition.type === 'bpmn:ConditionalEventDefinition')?.condition);
  if (condition) digest.condition = condition;
  const loop = loopIn(element.loopCharacteristics);
  if (loop) digest.loop = loop;
  if (definitions.length > 0) digest.events = definitions.map((definition) => tagIn(model, definition.type));
  const timed = definitions.find((definition) => definition.type === 'bpmn:TimerEventDefinition');
  if (timed) {
    const time = (value: Value | undefined): string | undefined => expressionIn(value)?.body;
    digest.timer = { duration: time(timed.timeDuration), date: time(timed.timeDate), cycle: time(timed.timeCycle) };
  }
  const multiplicity = element.participantMultiplicity;
  if (isElement(multiplicity) && typeof multiplicity.maximum === 'number') digest.multiplicity = multiplicity.maximum;
  const actor = element.type === 'studyflow:Actor' ? element : model.entries(element).find((entry) => entry.type === 'studyflow:Actor');
  if (actor?.memory === 'conversation') digest.memory = 'conversation';
  const extensionType = model.extensionType(element);
  const branching = extensionType && hasCatalog() ? getCatalog().getType(extensionType)?.meta?.branching : undefined;
  if (typeof branching === 'string') digest.branching = branching;
  return digest;
}

/** A study model's elements as a run reads them. */
export type ModelIndex = {
  processes: Element[];
  root: Element;
  study: Element | undefined;
  walked: Map<string, { element: Element; parent: Element }>;
  others: Element[];
};

export function modelIndexOf(model: StudyModel): ModelIndex {
  const roots = model.study.roots;
  const processes_ = roots.filter((root) => model.host(root) === 'bpmn:Process');
  const flows = (root: Element): Element[] => listIn(root.flowElements).filter(isElement);
  let walkable = processes_.filter((root) => flows(root).some((element) => model.host(element) === 'bpmn:SequenceFlow'));
  // A study of steps and no flow is walked from its one step (the walk refuses more than one).
  if (walkable.length === 0) walkable = processes_.filter((root) => flows(root).length > 0).slice(0, 1);
  if (walkable.length === 0) throw new Error('no process with a sequence flow to walk');
  const process = walkable.find((candidate) => model.studyOf(candidate)) ?? walkable[0];
  const root = roots.find((candidate) => model.studyOf(candidate)) ?? model.primaryRoot() ?? process;

  const walked: ModelIndex['walked'] = new Map();
  const index = (container: Element): void => {
    for (const element of [...listIn(container.properties), ...listIn(container.flowElements), ...listIn(container.artifacts)]) {
      if (!isElement(element) || !element.id) continue;
      walked.set(element.id, { element, parent: container });
      if (CONTAINERS.has(model.host(element))) index(element);
      // A plain element's properties are its own scope's (`Excluded (n={count})`).
      else for (const property of listIn(element.properties)) if (isElement(property) && property.id) walked.set(property.id, { element: property, parent: element });
    }
  };
  const processes = [process, ...walkable.filter((other) => other !== process)];
  for (const each of processes) index(each);

  const others = roots.flatMap((definition) => {
    const host = model.host(definition);
    if (host === 'bpmn:Message' || host === 'bpmn:ItemDefinition') return definition.id ? [definition] : [];
    if (host !== 'bpmn:Collaboration') return [];
    return [...listIn(definition.participants), ...listIn(definition.messageFlows)].filter((child): child is Element => isElement(child) && !!child.id);
  });
  return { processes, root, study: model.studyOf(root) ?? model.studyOf(process), walked, others };
}

/** The plan of a study model. */
/** The plan of a study: every element by id (pool participants, message flows, messages and item definitions
 * included), the study, and the processes to walk. */
export function planOf(model: StudyModel, { options = {}, sources = [] }: PlanOptions = {}): Plan {
  const { processes, root, study, walked, others } = modelIndexOf(model);
  const elements: Record<string, PlanElement> = {};
  for (const [id, { element, parent }] of walked) {
    const digest = planElement(model, element);
    digest.parent = parent.id;
    const read = wiredIn(model, element);
    if (read) {
      digest.parameters = read.rest;
      const ext = digest.extensions[0];
      if (ext) for (const [key, value] of Object.entries(read.attributes)) ext.attributes[key] = textIn(value as Value);
    }
    elements[id] = digest;
  }
  const names = boundNames(elements);
  for (const other of others) elements[other.id!] = planElement(model, other);

  const pool = others.find((other) => model.host(other) === 'bpmn:Participant' && other.processRef === processes[0].id);
  const seed = study?.seed;
  const nameOf = (element: Element | undefined): string | undefined => (typeof element?.name === 'string' && element.name ? element.name : undefined);
  return {
    protocol: PROTOCOL,
    options,
    study: {
      id: root.id ?? null,
      name: nameOf(root) || nameOf(processes[0]) || nameOf(pool) || root.id || null,
      seed: seed === undefined || seed === null ? null : String(seed),
      dependencies: listIn(study?.dependencies).map((spec) => String(spec).trim()).filter(Boolean),
    },
    sources,
    elements,
    names,
    processes: processes.map((walkedProcess) => walkedProcess.id!),
  };
}
