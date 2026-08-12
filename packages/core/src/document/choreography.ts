import { BPMN } from '@core/constants';
import { getProperty, type ModdleElement, type Moddle } from '@core/element/moddle';
import { applyXmlPasses } from '@core/document/format';

const CHOREOGRAPHY_TASK = BPMN.ChoreographyTask;

export const DEFAULT_TOP = 'Participant A';
export const DEFAULT_BOTTOM = 'Participant B';

export function readChoreographyBands(
  bo: ModdleElement,
): { top: string; bottom: string; initiator: 'top' | 'bottom' } {
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
  moveOnto(target, source, names);

  for (const [name, value] of Object.entries(source.$attrs ?? {})) {
    if (OWN_STRUCTURE.has(name)) continue;
    target.$attrs[name] = value;
    delete source.$attrs[name];
  }
}

function moveOnto(target: any, source: any, props: string[]): void {
  const byName = source.$descriptor?.propertiesByName ?? {};
  for (const prop of props) {
    const value = source.get(prop);
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    // moddle materializes defaults on the prototype, so a default-equal value already reads back on the target.
    if (value === byName[prop]?.default) continue;
    target.set(prop, value);
    source.set(prop, undefined);
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && '$parent' in child) child.$parent = target;
    }
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
  moveOnto(choreography, process, ['flowElements']);

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

  moveOnto(process, choreography, ['flowElements']);

  // A Participant is not a RootElement: survivors need a headless Collaboration to stay resolvable, and with no DI plane bpmn-js draws no pool.
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

export async function fromWireXml(xml: string, moddle: Moddle): Promise<string> {
  return applyXmlPasses(xml, moddle, [choreographyToProcessRoot]);
}

export async function toWireXml(xml: string, moddle: Moddle): Promise<string> {
  return applyXmlPasses(xml, moddle, [processToChoreographyRoot]);
}
