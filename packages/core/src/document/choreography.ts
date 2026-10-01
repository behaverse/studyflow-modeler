import { BPMN } from '@core/constants';
import { definitionsOf } from '@core/element/attributes';
import { getProperty, moveProperties, setProperty, type ModdleElement, type Moddle } from '@core/element/moddle';
import { StudyflowElement } from '@core/element/handle';
import { getCatalog, hasCatalog } from '@core/notation';
import { applyXmlPasses, primaryRoot, isHeadlessCollaboration } from '@core/document/format';
import { attributeOverrides } from '@core/document/parameters';
import { DEFAULT_BOTTOM, DEFAULT_TOP } from '@core/model/choreography';

const CHOREOGRAPHY_TASK = BPMN.ChoreographyTask;

export { DEFAULT_BOTTOM, DEFAULT_TOP } from '@core/model/choreography';

/** The task's type wrapper, by the rule attribute reads use: a stamp such as a runner's `prov:activity` is not one. */
function typeWrapperOf(bo: ModdleElement): ModdleElement | null {
  return StudyflowElement.fromBusinessObject(bo).extension;
}

/** A typed choreography task (a cognitive task) presents itself; its one participant reference is the actor. */
export function isTypedChoreography(bo: ModdleElement): boolean {
  return typeWrapperOf(bo) !== null;
}

const DEFAULT_PRESENTER = 'Task software';

/**
 * What presents a typed task: its type's `meta.presenter`, a template over the extension's attributes
 * (`Behaverse - {instrument}`, `{platform}`), read raw, or as the Parameters wired into the task set them. A type
 * that declares none, or a template that comes out empty, presents as the study's software.
 */
export function presenterLabel(bo: ModdleElement): string {
  const ext = typeWrapperOf(bo);
  const template = hasCatalog() ? getCatalog().getType(ext?.$type)?.meta?.presenter : undefined;
  if (typeof template !== 'string') return DEFAULT_PRESENTER;
  const overrides = attributeOverrides(bo);
  const label = template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = overrides.get(name)?.value ?? ext?.[name] ?? ext?.$attrs?.[name];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }).trim();
  return label || DEFAULT_PRESENTER;
}

/** The actor a typed task names: its participant that does not initiate, else its first. */
export function actorOf(bo: ModdleElement): ModdleElement | undefined {
  const refs: ModdleElement[] = getProperty(bo, 'participantRef') ?? [];
  const initiating = getProperty(bo, 'initiatingParticipantRef');
  return refs.find((participant) => participant !== initiating) ?? refs[0];
}

/** What mints the ids of new participants and of the collaboration that holds them. */
export type ParticipantIds = { nextPrefixed(prefix: string): string };

/**
 * The element that owns `participants` for a choreography task: its enclosing `bpmn:Choreography` or, in a
 * process-rooted document, a `bpmn:Collaboration` among the root elements. One is created (with no DI plane, so its
 * participants live in the file without drawing) when neither exists.
 */
function participantHolder(bo: ModdleElement, ids: ParticipantIds): ModdleElement | undefined {
  const seen = new Set<ModdleElement>();
  for (let current = bo.$parent; current && !seen.has(current); current = current.$parent) {
    seen.add(current);
    if (Array.isArray(getProperty(current, 'participants'))) return current;
  }
  const definitions = definitionsOf(bo);
  if (!definitions?.$model?.create) return undefined;
  const roots: ModdleElement[] = getProperty(definitions, 'rootElements') ?? [];
  const existing = roots.find((root) => Array.isArray(getProperty(root, 'participants')));
  if (existing) return existing;
  const created = definitions.$model.create('bpmn:Collaboration', { id: ids.nextPrefixed('Collaboration_'), participants: [] });
  created.$parent = definitions;
  setProperty(definitions, 'rootElements', [...roots, created]);
  return created;
}

/** A new participant named `name`, filed with the task's other participants; `undefined` without a moddle factory. */
export function mintParticipant(bo: ModdleElement, name: string, ids: ParticipantIds): ModdleElement | undefined {
  const model = bo.$model ?? definitionsOf(bo)?.$model;
  const holder = model?.create ? participantHolder(bo, ids) : undefined;
  if (!holder) return undefined;
  const participant = model.create('bpmn:Participant', { id: ids.nextPrefixed('Participant_'), name });
  participant.$parent = holder;
  setProperty(holder, 'participants', [...(getProperty(holder, 'participants') ?? []), participant]);
  return participant;
}

/**
 * The `[top, bottom]` participants of a choreography task, minting what the document lacks: a plain
 * task gets two, the top one initiating unless the task names one; a typed task gets one, the actor
 * (both bands answer it), and no initiator, since the presenting side is the task itself. The writes go
 * straight onto moddle; the caller records the edit. `undefined` when there is no moddle factory.
 */
