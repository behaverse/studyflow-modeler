/**
 * Spec-clean containment for choreography diagrams.
 *
 * BPMN 2.0 places choreography activities inside a `bpmn:Choreography` root
 * (a Collaboration that is also a FlowElementsContainer), with participants
 * declared on the choreography and referenced per task via `participantRef` /
 * `initiatingParticipantRef`. bpmn-js cannot host that root, so the canvas
 * always works on a `bpmn:Process` whose choreography tasks carry the
 * studyflow band attributes (`topParticipant`, `bottomParticipant`,
 * `initiator`) — and this module converts between the two forms at the
 * serialization boundary:
 *
 * - **save** (`processToChoreographyRoot` / `toWireXml`): when the process is
 *   a pure choreography (only choreography tasks, events, gateways, sequence
 *   flows), rewrite it as a `bpmn:Choreography` root with declared
 *   participants; band attributes become participantRef order (top first) and
 *   initiatingParticipantRef, and are dropped from the wire. Each task's
 *   exchange also becomes a `bpmn:MessageFlow` from the initiating to the
 *   receiving participant — declared on the root (`messageFlows`) and
 *   referenced from the task (`messageFlowRef`), completing the BPMN 2.0
 *   choreography metamodel shape.
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
 * The one band<->participant correspondence, written once so both directions
 * agree by construction:
 *
 *   - the two bands map to `participantRef` in order — top first, bottom second;
 *   - `initiator` ('top' | 'bottom') names which band is the
 *     `initiatingParticipantRef`; the other band receives.
 *
 * `bandsToRefs` (save) turns a resolved (top, bottom, initiator) triple into the
 * ref shape the wire declares; `refsToBands` (load) reads that shape back into
 * the band triple. They are exact inverses of each other.
 */
function bandsToRefs(
  top: any,
  bottom: any,
  initiator: 'top' | 'bottom',
): { participantRef: any[]; initiating: any; receiving: any } {
  const initiating = initiator === 'bottom' ? bottom : top;
  const receiving = initiating === top ? bottom : top;
  return { participantRef: [top, bottom], initiating, receiving };
}

function refsToBands(
  participantRef: any[],
  initiatingParticipantRef: any,
): { top: any; bottom: any; initiator: 'top' | 'bottom' } {
  const [top, bottom] = participantRef;
  // Only call it bottom-initiated when the ref unambiguously points at the
  // bottom band (a self-choreography where top === bottom stays top-initiated).
  const initiator: 'top' | 'bottom' =
    initiatingParticipantRef === bottom && bottom !== top ? 'bottom' : 'top';
  return { top, bottom, initiator };
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
 * `bpmn:Choreography` root. Returns true when the definitions were changed.
 */
export function processToChoreographyRoot(definitions: any): boolean {
  const rootElements = definitions?.rootElements ?? [];
  const processes = rootElements.filter((re: any) => re.$type === 'bpmn:Process');
  // A collaboration root (pools) or several processes: leave untouched.
  if (processes.length !== 1 || rootElements.length !== processes.length) return false;

  const process = processes[0];
  if (!isPureChoreography(process)) return false;

  const model = definitions.$model;
  const choreography = model.create('bpmn:Choreography', { id: process.id });
  if (process.name !== undefined) choreography.set('name', process.name);
  choreography.$parent = definitions;
  moveOnto(choreography, process, ['documentation', 'extensionElements']);

  // One declared participant per distinct band name; top band first per task.
  // Generated ids must stay clear of the ids already in the diagram.
  const byName = new Map<string, any>();
  const takenIds = new Set<string>(
    (process.flowElements ?? []).map((el: any) => el.id).filter((id: any) => typeof id === 'string'),
  );
  const participantFor = (name: string): any => {
    let participant = byName.get(name);
    if (!participant) {
      participant = model.create('bpmn:Participant', { id: participantIdFor(name, takenIds), name });
      participant.$parent = choreography;
      byName.set(name, participant);
    }
    return participant;
  };

  const messageFlows: any[] = [];
  for (const el of process.flowElements ?? []) {
    if (!isChoreographyTaskBo(el)) continue;
    // `get` resolves the schema defaults (Participant A/B, top) when unset.
    const top = participantFor(el.get('topParticipant') || 'Participant A');
    const bottom = participantFor(el.get('bottomParticipant') || 'Participant B');
    const { participantRef, initiating, receiving } = bandsToRefs(
      top,
      bottom,
      el.get('initiator') === 'bottom' ? 'bottom' : 'top',
    );
    el.set('participantRef', participantRef);
    el.set('initiatingParticipantRef', initiating);
    el.set('topParticipant', undefined);
    el.set('bottomParticipant', undefined);
    el.set('initiator', undefined);

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

  choreography.set('participants', [...byName.values()]);
  choreography.set('messageFlows', messageFlows);
  moveOnto(choreography, process, ['flowElements']);

  definitions.rootElements = rootElements.map((re: any) => (re === process ? choreography : re));
  retargetPlanes(definitions, process, choreography);
  return true;
}

/**
 * Load direction: rewrite a `bpmn:Choreography` root back to the process form
 * the canvas and runner operate on. Returns true when changed.
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
    const { top, bottom, initiator } = refsToBands(
      el.get('participantRef') ?? [],
      el.get('initiatingParticipantRef'),
    );
    if (top?.name) el.set('topParticipant', top.name);
    if (bottom?.name) el.set('bottomParticipant', bottom.name);
    if (initiator === 'bottom') el.set('initiator', 'bottom');
    el.set('participantRef', undefined);
    el.set('initiatingParticipantRef', undefined);
    // The message flows die with the choreography root; drop the references.
    el.set('messageFlowRef', undefined);
  }

  moveOnto(process, choreography, ['flowElements']);

  definitions.rootElements = rootElements.map((re: any) => (re === choreography ? process : re));
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
