import { idOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index';
import type { FlowNode } from '@runner/flow';
import type { Session } from '@runner/session';
import { BEHAVERSE_TASK_TYPE, WHO_ANSWERS_KEYS, type BehaverseTaskPayload } from '@skills/behaverse/browser/types';

/** Who is running what: Unity stamps these onto every event it records. */
export function withRunIdentity(
  payload: BehaverseTaskPayload,
  session: Session,
): BehaverseTaskPayload {
  const { agentId, sessionId, studyflow } = session;
  return {
    ...payload,
    ...(agentId ? { agent: { id: agentId } } : {}),
    ...(studyflow.studyId ? { studyId: studyflow.studyId } : {}),
    ...(studyflow.studyflowId ? { studyflowId: studyflow.studyflowId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(studyflow.studyflowHash ? { studyflowHash: studyflow.studyflowHash } : {}),
  };
}

/** An attribute of a step as text: what its schema entry holds, or a raw `cognitive:` one the file spells. */
export function readBehaverseAttribute(model: StudyModel, element: Element, attributeName: string): string | undefined {
  for (const value of [model.attributeOrDefault(element, attributeName), element[`cognitive:${attributeName}`]]) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function getBehaverseTaskPayload(node: FlowNode): BehaverseTaskPayload | null {
  if (node.extensionType !== BEHAVERSE_TASK_TYPE) return null;
  // The page plays the Unity build; the Godot one has no web export here yet.
  if (readBehaverseAttribute(node.model, node.element, 'runtime') === 'godot') {
    throw new Error(`behaverse:Task '${node.id}' is set to the Godot build (runtime: godot), which the browser runner cannot play yet. Set runtime to unity.`);
  }

  const instrument = readBehaverseAttribute(node.model, node.element, 'instrument') ?? '';
  if (!instrument || instrument === 'undefined') {
    throw new Error(
      `behaverse:Task '${node.id}' has no instrument, so the browser runner cannot tell which task to load. `
      + 'Set instrument to a task the Unity build ships.',
    );
  }
  // The task's `timeline` is the one place that says what runs; it keys the bridge's completion matcher too.
  const timeline = readBehaverseAttribute(node.model, node.element, 'timeline');
  if (!timeline) {
    throw new Error(
      `behaverse:Task '${node.id}' names no timeline, so it has no trials to run. `
      + 'Set timeline to one the build ships for the instrument (e.g. XCIT_NB_01), or to one the Parameters wired into it define under Timelines.',
    );
  }

  // The task's GameConfig is what the Parameters wired into it say, merged.
  const parameters = { ...node.parameters };
  // `Bot:` is not GameConfig: it says how a bot plays the task, and goes to Unity as the payload's own `bot`.
  const authoredBot = parameters.Bot;
  delete parameters.Bot;
  const botSettings = authoredBot && typeof authoredBot === 'object' && !Array.isArray(authoredBot)
    ? { ...(authoredBot as Record<string, unknown>) }
    : undefined;
  const authored = WHO_ANSWERS_KEYS.filter((key) => botSettings && key in botSettings);
  if (authored.length > 0) {
    throw new Error(
      `behaverse:Task '${node.id}': \`Bot:\` sets how the build's bot plays, not who answers (${authored.join(', ')}). `
      + 'Draw who takes the task instead: the participant on its band, or the pool its message flows reach.',
    );
  }

  // Who takes the task is its participant (band, message flow, or pool): a person, or a bot of some kind.
  const actor = actorOf(node.model, node.element);
  const agentType: 'human' | 'bot' = actor.kind && actor.kind !== 'human' ? 'bot' : 'human';

  // `scene` is the wire's name for the instrument (Unity's `Activity.Scene`).
  const payload: BehaverseTaskPayload = {
    scene: instrument,
    timeline,
    agentType,
    configMode: 'builtin',
    metadata: { studyflowNodeId: node.id },
  };

  // `Timelines` defines timelines; Unity null-merges `parameters` over the build's own, so an empty entry would erase one, not name it.
  const timelines = parameters.Timelines as Record<string, unknown> | undefined;
  if (timelines && typeof timelines === 'object') {
    const empty = Object.keys(timelines).filter((name) => timelines[name] == null);
    if (empty.length > 0) {
      throw new Error(
        `behaverse:Task '${node.id}' defines no timeline called ${empty.join(', ')}: `
        + 'Timelines defines timelines; the one that runs is the task\'s timeline.',
      );
    }
  }
  if (Object.keys(parameters).length > 0) {
    payload.configMode = 'inline';
    payload.parameters = parameters;
  }

  if (agentType === 'bot') {
    const bot = botSettings ?? {};
    if (actor.kind === 'llm') {
      // The model on the band answers each trial, told what the Prompt wired into the task says.
      const [provider, model] = splitModel(actor.model, node.id);
      bot.ResponseSource = 'llm';
      bot.LLM = { Provider: provider, Model: model };
      const prompt = promptOf(node.model, node.element);
      if (prompt) bot.Prompt = prompt;
    } else if (!(actor.kind === 'software' && actor.model === 'behaverse://bot')) {
      // Anyone else answers along the task's message flows, which only the local runtime carries.
      throw new Error(
        `'${node.id}' is taken by a ${actor.kind} participant, which answers over message flows in the local runtime. `
        + 'The browser runner plays a person, a model on the task\'s band, or the build\'s random bot (software, `implementation: behaverse://bot`).',
      );
    }
    if (Object.keys(bot).length > 0) payload.bot = bot;
  }

  return payload;
}

type Actor = { kind: string; model: string };

/** Who takes the task, from what the diagram draws, most explicit first: the task's receiving band; else the
 * other end of a message flow touching it (a pool, or a step's pool); else the pool the task sits in. A
 * `reachy:Robot` is a robot; a `studyflow:Actor` is what its `actorType` says, with its `implementation` as the
 * model. `kind` is empty when no one is named any of those ways. */
export function actorOf(model: StudyModel, task: Element): Actor {
  const initiating = idOf(task.initiatingParticipantRef);
  let candidates = listIn(task.participantRef).map(idOf).filter((id) => id && id !== initiating)
    .map((id) => model.get(id!)).filter((participant): participant is Element => !!participant);
  if (candidates.length === 0) candidates = messagePartnersOf(model, task);
  if (candidates.length === 0) candidates = poolsOf(model, task);
  for (const participant of candidates) {
    for (const typed of [participant, ...model.entries(participant)]) {
      const type = typed.type.toLowerCase();
      if (type === 'reachy:robot') return { kind: 'robot', model: '' };
      if (type === 'studyflow:actor') {
        const read = (name: string): Value | undefined => typed[name] ?? model.attributeOrDefault(participant, name);
        return { kind: String(read('actorType') ?? 'human'), model: String(read('implementation') ?? '') };
      }
    }
  }
  return { kind: '', model: '' };
}

const listIn = (value: Value | undefined): Value[] => (Array.isArray(value) ? value : []);

function processOf(model: StudyModel, element: Element): Element | undefined {
  let process = model.parentOf(element);
  while (process && model.host(process) !== 'bpmn:Process') process = model.parentOf(process);
  return process;
}

function collaborationsOf(model: StudyModel): Element[] {
  return model.study.roots.filter((root) => model.host(root) === 'bpmn:Collaboration');
}

/** The participants whose pool holds the element: outward to its process, then every participant naming it. */
function poolsOf(model: StudyModel, element: Element): Element[] {
  const process = processOf(model, element);
  if (!process) return [];
  return collaborationsOf(model)
    .flatMap((collaboration) => listIn(collaboration.participants).filter(isElement))
    .filter((participant) => idOf(participant.processRef) === process.id);
}

// The messages a task exchanges, as a message flow's `messageRef` → `itemRef` → `structureRef` names them.
const TRIAL = 'behaverse:Trial';
const RESPONSE = 'behaverse:Response';

/** What a message flow carries: its message's item definition (`structureRef`), '' when it names none. */
function messageStructureOf(model: StudyModel, flow: Element): string {
  const message = model.get(idOf(flow.messageRef) ?? undefined);
  return String(model.get(idOf(message?.itemRef) ?? undefined)?.structureRef ?? '');
}

/** The participants at the other end of the message flows touching the element: a pool itself, or a step's pool.
 * A flow that names its message outranks one that does not, and counts only when it carries a trial out of the
 * task or a response back into it; more than one partner left is an ambiguity to fix in the diagram, not an order to guess. */
function messagePartnersOf(model: StudyModel, element: Element): Element[] {
  const typed: Element[] = [];
  const untyped: Element[] = [];
  for (const flow of collaborationsOf(model).flatMap((collaboration) => listIn(collaboration.messageFlows).filter(isElement))) {
    const source = idOf(flow.sourceRef);
    const target = idOf(flow.targetRef);
    if (source !== element.id && target !== element.id) continue;
    const outgoing = source === element.id;
    const structure = messageStructureOf(model, flow);
    if (structure && structure !== TRIAL && structure !== RESPONSE) continue; // another skill's exchange
    if (structure && (structure === TRIAL) !== outgoing) {
      throw new Error(`message flow '${flow.id}' carries ${structure} the wrong way: trials leave the task, responses come back`);
    }
    const other = model.get((outgoing ? target : source) ?? undefined);
    const into = structure ? typed : untyped;
    for (const participant of !other ? [] : model.host(other) === 'bpmn:Participant' ? [other] : poolsOf(model, other)) {
      if (!into.includes(participant)) into.push(participant);
    }
  }
  const partners = typed.length > 0 ? typed : untyped;
  if (partners.length > 1) {
    throw new Error(`${element.id} exchanges messages with ${partners.map((p) => p.id).join(', ')}: name the message each flow `
      + `carries (messageRef, ${TRIAL} or ${RESPONSE}), or keep one partner`);
  }
  return partners;
}

/** The `agentic:Prompt` data object wired into the task, as its template text. */
export function promptOf(model: StudyModel, task: Element): string {
  for (const association of listIn(task.dataInputAssociations).filter(isElement)) {
    for (const ref of listIn(association.sourceRef)) {
      const source = model.get(idOf(ref) ?? undefined);
      if (source && [source, ...model.entries(source)].some((typed) => typed.type.toLowerCase() === 'agentic:prompt')) {
        return String(model.attributeOrDefault(source, 'template') ?? '');
      }
    }
  }
  return '';
}

/** `claude://<model>` or `ollama://<model>`, as the actor's `implementation` writes it; there is no default. */
export function splitModel(ref: string, taskId: string): ['claude' | 'ollama', string] {
  const [, provider, model] = /^(claude|ollama):\/\/(.+)$/.exec(ref) ?? [];
  if (!model) {
    throw new Error(`The model taking '${taskId}' names none it can call: set its implementation to claude://<model> or ollama://<model>.`);
  }
  return [provider as 'claude' | 'ollama', model];
}
