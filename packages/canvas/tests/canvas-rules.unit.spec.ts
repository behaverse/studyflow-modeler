import { expect, test } from '@playwright/test';

import { buildCatalog, setCatalog } from '@core/notation';
import type { TypeCatalog } from '@core/notation/query.ts';
import { Rules, type ConnectionSpec, type RuleElement } from '@canvas/rules/rules.ts';

import { connectsToFixture, loadSchemaModels } from '@tests/schemas';

/**
 * The rules: may this edit happen? Two layers, and the connection tables split the
 * same way:
 *
 * - the **schema layer** reads `TypeCatalog.connectionRule`. No *shipped* schema
 *   declares a `connectsTo` annotation (every studyflow type defers), so the
 *   `connects-to` fixture schema — the same one `packages/core/tests/catalog.unit.spec.ts` uses —
 *   is compiled alongside the real ones to exercise `true` / `false` / `'*'`.
 * - the **structural layer** is plain BPMN sense: no flow out of an end event, none
 *   into a start event, no self-loop, sequence vs. message flow by participant
 *   boundary, containment.
 *
 * The rules are pure, so nothing here needs a DOM, a canvas or a moddle instance:
 * a `RuleElement` is any object carrying `type` / `businessObject` / `parent`,
 * which is exactly what `SceneNode`, `SceneEdge` and a detached palette shape all
 * are. Each table row is the question, the rules' answer and the expected one.
 */

/** Real schemas + the `connectsTo` fixture, so both layers have something to say. */
const catalog: TypeCatalog = buildCatalog([...loadSchemaModels(), connectsToFixture()]);
setCatalog(catalog);

const rules = new Rules();

const SEQUENCE: ConnectionSpec = { type: 'bpmn:SequenceFlow' };
const MESSAGE: ConnectionSpec = { type: 'bpmn:MessageFlow' };
const ASSOCIATION: ConnectionSpec = { type: 'bpmn:Association' };

type Row<T> = [label: string, actual: T, expected: T];

// --- element builders -------------------------------------------------------

interface NodeOptions {
  /** Schema type carried in `extensionElements` (`lab:Consent`). */
  extension?: string;
  parent?: RuleElement;
  isExpanded?: boolean;
}

/** A scene-node-shaped element: `type` is the BPMN type, the BO carries the extension. */
function node(type: string, options: NodeOptions = {}): RuleElement {
  const businessObject: any = { $type: type };
  if (options.extension) {
    businessObject.extensionElements = { $type: 'bpmn:ExtensionElements', values: [{ $type: options.extension }] };
  }
  return { type, businessObject, parent: options.parent, isExpanded: options.isExpanded, incoming: [], outgoing: [] };
}

/** A scene-edge-shaped element. */
function edge(type: string, source?: RuleElement, target?: RuleElement): RuleElement {
  return { type, businessObject: { $type: type }, source, target };
}

/** An edge registered on both of its ends, the way the scene holds one. */
function link(type: string, source: RuleElement, target: RuleElement): void {
  const flow = edge(type, source, target);
  (source.outgoing as RuleElement[]).push(flow);
  (target.incoming as RuleElement[]).push(flow);
}

/** The element for a fixture schema type (`lab:Consent`). */
function ofType(ref: string, options: NodeOptions = {}): RuleElement {
  const bpmnType = catalog.getType(ref)?.bpmnType;
  if (!bpmnType) throw new Error(`fixture type ${ref} has no bpmnType`);
  return node(bpmnType, { ...options, extension: ref });
}

// --- connecting --------------------------------------------------------------

test('the schema layer is read off the extension: `false` vetoes, `*` outranks structure, within one container', () => {
  const sub = node('bpmn:SubProcess');
  const CASES: Row<ConnectionSpec | false>[] = [
    ['two plain tasks: no rule, structure decides', rules.canConnect(node('bpmn:Task'), node('bpmn:Task')), SEQUENCE],
    ['consent → debrief, both tasks: the allow-list vetoes', rules.canConnect(ofType('lab:Consent'), ofType('lab:Debrief')), false],
    ['debrief → a start event: `*` outranks structure', rules.canConnect(ofType('lab:Debrief'), node('bpmn:StartEvent')), SEQUENCE],
    // A schema authorises a pair of types, not a sequence flow across a sub-process boundary.
    ['debrief in a sub-process → survey outside it', rules.canConnect(ofType('lab:Debrief', { parent: sub }), ofType('lab:Survey')), false],
    ['debrief → survey in the same sub-process', rules.canConnect(ofType('lab:Debrief', { parent: sub }), ofType('lab:Survey', { parent: sub })), SEQUENCE],
  ];
  for (const [label, actual, expected] of CASES) expect(actual, label).toEqual(expected);
});

