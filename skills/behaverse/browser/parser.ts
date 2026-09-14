import { getAttribute } from '@core/element';
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

export function readBehaverseAttribute(bo: any, attributeName: string): string | undefined {
  const resolved = getAttribute(bo, attributeName);
  if (typeof resolved === 'string' && resolved.length > 0) return resolved;

  const rawAttrs = bo?.$attrs;
  if (rawAttrs && typeof rawAttrs === 'object') {
    const namespaced = rawAttrs[`cognitive:${attributeName}`];
    if (typeof namespaced === 'string' && namespaced.length > 0) return namespaced;
    const bare = rawAttrs[attributeName];
    if (typeof bare === 'string' && bare.length > 0) return bare;
  }

  return undefined;
}

export function getBehaverseTaskPayload(node: FlowNode): BehaverseTaskPayload | null {
  if (node.extensionType !== BEHAVERSE_TASK_TYPE) return null;

  const scene = readBehaverseAttribute(node.businessObject, 'scene') ?? '';
  if (!scene || scene === 'undefined') {
    throw new Error(
      `behaverse:Task '${node.id}' has no scene, so the browser runner cannot tell which task to load. `
      + 'Set scene to a task the Unity build ships.',
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
  const actor = actorOf(node.businessObject);
  const agentType: 'human' | 'bot' = actor.kind && actor.kind !== 'human' ? 'bot' : 'human';

  const payload: BehaverseTaskPayload = {
    scene,
    agentType,
    configMode: 'builtin',
    metadata: { studyflowNodeId: node.id },
  };

  // First timeline key names what Unity runs and keys the bridge's completion matcher.
  const timelines = parameters.Timelines as Record<string, unknown> | undefined;
  if (timelines && typeof timelines === 'object') {
    const firstTimelineKey = Object.keys(timelines)[0];
    if (firstTimelineKey) payload.timeline = firstTimelineKey;
    // Unity null-merges `parameters` over Resources/<scene>.json, so a `{Name: null}` entry would erase that timeline.
    const inlineTimelines = Object.fromEntries(
      Object.entries(timelines).filter(([, definition]) => definition != null),
    );
    if (Object.keys(inlineTimelines).length > 0) parameters.Timelines = inlineTimelines;
    else delete parameters.Timelines;
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
      const prompt = promptOf(node.businessObject);
      if (prompt) bot.Prompt = prompt;
    } else if (!(actor.kind === 'software' && actor.model === 'random')) {
      // Anyone else answers along the task's message flows, which only the local runtime carries.
      throw new Error(
        `'${node.id}' is taken by a ${actor.kind} participant, which answers over message flows in the local runtime. `
        + 'The browser runner plays a person, a model on the task\'s band, or the build\'s random bot (software, `implementation: random`).',
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
export function actorOf(bo: any): Actor {
  const initiating = bo?.initiatingParticipantRef;
  let candidates = ((bo?.participantRef ?? []) as any[]).filter((p) => p && p !== initiating);
  if (candidates.length === 0) candidates = messagePartnersOf(bo);
  if (candidates.length === 0) candidates = poolsOf(bo);
  for (const participant of candidates) {
    for (const ext of (participant.extensionElements?.values ?? []) as any[]) {
      const type = String(ext?.$type ?? '').toLowerCase();
      if (type === 'reachy:robot') return { kind: 'robot', model: '' };
      if (type === 'studyflow:actor') {
        // Read through the participant: the catalog resolves a wrapper's attributes from its element.
        return {
          kind: String(getAttribute(participant, 'actorType') ?? 'human'),
          model: String(getAttribute(participant, 'implementation') ?? ''),
        };
      }
    }
  }
  return { kind: '', model: '' };
}

function processOf(bo: any): any {
  let process = bo?.$parent;
  while (process && process.$type !== 'bpmn:Process') process = process.$parent;
  return process;
}

function collaborationsOf(bo: any): any[] {
  let definitions = bo;
  while (definitions && definitions.$type !== 'bpmn:Definitions') definitions = definitions.$parent;
  return (definitions?.rootElements ?? []).filter((root: any) => root?.$type === 'bpmn:Collaboration');
}

/** The participants whose pool holds the element: outward to its process, then every participant naming it. */
function poolsOf(bo: any): any[] {
  const process = processOf(bo);
  if (!process) return [];
  return collaborationsOf(bo)
    .flatMap((collaboration: any) => collaboration.participants ?? [])
    .filter((participant: any) => participant?.processRef === process);
}

// The messages a task exchanges, as a message flow's `messageRef` → `itemRef` → `structureRef` names them.
const TRIAL = 'behaverse:Trial';
const RESPONSE = 'behaverse:Response';

/** What a message flow carries: its message's item definition (`structureRef`), '' when it names none. */
function messageStructureOf(flow: any): string {
  return String(flow?.messageRef?.itemRef?.structureRef ?? '');
}

/** The participants at the other end of the message flows touching the element: a pool itself, or a step's pool.
 * A flow that names its message outranks one that does not, and counts only when it carries a trial out of the
 * task or a response back into it; more than one partner left is an ambiguity to fix in the diagram, not an order to guess. */
function messagePartnersOf(bo: any): any[] {
  const typed: any[] = [];
  const untyped: any[] = [];
  for (const flow of collaborationsOf(bo).flatMap((collaboration: any) => collaboration.messageFlows ?? [])) {
    if (flow?.sourceRef !== bo && flow?.targetRef !== bo) continue;
    const outgoing = flow.sourceRef === bo;
    const structure = messageStructureOf(flow);
    if (structure && structure !== TRIAL && structure !== RESPONSE) continue; // another skill's exchange
    if (structure && (structure === TRIAL) !== outgoing) {
      throw new Error(`message flow '${flow.id}' carries ${structure} the wrong way: trials leave the task, responses come back`);
    }
    const other = outgoing ? flow.targetRef : flow.sourceRef;
    const into = structure ? typed : untyped;
    for (const participant of other?.$type === 'bpmn:Participant' ? [other] : poolsOf(other)) {
      if (!into.includes(participant)) into.push(participant);
    }
  }
  const partners = typed.length > 0 ? typed : untyped;
  if (partners.length > 1) {
    throw new Error(`${bo.id} exchanges messages with ${partners.map((p) => p.id).join(', ')}: name the message each flow `
      + `carries (messageRef, ${TRIAL} or ${RESPONSE}), or keep one partner`);
  }
  return partners;
}

/** The `agentic:Prompt` data object wired into the task, as its template text. */
export function promptOf(bo: any): string {
  for (const association of (bo?.dataInputAssociations ?? []) as any[]) {
    for (const source of (association?.sourceRef ?? []) as any[]) {
      const typed = ((source?.extensionElements?.values ?? []) as any[])
        .some((ext) => String(ext?.$type ?? '').toLowerCase() === 'agentic:prompt');
      if (typed) return String(getAttribute(source, 'template') ?? '');
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
