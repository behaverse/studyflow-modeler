/**
 * Spec-clean containment for choreography diagrams.
 *
 * BPMN 2.0 places choreography activities inside a `bpmn:Choreography` root
 * (a Collaboration that is also a FlowElementsContainer), with participants
 * declared on the choreography and referenced per task via `participantRef` /
 * `initiatingParticipantRef`. bpmn-js cannot host that root, so the canvas
 * works on a `bpmn:Process`. Participants and their references are BPMN's own —
 * there are no studyflow band attributes; the only accommodation for the
 * missing choreography root is *where the participants live*:
 *
 * - **wire** (`bpmn:Choreography` root): participants declared on the
 *   choreography; each task carries native `participantRef` (top band first,
 *   bottom second), `initiatingParticipantRef`, and a `messageFlowRef` to a
 *   `bpmn:MessageFlow` (initiating → receiving) declared on the root.
 * - **canvas** (`bpmn:Process` root): the same tasks keep their native
 *   `participantRef` / `initiatingParticipantRef`; the `bpmn:Participant`
 *   elements move into a headless `bpmn:Collaboration` root element that has no
 *   DI (a Process cannot own participants, and a Participant is not a
 *   `RootElement`, so it needs a Collaboration container — bpmn-js keeps the
 *   collaboration and resolves the refs but draws no pool for a plane-less
 *   collaboration; the renderer paints the participants as bands). Message
 *   flows die with the choreography root and are rebuilt on save.
 *
 * - **save** (`processToChoreographyRoot` / `toWireXml`): a pure-choreography
 *   process is rewritten as a `bpmn:Choreography` root; the participant root
 *   elements move onto it, the message flows are rebuilt, and any task never
 *   given participants gets two defaults.
 * - **load** (`choreographyToProcessRoot` / `fromWireXml`): the inverse.
 *
 * Mixed diagrams (choreography tasks alongside plain tasks, pools, or data)
 * keep the process containment — BPMN has no standard way to embed an
 * interaction in a process flow, so that mix is inherently a studyflow
 * extension and is serialized as such.
 *
 * Like `parseStudyflow`, this treats moddle strictly as the XML codec.
 */

const CHOREOGRAPHY_TASK = 'bpmn:ChoreographyTask';

/** Default participant names for a choreography task that was never given any. */
export const DEFAULT_TOP = 'Participant A';
export const DEFAULT_BOTTOM = 'Participant B';

/**
 * Read a choreography task's two band names and which one initiates, straight
 * from BPMN's native `participantRef` (top first, bottom second) and
 * `initiatingParticipantRef`. Shared by the modeler renderer and the runner
 * view so both read the same native fields; falls back to defaults for a task
 * that has no participants yet. Accepts a moddle business object.
 */
export function readChoreographyBands(
  bo: any,
): { top: string; bottom: string; initiator: 'top' | 'bottom' } {
  const refs = (typeof bo?.get === 'function' ? bo.get('participantRef') : bo?.participantRef) ?? [];
  const top = refs[0];
  const bottom = refs[1];
  const initiating = typeof bo?.get === 'function'
    ? bo.get('initiatingParticipantRef')
    : bo?.initiatingParticipantRef;
  return {
    top: top?.name || DEFAULT_TOP,
    bottom: bottom?.name || DEFAULT_BOTTOM,
    // Bottom-initiated only when the ref unambiguously points at the bottom band.
    initiator: initiating && initiating === bottom && bottom !== top ? 'bottom' : 'top',
  };
}

/** Flow-element types allowed in a BPMN choreography. */
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

function isChoreographyTaskBo(el: any): boolean {
  return el?.$type === CHOREOGRAPHY_TASK;
}

/**
 * True for the headless collaboration that only holds choreography participants
 * (bare participants — no pools with a `processRef`, no message flows). Keeps
 * the save path from mistaking a real pool collaboration for one of ours.
 */
function isParticipantHolder(collaboration: any): boolean {
  const participants = collaboration.get('participants') ?? [];
  if (participants.length === 0) return false;
  if ((collaboration.get('messageFlows') ?? []).length > 0) return false;
  return participants.every((p: any) => p.$type === 'bpmn:Participant' && !p.get('processRef'));
}

/** True when every flow element fits a choreography and at least one is a choreography task. */
function isPureChoreography(process: any): boolean {
  const flowElements = process?.flowElements ?? [];
  if (flowElements.length === 0) return false;
  if ((process.laneSets ?? []).length > 0 || (process.artifacts ?? []).length > 0) return false;
  let hasChoreographyTask = false;
  for (const el of flowElements) {
    if (!CHOREOGRAPHY_FLOW_TYPES.has(el.$type)) return false;
    if (isChoreographyTaskBo(el)) hasChoreographyTask = true;
  }
  return hasChoreographyTask;
}