test('canConnect: the connection a pair gets, if any', () => {
  const task = node('bpmn:Task');
  const sub = node('bpmn:SubProcess');
  const poolA = node('bpmn:Participant');
  const poolB = node('bpmn:Participant');
  const laneA = node('bpmn:Lane', { parent: poolA });
  const laneB = node('bpmn:Lane', { parent: poolA });
  const inA = (type: string) => node(type, { parent: poolA });
  const inB = (type: string) => node(type, { parent: poolB });
  const CASES: Row<ConnectionSpec | false>[] = [
    // Sequence flow: between flow nodes of one container.
    ['start event → task', rules.canConnect(node('bpmn:StartEvent'), task), SEQUENCE],
    ['task → end event', rules.canConnect(task, node('bpmn:EndEvent')), SEQUENCE],
    ['out of an end event', rules.canConnect(node('bpmn:EndEvent'), task), false],
    ['into a start event', rules.canConnect(node('bpmn:ParallelGateway'), node('bpmn:StartEvent')), false],
    ['into a boundary event, which is attached instead', rules.canConnect(task, node('bpmn:BoundaryEvent')), false],
    ['out of a boundary event', rules.canConnect(node('bpmn:BoundaryEvent'), task), SEQUENCE],
    ['a task to itself', rules.canConnect(task, task), false],
    ['to nothing', rules.canConnect(task, undefined), false],
    ['out of a sub-process', rules.canConnect(node('bpmn:Task', { parent: sub }), task), false],
    ['within a sub-process', rules.canConnect(node('bpmn:Task', { parent: sub }), node('bpmn:EndEvent', { parent: sub })), SEQUENCE],
    ['within one pool', rules.canConnect(inA('bpmn:Task'), inA('bpmn:Task')), SEQUENCE],
    ['across two lanes of one pool', rules.canConnect(node('bpmn:Task', { parent: laneA }), node('bpmn:Task', { parent: laneB })), SEQUENCE],
    // Message flow: across pools, from something that sends to something that receives.
    ['task → task in another pool', rules.canConnect(inA('bpmn:Task'), inB('bpmn:Task')), MESSAGE],
    ['pool → pool', rules.canConnect(poolA, poolB), MESSAGE],
    ['a choreography task in a pool → a receive task in the other', rules.canConnect(inA('bpmn:ChoreographyTask'), inB('bpmn:ReceiveTask')), MESSAGE],
    ['a receive task → a choreography task in the other pool', rules.canConnect(inB('bpmn:ReceiveTask'), inA('bpmn:ChoreographyTask')), MESSAGE],
    ['a gateway, which neither sends nor receives', rules.canConnect(inA('bpmn:ExclusiveGateway'), inB('bpmn:Task')), false],
    ['an end event throws to a start event', rules.canConnect(inA('bpmn:EndEvent'), inB('bpmn:StartEvent')), MESSAGE],
    ['a start event throws nothing', rules.canConnect(inA('bpmn:StartEvent'), inB('bpmn:EndEvent')), false],
    ['an end event catches nothing', rules.canConnect(inA('bpmn:EndEvent'), inB('bpmn:EndEvent')), false],
    ['end → start across two lanes: one participant, so no message', rules.canConnect(node('bpmn:EndEvent', { parent: laneA }), node('bpmn:StartEvent', { parent: laneB })), false],
    // Associations: to and from artifacts, and data associations to and from activities.
    ['task → annotation', rules.canConnect(task, node('bpmn:TextAnnotation')), ASSOCIATION],
    ['annotation → task', rules.canConnect(node('bpmn:TextAnnotation'), task), ASSOCIATION],
    ['group → start event', rules.canConnect(node('bpmn:Group'), node('bpmn:StartEvent')), ASSOCIATION],
    ['data object → task', rules.canConnect(node('bpmn:DataObjectReference'), task), { type: 'bpmn:DataInputAssociation' }],
    ['task → data store', rules.canConnect(task, node('bpmn:DataStoreReference')), { type: 'bpmn:DataOutputAssociation' }],
    ['gateway → data object', rules.canConnect(node('bpmn:ExclusiveGateway'), node('bpmn:DataObjectReference')), false],
    ['data object → data store', rules.canConnect(node('bpmn:DataObjectReference'), node('bpmn:DataStoreReference')), false],
  ];
  for (const [label, actual, expected] of CASES) expect(actual, label).toEqual(expected);
});

