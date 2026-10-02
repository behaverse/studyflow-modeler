/**
 * The passes that put a BPMN file's choreography in the form a study holds, and back: an exchange (a choreography task
 * in a process) written as the BPMN task it is. Another tool's choreography root is read as a process on the study
 * model (`choreographyToProcessIn`).
 */
import { BPMN } from '@core/constants';
import type { ModdleElement } from '@core/document/moddle';

const CHOREOGRAPHY_TASK = BPMN.ChoreographyTask;

function isChoreographyTaskBo(el: ModdleElement | null | undefined): boolean {
  return el?.$type === CHOREOGRAPHY_TASK;
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