export function ensureChoreographyParticipants(bo: ModdleElement, ids: ParticipantIds): [ModdleElement, ModdleElement] | undefined {
  const list: ModdleElement[] = getProperty(bo, 'participantRef') ?? [];
  const typed = isTypedChoreography(bo);
  if (typed && list.length >= 1) {
    const actor = actorOf(bo)!;
    return [actor, actor];
  }
  if (list.length >= 2) return [list[0], list[1]];
  if (typed) {
    const actor = mintParticipant(bo, 'Participant', ids);
    if (!actor) return undefined;
    setProperty(bo, 'participantRef', [actor]);
    setProperty(bo, 'initiatingParticipantRef', undefined);
    return [actor, actor];
  }
  const top = list[0] ?? mintParticipant(bo, DEFAULT_TOP, ids);
  const bottom = list[1] ?? mintParticipant(bo, DEFAULT_BOTTOM, ids);
  if (!top || !bottom) return undefined;
  setProperty(bo, 'participantRef', [top, bottom]);
  setProperty(bo, 'initiatingParticipantRef', getProperty(bo, 'initiatingParticipantRef') ?? top);
  return [top, bottom];
}

export function readChoreographyBands(
  bo: ModdleElement,
): { top: string; bottom: string; initiator: 'top' | 'bottom' } {
  if (isTypedChoreography(bo)) {
    return { top: presenterLabel(bo), bottom: actorOf(bo)?.name || DEFAULT_BOTTOM, initiator: 'top' };
  }
  const refs = getProperty(bo, 'participantRef') ?? [];
  const top = refs[0];
  const bottom = refs[1];
  const initiating = getProperty(bo, 'initiatingParticipantRef');
  return {
    top: top?.name || DEFAULT_TOP,
    bottom: bottom?.name || DEFAULT_BOTTOM,
    initiator: initiating && initiating === bottom && bottom !== top ? 'bottom' : 'top',
  };
}

function isChoreographyTaskBo(el: ModdleElement | null | undefined): boolean {
  return el?.$type === CHOREOGRAPHY_TASK;
}

/** Specific to a root's own type: these must not travel when a choreography is read as a process. */
const OWN_STRUCTURE = new Set([
  'flowElements', 'id', 'name', 'participants', 'messageFlows', 'isExecutable',
]);

function moveRootProperties(target: any, source: any): void {
  const targetByName = target.$descriptor?.propertiesByName ?? {};
  const names: string[] = [];
  for (const p of source.$descriptor?.properties ?? []) {
    if (OWN_STRUCTURE.has(p.name) || !targetByName[p.name]) continue;
    names.push(p.name);
  }
  moveProperties(target, source, names);

  for (const [name, value] of Object.entries(source.$attrs ?? {})) {
    if (OWN_STRUCTURE.has(name)) continue;
    target.$attrs[name] = value;
    delete source.$attrs[name];
  }
}

function retargetPlanes(definitions: any, from: any, to: any): void {
  for (const diagram of definitions.diagrams ?? []) {
    if (diagram.plane?.bpmnElement === from) diagram.plane.bpmnElement = to;
  }
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  taken.add(id);
  return id;
}

/** A `bpmn:Choreography` root, from another tool's file, read as the process a study is: its choreography tasks are
 * exchanges in a process, their participants held by a collaboration with no pool. */
export function choreographyToProcessRoot(definitions: any): boolean {
  const rootElements = definitions?.rootElements ?? [];
  const choreography = rootElements.find((re: any) => re.$type === 'bpmn:Choreography');
  if (!choreography) return false;

  const model = definitions.$model;
  const process = model.create('bpmn:Process', { id: choreography.id, isExecutable: false });
  if (choreography.name !== undefined) process.set('name', choreography.name);
  process.$parent = definitions;
  moveRootProperties(process, choreography);

  for (const el of choreography.flowElements ?? []) {
    if (!isChoreographyTaskBo(el)) continue;
    // A study is a process: the choreography's message flows go with its root, and each task keeps its bands.
    el.set('messageFlowRef', undefined);
  }

  moveProperties(process, choreography, ['flowElements']);

  // A Participant is not a RootElement: survivors need a headless Collaboration to stay resolvable, and with no DI plane no pool is drawn.
  const newRoots = rootElements.map((re: any) => (re === choreography ? process : re));
  const participants = choreography.get('participants') ?? [];
  if (participants.length > 0) {
    const taken = new Set<string>(newRoots.map((re: any) => re.id).filter(Boolean));
    const collaboration = model.create('bpmn:Collaboration', {
      id: uniqueId(`${choreography.id}_participants`, taken),
      participants,
    });
    collaboration.$parent = definitions;
    for (const p of participants) p.$parent = collaboration;
    choreography.set('participants', undefined);
    newRoots.push(collaboration);
  }
  definitions.rootElements = newRoots;
  retargetPlanes(definitions, choreography, process);
  return true;
}