test('canReconnect judges the dragged end with the one left in place, and keeps the connection\'s kind', () => {
  const flow = edge('bpmn:SequenceFlow', node('bpmn:Task'), node('bpmn:Task'));
  const pool = node('bpmn:Participant');
  const inPool = edge('bpmn:SequenceFlow', node('bpmn:Task', { parent: pool }), node('bpmn:Task', { parent: pool }));
  const fromConsent = edge('bpmn:SequenceFlow', ofType('lab:Consent'), ofType('lab:Survey'));
  const CASES: Row<ConnectionSpec | false>[] = [
    ['the target onto an end event', rules.canReconnect(flow, undefined, node('bpmn:EndEvent')), SEQUENCE],
    ['the source onto a start event', rules.canReconnect(flow, node('bpmn:StartEvent'), undefined), SEQUENCE],
    ['the target onto a start event', rules.canReconnect(flow, undefined, node('bpmn:StartEvent')), false],
    ['the source onto an end event', rules.canReconnect(flow, node('bpmn:EndEvent'), undefined), false],
    ['the target into another pool, which would make it a message flow', rules.canReconnect(inPool, undefined, node('bpmn:Task', { parent: node('bpmn:Participant') })), false],
    ['consent\'s target onto another survey', rules.canReconnect(fromConsent, undefined, ofType('lab:Survey')), SEQUENCE],
    ['consent\'s target onto a debrief', rules.canReconnect(fromConsent, undefined, ofType('lab:Debrief')), false],
    ['no connection', rules.canReconnect(undefined, node('bpmn:Task'), node('bpmn:Task')), false],
  ];
  for (const [label, actual, expected] of CASES) expect(actual, label).toEqual(expected);
});

// --- containment, retyping, resizing ----------------------------------------------

test('what may be created, or retyped, where', () => {
  const pool = node('bpmn:Participant');
  const lane = node('bpmn:Lane', { parent: pool });
  const collaboration: RuleElement = { businessObject: { $type: 'bpmn:Collaboration' } };
  const expanded = node('bpmn:SubProcess', { isExpanded: true });
  const collapsed = node('bpmn:SubProcess', { isExpanded: false });
  const task = node('bpmn:Task');
  const flow = edge('bpmn:SequenceFlow', task, node('bpmn:EndEvent'));
  const CASES: Row<boolean | 'attach'>[] = [
    // No parent reads as the process root.
    ...['bpmn:Task', 'bpmn:UserTask', 'bpmn:SubProcess', 'bpmn:StartEvent', 'bpmn:ExclusiveGateway',
      'bpmn:ChoreographyTask', 'bpmn:DataObjectReference', 'bpmn:Group', 'bpmn:TextAnnotation',
    ].map((type): Row<boolean | 'attach'> => [`a ${type} into the process`, rules.canCreate(node(type)), true]),
    ['a pool into the process', rules.canCreate(node('bpmn:Participant')), false],
    ['a pool into a collaboration', rules.canCreate(node('bpmn:Participant'), collaboration), true],
    ['a task into a collaboration', rules.canCreate(task, collaboration), false],
    ['an annotation into a collaboration', rules.canCreate(node('bpmn:TextAnnotation'), collaboration), true],
    ['a lane into a pool', rules.canCreate(node('bpmn:Lane'), pool), true],
    ['a lane into a lane', rules.canCreate(node('bpmn:Lane'), lane), true],
    ['a lane into the process', rules.canCreate(node('bpmn:Lane')), false],
    ['a task into a lane', rules.canCreate(task, lane), true],
    ['a task into an expanded sub-process', rules.canCreate(task, expanded), true],
    ['a task into a collapsed sub-process', rules.canCreate(task, collapsed), false],
    ['a pool into a sub-process', rules.canCreate(node('bpmn:Participant'), expanded), false],
    ['a sub-process into itself', rules.canCreate(expanded, expanded), false],
    ['a task into a task', rules.canCreate(task, node('bpmn:UserTask')), false],
    ['a task into a gateway', rules.canCreate(task, node('bpmn:ExclusiveGateway')), false],
    ['a boundary event onto an activity', rules.canCreate(node('bpmn:BoundaryEvent'), task), 'attach'],
    ['a boundary event with no activity', rules.canCreate(node('bpmn:BoundaryEvent')), false],
    ['a task onto a group in a pool, which the pool takes', rules.canCreate(task, node('bpmn:Group', { parent: pool })), true],
    ['a pool onto a group at the root, which the process takes', rules.canCreate(node('bpmn:Participant'), node('bpmn:Group')), false],
    // Retyping in place: a flow node into what its container may hold.
    ['retype a task as a user task', rules.canReplace(task, 'bpmn:UserTask'), true],
    ['retype a start event as an end event', rules.canReplace(node('bpmn:StartEvent'), 'bpmn:EndEvent'), true],
    ['retype a task as a pool', rules.canReplace(task, 'bpmn:Participant'), false],
    ['retype a task as a boundary event', rules.canReplace(task, 'bpmn:BoundaryEvent'), false],
    ['retype a flow as a task', rules.canReplace(flow, 'bpmn:Task'), false],
    // With no type named it is the wrench's question: is this replaceable at all?
    ['a task is replaceable', rules.canReplace(task), true],
    ['a flow is not', rules.canReplace(flow), false],
  ];
  for (const [label, actual, expected] of CASES) expect(actual, label).toBe(expected);
});