function moveOnto(target: any, source: any, props: string[]): void {
  for (const prop of props) {
    const value = source.get(prop);
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    target.set(prop, value);
    source.set(prop, undefined);
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && '$parent' in child) child.$parent = target;
    }
  }
}

/** Retarget every DI plane pointing at `from` to `to`. */
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

/**
 * Save direction: rewrite a pure-choreography `bpmn:Process` root as a
 * `bpmn:Choreography` root. The participant elements that lived beside the
 * process (put there on load, or materialized by the modeler while editing)
 * move onto the choreography; message flows are rebuilt; a task that was never
 * given participants gets two defaults. Returns true when changed.
 */
export function processToChoreographyRoot(definitions: any): boolean {
  const rootElements = definitions?.rootElements ?? [];
  const processes = rootElements.filter((re: any) => re.$type === 'bpmn:Process');
  const collaborations = rootElements.filter((re: any) => re.$type === 'bpmn:Collaboration');
  // Exactly one process, whose only companions are the headless participant-
  // holding collaborations (bare participants, no pools/message flows): a real
  // pool collaboration or several processes are left untouched.
  if (processes.length !== 1) return false;
  if (rootElements.length !== processes.length + collaborations.length) return false;
  if (!collaborations.every(isParticipantHolder)) return false;

  const process = processes[0];
  if (!isPureChoreography(process)) return false;

  const model = definitions.$model;
  const choreography = model.create('bpmn:Choreography', { id: process.id });
  if (process.name !== undefined) choreography.set('name', process.name);
  choreography.$parent = definitions;
  moveOnto(choreography, process, ['documentation', 'extensionElements']);

  const takenIds = new Set<string>(
    [
      ...(process.flowElements ?? []),
      ...collaborations.flatMap((c: any) => c.get('participants') ?? []),
    ].map((el: any) => el.id).filter((id: any) => typeof id === 'string'),
  );
  const makeParticipant = (name: string): any =>
    model.create('bpmn:Participant', { id: participantIdFor(name, takenIds), name });

  // Participants actually referenced by a task, in first-seen order, so the
  // choreography declares exactly what it uses (dropping any orphans).
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

    // The exchange itself: initiating participant -> receiving participant.
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
  moveOnto(choreography, process, ['flowElements']);

  // Choreography replaces the process; the headless participant collaborations
  // are consumed (their participants now live on the choreography).
  definitions.rootElements = [
    choreography,
    ...rootElements.filter((re: any) => re !== process && !collaborations.includes(re)),
  ];
  retargetPlanes(definitions, process, choreography);
  return true;
}

/**
 * Load direction: rewrite a `bpmn:Choreography` root back to the process form
 * the canvas and runner operate on. The declared participants move out to
 * `definitions.rootElements` so the process's tasks can still reference them;
 * the native `participantRef` / `initiatingParticipantRef` are left intact.
 * Returns true when changed.
 */
export function choreographyToProcessRoot(definitions: any): boolean {
  const rootElements = definitions?.rootElements ?? [];
  const choreography = rootElements.find((re: any) => re.$type === 'bpmn:Choreography');
  if (!choreography) return false;

  const model = definitions.$model;
  const process = model.create('bpmn:Process', { id: choreography.id, isExecutable: false });
  if (choreography.name !== undefined) process.set('name', choreography.name);
  process.$parent = definitions;
  moveOnto(process, choreography, ['documentation', 'extensionElements']);

  for (const el of choreography.flowElements ?? []) {
    if (!isChoreographyTaskBo(el)) continue;
    // Message flows die with the choreography root; rebuilt on save.
    el.set('messageFlowRef', undefined);
  }

  moveOnto(process, choreography, ['flowElements']);

  // Participants outlive the choreography root inside a headless collaboration
  // (a Participant is not a RootElement, so it needs a Collaboration container),
  // so the canvas Process keeps its `participantRef`s resolvable. No DI plane
  // targets it, so bpmn-js draws no pool.
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

/** Sniff guards: skip the moddle round trip when the form cannot apply. */
const WIRE_SNIFF = /choreography[\s>]/i;
const CANVAS_SNIFF = /choreographyTask/i;

/** Load-side XML wrapper: `bpmn:Choreography` root -> canvas process form. */
export async function fromWireXml(xml: string, moddle: any): Promise<string> {
  if (!WIRE_SNIFF.test(xml)) return xml;
  const { rootElement } = await moddle.fromXML(xml);
  if (!choreographyToProcessRoot(rootElement)) return xml;
  return (await moddle.toXML(rootElement, { format: true })).xml;
}

/** Save-side XML wrapper: pure-choreography process form -> spec-clean root. */
export async function toWireXml(xml: string, moddle: any): Promise<string> {
  if (!CANVAS_SNIFF.test(xml)) return xml;
  const { rootElement } = await moddle.fromXML(xml);
  if (!processToChoreographyRoot(rootElement)) return xml;
  return (await moddle.toXML(rootElement, { format: true })).xml;
}