/** A plane naming a collaboration with no pool draws the process's flow: point it at the process, the root everywhere else. */
export function headlessPlaneToProcessRoot(definitions: any): boolean {
  const plane = definitions?.diagrams?.[0]?.plane;
  if (!isHeadlessCollaboration(plane?.bpmnElement)) return false;
  const root = primaryRoot(definitions);
  if (!root || root === plane.bpmnElement) return false;
  plane.bpmnElement = root;
  return true;
}

/** Every moddle element `root` holds, itself included, reached through what each contains. */
function* contained(root: any, seen = new Set<any>()): Generator<any> {
  if (!root || typeof root !== 'object' || !root.$type || seen.has(root)) return;
  seen.add(root);
  yield root;
  for (const p of root.$descriptor?.properties ?? []) {
    if (p.isReference) continue;
    const value = root[p.name];
    for (const child of Array.isArray(value) ? value : [value]) yield* contained(child, seen);
  }
}

/** Swap `from` for `to` in every reference the definitions hold, the diagram's included. */
function retarget(definitions: any, from: any, to: any): void {
  for (const element of contained(definitions)) {
    for (const p of element.$descriptor?.properties ?? []) {
      if (!p.isReference) continue;
      const value = element[p.name];
      if (value === from) element[p.name] = to;
      else if (Array.isArray(value) && value.includes(from)) element[p.name] = value.map((ref: any) => (ref === from ? to : ref));
    }
  }
}

/** `to` takes what `from` holds that its type declares too, references as they are, contained elements re-parented. */
function transplant(to: any, from: any, skip: Set<string>): void {
  const declared = to.$descriptor?.propertiesByName ?? {};
  for (const p of from.$descriptor?.properties ?? []) {
    const value = from[p.name];
    if (skip.has(p.name) || !declared[p.name] || value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    if (!Object.prototype.hasOwnProperty.call(from, p.name)) continue; // a default, not a value
    to.set(p.name, value);
    if (!p.isReference) for (const child of Array.isArray(value) ? value : [value]) if (child?.$type) child.$parent = to;
  }
  Object.assign(to.$attrs, from.$attrs);
}

/** A task that swaps its type for another, in the same place of its container and of every reference to it. */
function retype(definitions: any, from: any, type: string, skip: Set<string>): any {
  const to = definitions.$model.create(type, { id: from.id });
  transplant(to, from, skip);
  const container = from.$parent;
  to.$parent = container;
  container.set('flowElements', container.get('flowElements').map((el: any) => (el === from ? to : el)));
  retarget(definitions, from, to);
  return to;
}

const EXCHANGE_OWN = new Set(['participantRef', 'initiatingParticipantRef', 'messageFlowRef', 'exchange', 'participants', 'initiator']);

/**
 * The BPMN XML of a choreography task inside a process: BPMN defines choreography tasks only in a choreography, and
 * gives them no data. So the XML writes one as a `bpmn:task`, which may read and write data, marked
 * `studyflow:exchange`, with its bands as `studyflow:participants` and `studyflow:initiator`; {@link tasksToExchanges}
 * draws it back. Whether it changed any.
 */
export function exchangesToTasks(definitions: any): boolean {
  const exchanges = [...contained(definitions)].filter((el) => isChoreographyTaskBo(el) && el.$parent?.$type !== 'bpmn:Choreography');
  for (const exchange of exchanges) {
    const task = retype(definitions, exchange, 'bpmn:Task', EXCHANGE_OWN);
    task.set('exchange', true);
    const participants = exchange.get('participantRef') ?? [];
    if (participants.length > 0) task.set('participants', participants);
    if (exchange.get('initiatingParticipantRef')) task.set('initiator', exchange.get('initiatingParticipantRef'));
  }
  return exchanges.length > 0;
}

/** A task the BPMN XML wrote for a choreography task in a process ({@link exchangesToTasks}), known by its mark, back
 * as the choreography task the canvas edits. */
export function tasksToExchanges(definitions: any): boolean {
  const tasks = [...contained(definitions)].filter((el) => el.$type === 'bpmn:Task' && el.get('exchange') === true);
  for (const task of tasks) {
    const exchange = retype(definitions, task, CHOREOGRAPHY_TASK, EXCHANGE_OWN);
    const participants = task.get('participants') ?? [];
    if (participants.length > 0) exchange.set('participantRef', participants);
    if (task.get('initiator')) exchange.set('initiatingParticipantRef', task.get('initiator'));
  }
  return tasks.length > 0;
}

/** The BPMN XML of a study: a choreography task in a process as the BPMN task it is ({@link exchangesToTasks}). */
export async function toWireXml(xml: string, moddle: Moddle): Promise<string> {
  return applyXmlPasses(xml, moddle, [exchangesToTasks]);
}
