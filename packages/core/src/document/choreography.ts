import { BPMN } from '@core/constants';
import { definitionsOf } from '@core/element/attributes';
import { getProperty, moveProperties, setProperty, type ModdleElement, type Moddle } from '@core/element/moddle';
import { StudyflowElement } from '@core/element/handle';
import { getCatalog, hasCatalog } from '@core/notation';
import { applyXmlPasses, primaryRoot, isHeadlessCollaboration } from '@core/document/format';
import { attributeOverrides } from '@core/document/parameters';

const CHOREOGRAPHY_TASK = BPMN.ChoreographyTask;

export const DEFAULT_TOP = 'Participant A';
export const DEFAULT_BOTTOM = 'Participant B';

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

const CHOREOGRAPHY_FLOW_TYPES = new Set([
  CHOREOGRAPHY_TASK,
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:IntermediateCatchEvent',
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:ComplexGateway',
  'bpmn:EventBasedGateway',
  'bpmn:SequenceFlow',
]);

function isChoreographyTaskBo(el: ModdleElement | null | undefined): boolean {
  return el?.$type === CHOREOGRAPHY_TASK;
}

function isParticipantHolder(collaboration: any): boolean {
  const participants = collaboration.get('participants') ?? [];
  if (participants.length === 0) return false;
  if ((collaboration.get('messageFlows') ?? []).length > 0) return false;
  return participants.every((p: any) => p.$type === 'bpmn:Participant' && !p.get('processRef'));
}

function isPureChoreography(process: any): boolean {
  const flowElements = process?.flowElements ?? [];
  if (flowElements.length === 0) return false;
  if ((process.laneSets ?? []).length > 0 || (process.artifacts ?? []).length > 0) return false;
  let hasChoreographyTask = false;
  for (const el of flowElements) {
    if (!CHOREOGRAPHY_FLOW_TYPES.has(el.$type)) return false;
    // A typed one (a cognitive task, say) is a step of a process that happens to be an exchange, not a choreography.
    if (isChoreographyTaskBo(el) && isTypedChoreography(el)) return false;
    if (isChoreographyTaskBo(el)) hasChoreographyTask = true;
  }
  return hasChoreographyTask;
}

/** Specific to a root's own type: these must not travel when rewriting process <-> choreography. */
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

function participantIdFor(name: string, taken: Set<string>): string {
  const slug = name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed';
  return uniqueId(`Participant_${slug}`, taken);
}

function processToChoreographyRoot(definitions: any): boolean {
  const rootElements = definitions?.rootElements ?? [];
  const processes = rootElements.filter((re: any) => re.$type === 'bpmn:Process');
  const collaborations = rootElements.filter((re: any) => re.$type === 'bpmn:Collaboration');
  if (processes.length !== 1) return false;
  if (rootElements.length !== processes.length + collaborations.length) return false;
  if (!collaborations.every(isParticipantHolder)) return false;

  const process = processes[0];
  if (!isPureChoreography(process)) return false;

  const model = definitions.$model;
  const choreography = model.create('bpmn:Choreography', { id: process.id });
  if (process.name !== undefined) choreography.set('name', process.name);
  choreography.$parent = definitions;
  moveRootProperties(choreography, process);

  const takenIds = new Set<string>(
    [
      ...(process.flowElements ?? []),
      ...collaborations.flatMap((c: any) => c.get('participants') ?? []),
    ].map((el: any) => el.id).filter((id: any) => typeof id === 'string'),
  );
  const makeParticipant = (name: string): any =>
    model.create('bpmn:Participant', { id: participantIdFor(name, takenIds), name });

  const used: any[] = [];
  const messageFlows: any[] = [];
  for (const el of process.flowElements ?? []) {
    if (!isChoreographyTaskBo(el)) continue;

    const refs: any[] = (el.get('participantRef') ?? []).slice(0, 2);
    const top = refs[0] ?? makeParticipant(DEFAULT_TOP);
    const bottom = refs[1] ?? makeParticipant(DEFAULT_BOTTOM);
    el.set('participantRef', [top, bottom]);

    let initiating = el.get('initiatingParticipantRef');
    if (initiating !== top && initiating !== bottom) initiating = top;
    el.set('initiatingParticipantRef', initiating);
    const receiving = initiating === top ? bottom : top;

    for (const p of [top, bottom]) {
      if (!used.includes(p)) used.push(p);
      p.$parent = choreography;
    }

    const messageFlow = model.create('bpmn:MessageFlow', {
      id: uniqueId(`MessageFlow_${el.id}`, takenIds),
      sourceRef: initiating,
      targetRef: receiving,
    });
    messageFlow.$parent = choreography;
    el.set('messageFlowRef', [messageFlow]);
    messageFlows.push(messageFlow);
  }

  choreography.set('participants', used);
  choreography.set('messageFlows', messageFlows);
  moveProperties(choreography, process, ['flowElements']);

  definitions.rootElements = [
    choreography,
    ...rootElements.filter((re: any) => re !== process && !collaborations.includes(re)),
  ];
  retargetPlanes(definitions, process, choreography);
  return true;
}

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
    // Message flows die with the choreography root; `processToChoreographyRoot` rebuilds them on save.
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

/**
 * What saving applies to the definitions the canvas edits, in place: a pure choreography goes back to a choreography
 * root. The inverse of `fromWireDefinitions`; a Study writes its file from a copy this way, without XML. Whether it
 * changed anything.
 */
export function toWireDefinitions(definitions: any): boolean {
  return processToChoreographyRoot(definitions);
}

/** {@link toWireDefinitions} on XML text. */
export async function toWireXml(xml: string, moddle: Moddle): Promise<string> {
  return applyXmlPasses(xml, moddle, [processToChoreographyRoot]);
}