test('activities, pools, lanes and artifacts resize; events, gateways and data do not', () => {
  const CASES: Row<boolean>[] = [
    ...['bpmn:Task', 'bpmn:UserTask', 'bpmn:SubProcess', 'bpmn:Transaction', 'bpmn:CallActivity',
      'bpmn:ChoreographyTask', 'bpmn:Participant', 'bpmn:Lane', 'bpmn:Group', 'bpmn:TextAnnotation',
    ].map((type): Row<boolean> => [`a ${type} resizes`, rules.canResize(node(type)), true]),
    ...['bpmn:StartEvent', 'bpmn:EndEvent', 'bpmn:BoundaryEvent', 'bpmn:ExclusiveGateway',
      'bpmn:DataObjectReference', 'bpmn:DataStoreReference',
    ].map((type): Row<boolean> => [`a ${type} keeps its size`, rules.canResize(node(type)), false]),
    ['no shape', rules.canResize(undefined), false],
  ];
  for (const [label, actual, expected] of CASES) expect(actual, label).toBe(expected);
});

// --- appending, moving ----------------------------------------------------------

test('what a successor may follow, and where any edge may start', () => {
  const CASES: Row<boolean>[] = [
    // `canAppend` asks about a sequence flow alone: it gates the pad's successor entries.
    ...['bpmn:Task', 'bpmn:UserTask', 'bpmn:StartEvent', 'bpmn:ExclusiveGateway', 'bpmn:SubProcess',
      'bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent',
    ].map((type): Row<boolean> => [`a successor follows a ${type}`, rules.canAppend(node(type)), true]),
    ...['bpmn:EndEvent', 'bpmn:TextAnnotation', 'bpmn:Group', 'bpmn:DataObjectReference', 'bpmn:Participant', 'bpmn:Lane',
    ].map((type): Row<boolean> => [`none follows a ${type}`, rules.canAppend(node(type)), false]),
    ['none follows nothing', rules.canAppend(undefined), false],
    // An annotation is reached by an association, so it hangs off an end event too.
    ['an annotation hangs off an end event', rules.canAppendType(node('bpmn:EndEvent'), 'bpmn:TextAnnotation'), true],
    // The connect handle covers every edge that can leave an element: a data shape sources
    // a data association, an end event and a pool a message, an artifact an association.
    ...['bpmn:Task', 'bpmn:DataObjectReference', 'bpmn:DataStoreReference', 'bpmn:EndEvent', 'bpmn:Participant',
      'bpmn:TextAnnotation',
    ].map((type): Row<boolean> => [`an edge may start at a ${type}`, rules.canStartConnection(node(type)), true]),
  ];
  for (const [label, actual, expected] of CASES) expect(actual, label).toBe(expected);
});

test('a move fits every shape to the drop target and strands no sequence flow across a container', () => {
  // A sequence flow lives in one container and may not cross a sub-process boundary,
  // so a drop that would drag one across is refused, as drawing it would be.
  const pool = node('bpmn:Participant');
  const sub = node('bpmn:SubProcess');
  const outside = node('bpmn:Task');
  const moving = node('bpmn:Task');
  link('bpmn:SequenceFlow', outside, moving);
  const joining = node('bpmn:Task');
  link('bpmn:SequenceFlow', node('bpmn:Task', { parent: sub }), joining);
  // A document may already carry a flow across; only a drop that changes the container is judged.
  const stranded = node('bpmn:Task', { parent: sub });
  link('bpmn:SequenceFlow', node('bpmn:Task'), stranded);
  // An annotation's association is no sequence flow: nothing of the process leaves the container.
  const note = node('bpmn:TextAnnotation');
  link('bpmn:Association', node('bpmn:Task'), note);

  const CASES: Row<boolean>[] = [
    ['a task and a start event into a pool', rules.canMove([node('bpmn:Task'), node('bpmn:StartEvent')], pool), true],
    ['a task and a pool into a pool', rules.canMove([node('bpmn:Task'), node('bpmn:Participant')], pool), false],
    ['one end of a flow into a sub-process', rules.canMove([moving], sub), false],
    ['both ends of the flow together', rules.canMove([moving, outside], sub), true],
    ['to the other end, already inside', rules.canMove([joining], sub), true],
    ['within the sub-process it already lives in', rules.canMove([stranded], sub), true],
    ['an annotation with its association', rules.canMove([note], sub), true],
  ];
  for (const [label, actual, expected] of CASES) expect(actual, label).toBe(expected);
});
