import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { buildCatalog, setCatalog } from '@core/notation';
import { fromModdleYaml } from '@core/notation/schemaFile';
import type { TypeCatalog } from '@core/notation/query.ts';
import {
  Rules,
  canContain,
  containerFor,
  isResizable,
  minSizeFor,
  participantOf,
  ruleContainerOf,
  structuralConnection,
  type RuleElement,
} from '@canvas/rules/rules.ts';

import { loadSchemaModels } from './schemas';

/**
 * P4 rules engine (design §3 "Rules", §6 P4). The engine has two layers and the
 * tests split the same way:
 *
 * - the **schema layer** must agree with `TypeCatalog.connectionRule` verdict for
 *   verdict — that is the whole contract, so the matrix below asserts against the
 *   catalog itself rather than against a transcribed copy of it. No *shipped*
 *   schema declares `meta.connectsTo` (every studyflow type defers), so the
 *   `connects-to` fixture schema — the same one `schema-model.unit.spec.ts` uses —
 *   is compiled alongside the real ones to exercise `true` / `false` / `'*'`.
 * - the **structural layer** is plain BPMN sense, checked directly: no flow out of
 *   an end event, none into a start event, no self-loop, sequence vs. message flow
 *   by participant boundary, containment.
 *
 * The rules are pure, so nothing here needs a DOM, a canvas or a moddle instance:
 * a `RuleElement` is any object carrying `type` / `businessObject` / `parent`,
 * which is exactly what `SceneNode`, `SceneEdge` and a detached palette shape all
 * are.
 */

const FIXTURE = path.join(process.cwd(), 'tests/fixtures/connects-to.moddle.yaml');

/** Real schemas + the `connectsTo` fixture, so both layers have something to say. */
const catalog: TypeCatalog = buildCatalog([
  ...loadSchemaModels(),
  fromModdleYaml(readFileSync(FIXTURE, 'utf8'), 'tests/fixtures/connects-to.moddle.yaml'),
]);
setCatalog(catalog);

const rules = new Rules();

// --- element builders -------------------------------------------------------

interface NodeOptions {
  /** Schema type carried in `extensionElements` (`lab:Consent`, `studyflow:Instruction`). */
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
  return { type, businessObject, parent: options.parent, isExpanded: options.isExpanded };
}

/** A scene-edge-shaped element. */
function edge(type: string, source?: RuleElement, target?: RuleElement): RuleElement {
  return { type, businessObject: { $type: type }, source, target };
}

/** The element for a schema type ref (`lab:Consent`) or a bare BPMN type. */
function ofType(ref: string): RuleElement {
  if (ref.startsWith('bpmn:')) return node(ref);
  const bpmnType = catalog.getType(ref)?.bpmnType;
  if (!bpmnType) throw new Error(`fixture type ${ref} has no bpmnType`);
  return node(bpmnType, { extension: ref });
}

// --- schema layer: the connection matrix ------------------------------------

test.describe('canvas rules: connection.create matches @core catalog.connectionRule', () => {
  /**
   * Every pair of representative types, judged twice: once by the catalog (the
   * authority for the schema layer) and once by the rules engine. They must agree
   * wherever the catalog has an opinion; where it defers, the structural layer is
   * the authority and the engine must match *that*.
   */
  const TYPES = [
    'lab:Consent', // connectsTo: [lab:Survey, bpmn:Gateway]
    'lab:Survey', // no connectsTo -> defer
    'lab:Debrief', // connectsTo: ['*']
    'bpmn:Task',
    'bpmn:ExclusiveGateway',
    'bpmn:StartEvent',
    'bpmn:EndEvent',
  ];

  for (const sourceRef of TYPES) {
    for (const targetRef of TYPES) {
      test(`${sourceRef} -> ${targetRef}`, () => {
        const source = ofType(sourceRef);
        const target = ofType(targetRef);

        const schema = catalog.connectionRule(sourceRef, targetRef);
        const structural = structuralConnection(source, target);
        const expected = schema === 'defer' ? !!structural : schema;

        expect(!!rules.canConnect(source, target)).toBe(expected);
        expect(!!rules.allowed('connection.create', { source, target })).toBe(expected);
      });
    }
  }

  test('the schema layer is read through the element extension, not the BPMN type', () => {
    // Both are `bpmn:Task`s; only the extension distinguishes them.
    const consent = ofType('lab:Consent');
    const debrief = ofType('lab:Debrief');
    expect(rules.schemaVerdict(consent, debrief)).toBe(false);
    expect(rules.schemaVerdict(debrief, consent)).toBe(true);
    // ... and a plain task, which declares nothing, defers.
    expect(rules.schemaVerdict(node('bpmn:Task'), node('bpmn:Task'))).toBe('defer');
  });

  test('a schema allow-list vetoes a structurally fine flow', () => {
    // consent -> debrief is task -> task, which structure permits.
    expect(structuralConnection(ofType('lab:Consent'), ofType('lab:Debrief'))).toEqual({
      type: 'bpmn:SequenceFlow',
    });
    expect(rules.canConnect(ofType('lab:Consent'), ofType('lab:Debrief'))).toBe(false);
  });

  test('a schema `*` outranks the structural layer, as it does in the modeler', () => {
    // debrief -> start event is structurally forbidden, but `connectsTo: ['*']` wins
    // (StudyflowRules is registered above BpmnRules).
    const start = node('bpmn:StartEvent');
    expect(structuralConnection(ofType('lab:Debrief'), start)).toBe(false);
    expect(rules.canConnect(ofType('lab:Debrief'), start)).toEqual({ type: 'bpmn:SequenceFlow' });
  });

  test('a catalog that declares nothing defers every pair to structure', () => {
    // The engine reads the *installed* catalog by default; an injected one wins.
    const bare = new Rules({ catalog: buildCatalog([]) });
    expect(bare.schemaVerdict(ofType('lab:Consent'), ofType('lab:Debrief'))).toBe('defer');
    expect(bare.canConnect(ofType('lab:Consent'), ofType('lab:Debrief'))).toEqual({ type: 'bpmn:SequenceFlow' });
    expect(new Rules({ catalog }).canConnect(ofType('lab:Consent'), ofType('lab:Debrief'))).toBe(false);
  });
});

// --- structural layer: flow restrictions ------------------------------------

test.describe('canvas rules: sequence-flow restrictions', () => {
  test('start -> task -> end is a sequence flow', () => {
    expect(rules.canConnect(node('bpmn:StartEvent'), node('bpmn:Task'))).toEqual({ type: 'bpmn:SequenceFlow' });
    expect(rules.canConnect(node('bpmn:Task'), node('bpmn:EndEvent'))).toEqual({ type: 'bpmn:SequenceFlow' });
  });

  test('nothing flows out of an end event', () => {
    expect(rules.canConnect(node('bpmn:EndEvent'), node('bpmn:Task'))).toBe(false);
    expect(rules.canConnect(node('bpmn:EndEvent'), node('bpmn:ExclusiveGateway'))).toBe(false);
  });

  test('nothing flows into a start event', () => {
    expect(rules.canConnect(node('bpmn:Task'), node('bpmn:StartEvent'))).toBe(false);
    expect(rules.canConnect(node('bpmn:ParallelGateway'), node('bpmn:StartEvent'))).toBe(false);
  });

  test('a boundary event is attached, never flowed into', () => {
    expect(rules.canConnect(node('bpmn:Task'), node('bpmn:BoundaryEvent'))).toBe(false);
    // ...but it is a perfectly good source.
    expect(rules.canConnect(node('bpmn:BoundaryEvent'), node('bpmn:Task'))).toEqual({
      type: 'bpmn:SequenceFlow',
    });
  });

  test('self-loops are refused unless opted in', () => {
    const task = node('bpmn:Task');
    expect(rules.canConnect(task, task)).toBe(false);
    expect(new Rules({ allowSelfLoop: true }).canConnect(task, task)).toEqual({ type: 'bpmn:SequenceFlow' });
    // Two distinct nodes of the same type are not a self-loop.
    expect(rules.canConnect(node('bpmn:Task'), node('bpmn:Task'))).toEqual({ type: 'bpmn:SequenceFlow' });
  });

  test('a missing endpoint is never connectable', () => {
    expect(rules.canConnect(undefined, node('bpmn:Task'))).toBe(false);
    expect(rules.canConnect(node('bpmn:Task'), undefined)).toBe(false);
    expect(rules.allowed('connection.create', {})).toBe(false);
  });

  test('sequence flow does not leave its container', () => {
    const subProcess = node('bpmn:SubProcess');
    const inside = node('bpmn:Task', { parent: subProcess });
    const outside = node('bpmn:Task');
    expect(ruleContainerOf(inside)).toBe(subProcess);
    expect(ruleContainerOf(outside)).toBe(undefined);
    expect(rules.canConnect(inside, outside)).toBe(false);
    expect(rules.canConnect(inside, node('bpmn:EndEvent', { parent: subProcess }))).toEqual({
      type: 'bpmn:SequenceFlow',
    });
  });

  test('a lane is visual nesting: flows cross lanes inside one pool', () => {
    const pool = node('bpmn:Participant');
    const laneA = node('bpmn:Lane', { parent: pool });
    const laneB = node('bpmn:Lane', { parent: pool });
    const a = node('bpmn:Task', { parent: laneA });
    const b = node('bpmn:Task', { parent: laneB });
    expect(ruleContainerOf(a)).toBe(pool);
    expect(rules.canConnect(a, b)).toEqual({ type: 'bpmn:SequenceFlow' });
  });
});

test.describe('canvas rules: message flow, associations, data associations', () => {
  const poolA = node('bpmn:Participant');
  const poolB = node('bpmn:Participant');

  test('crossing a participant boundary makes it a message flow', () => {
    const a = node('bpmn:Task', { parent: poolA });
    const b = node('bpmn:Task', { parent: poolB });
    expect(participantOf(a)).toBe(poolA);
    expect(rules.canConnect(a, b)).toEqual({ type: 'bpmn:MessageFlow' });
    expect(rules.canConnect(poolA, poolB)).toEqual({ type: 'bpmn:MessageFlow' });
  });

  test('inside one pool it stays a sequence flow', () => {
    expect(rules.canConnect(node('bpmn:Task', { parent: poolA }), node('bpmn:Task', { parent: poolA }))).toEqual({
      type: 'bpmn:SequenceFlow',
    });
  });

  test('only throwing/catching ends may carry a message across pools', () => {
    // A gateway neither throws nor catches messages.
    expect(rules.canConnect(node('bpmn:ExclusiveGateway', { parent: poolA }), node('bpmn:Task', { parent: poolB })))
      .toBe(false);
    // An end event throws; a start event catches.
    expect(rules.canConnect(node('bpmn:EndEvent', { parent: poolA }), node('bpmn:StartEvent', { parent: poolB })))
      .toEqual({ type: 'bpmn:MessageFlow' });
    // ...and not the other way round.
    expect(rules.canConnect(node('bpmn:StartEvent', { parent: poolA }), node('bpmn:EndEvent', { parent: poolB })))
      .toBe(false);
  });

  test('artifacts are wired with associations', () => {
    expect(rules.canConnect(node('bpmn:Task'), node('bpmn:TextAnnotation'))).toEqual({ type: 'bpmn:Association' });
    expect(rules.canConnect(node('bpmn:TextAnnotation'), node('bpmn:Task'))).toEqual({ type: 'bpmn:Association' });
    expect(rules.canConnect(node('bpmn:Group'), node('bpmn:StartEvent'))).toEqual({ type: 'bpmn:Association' });
  });

  test('data shapes are wired with data associations, and only to activities/events', () => {
    expect(rules.canConnect(node('bpmn:DataObjectReference'), node('bpmn:Task')))
      .toEqual({ type: 'bpmn:DataInputAssociation' });
    expect(rules.canConnect(node('bpmn:Task'), node('bpmn:DataStoreReference')))
      .toEqual({ type: 'bpmn:DataOutputAssociation' });
    expect(rules.canConnect(node('bpmn:ExclusiveGateway'), node('bpmn:DataObjectReference'))).toBe(false);
    expect(rules.canConnect(node('bpmn:DataObjectReference'), node('bpmn:DataStoreReference'))).toBe(false);
  });
});

// --- reconnect --------------------------------------------------------------

test.describe('canvas rules: connection.reconnect', () => {
  const source = node('bpmn:Task');
  const target = node('bpmn:Task');
  const flow = edge('bpmn:SequenceFlow', source, target);

  test('the endpoint that is not being dragged is read off the connection', () => {
    expect(rules.canReconnect(flow, undefined, node('bpmn:EndEvent'))).toEqual({ type: 'bpmn:SequenceFlow' });
    expect(rules.canReconnect(flow, node('bpmn:StartEvent'), undefined)).toEqual({ type: 'bpmn:SequenceFlow' });
  });

  test('it refuses a new endpoint the structural layer forbids', () => {
    expect(rules.canReconnect(flow, undefined, node('bpmn:StartEvent'))).toBe(false);
    expect(rules.canReconnect(flow, node('bpmn:EndEvent'), undefined)).toBe(false);
  });

  test('it refuses to silently change the kind of connection', () => {
    const pooled = node('bpmn:Task', { parent: node('bpmn:Participant') });
    const inOtherPool = node('bpmn:Task', { parent: node('bpmn:Participant') });
    const crossPool = edge('bpmn:SequenceFlow', pooled, node('bpmn:Task', { parent: pooled.parent }));
    // Dragging the end into another pool would make it a message flow.
    expect(rules.canReconnect(crossPool, undefined, inOtherPool)).toBe(false);
  });

  test('the schema layer applies to reconnect too', () => {
    const consentFlow = edge('bpmn:SequenceFlow', ofType('lab:Consent'), ofType('lab:Survey'));
    expect(rules.canReconnect(consentFlow, undefined, ofType('lab:Survey'))).toEqual({ type: 'bpmn:SequenceFlow' });
    expect(rules.canReconnect(consentFlow, undefined, ofType('lab:Debrief'))).toBe(false);
  });

  test('a missing connection is never reconnectable', () => {
    expect(rules.canReconnect(undefined, source, target)).toBe(false);
  });
});

// --- containment ------------------------------------------------------------

test.describe('canvas rules: shape.create containment', () => {
  test('flow nodes, data and artifacts drop into a process', () => {
    for (const type of ['bpmn:Task', 'bpmn:UserTask', 'bpmn:SubProcess', 'bpmn:StartEvent',
      'bpmn:ExclusiveGateway', 'bpmn:DataObjectReference', 'bpmn:Group', 'bpmn:TextAnnotation']) {
      expect(canContain(type, 'bpmn:Process'), type).toBe(true);
    }
    // No parent at all reads as the process root.
    expect(rules.canCreate(node('bpmn:Task'))).toBe(true);
  });

  test('a pool belongs to a collaboration, never to a process', () => {
    expect(canContain('bpmn:Participant', 'bpmn:Collaboration')).toBe(true);
    expect(canContain('bpmn:Participant', 'bpmn:Process')).toBe(false);
    expect(canContain('bpmn:Task', 'bpmn:Collaboration')).toBe(false);
    expect(canContain('bpmn:TextAnnotation', 'bpmn:Collaboration')).toBe(true);
  });

  test('a lane subdivides a pool or another lane', () => {
    expect(canContain('bpmn:Lane', 'bpmn:Participant')).toBe(true);
    expect(canContain('bpmn:Lane', 'bpmn:Lane')).toBe(true);
    expect(canContain('bpmn:Lane', 'bpmn:Process')).toBe(false);
    expect(canContain('bpmn:Task', 'bpmn:Lane')).toBe(true);
  });

  test('an expanded subprocess takes children; a collapsed one does not', () => {
    const expanded = node('bpmn:SubProcess', { isExpanded: true });
    const collapsed = node('bpmn:SubProcess', { isExpanded: false });
    expect(rules.canCreate(node('bpmn:Task'), expanded)).toBe(true);
    expect(rules.canCreate(node('bpmn:Task'), collapsed)).toBe(false);
    expect(rules.canCreate(node('bpmn:Participant'), expanded)).toBe(false);
  });

  test('a task is not a container', () => {
    expect(rules.canCreate(node('bpmn:Task'), node('bpmn:UserTask'))).toBe(false);
    expect(rules.canCreate(node('bpmn:Task'), node('bpmn:ExclusiveGateway'))).toBe(false);
    expect(rules.canCreate(node('bpmn:Task'), node('bpmn:StartEvent'))).toBe(false);
  });

  test('a boundary event attaches to an activity and nothing else', () => {
    const task = node('bpmn:Task');
    expect(rules.canCreate(node('bpmn:BoundaryEvent'), task)).toBe('attach');
    expect(rules.canAttach(node('bpmn:BoundaryEvent'), task)).toBe('attach');
    expect(rules.allowed('shape.attach', { shape: node('bpmn:BoundaryEvent'), parent: task })).toBe('attach');
    expect(rules.canCreate(node('bpmn:BoundaryEvent'))).toBe(false);
    expect(rules.canAttach(node('bpmn:Task'), task)).toBe(false);
  });

  test('a drop onto a group is judged against the group container', () => {
    const pool = node('bpmn:Participant');
    const group = node('bpmn:Group', { parent: pool });
    expect(containerFor(group)).toBe(pool);
    expect(rules.canCreate(node('bpmn:Task'), group)).toBe(true);
    // A group at the plane root resolves to the root process, where a pool is illegal.
    expect(rules.canCreate(node('bpmn:Participant'), node('bpmn:Group'))).toBe(false);
  });

  test('nothing drops into itself', () => {
    const subProcess = node('bpmn:SubProcess');
    expect(rules.canCreate(subProcess, subProcess)).toBe(false);
  });

  test('a plane is a valid parent: its business object names the root type', () => {
    const collaborationPlane: RuleElement = { businessObject: { $type: 'bpmn:Collaboration' } };
    expect(rules.canCreate(node('bpmn:Participant'), collaborationPlane)).toBe(true);
    expect(rules.canCreate(node('bpmn:Task'), collaborationPlane)).toBe(false);
  });

  test('choreography tasks live in the process the import pass rewrites them into', () => {
    // `choreographyToProcessRoot` turns a bpmn:Choreography root into a bpmn:Process
    // before the canvas ever sees the document.
    expect(canContain('bpmn:ChoreographyTask', 'bpmn:Process')).toBe(true);
    expect(canContain('bpmn:ChoreographyTask', 'bpmn:Choreography')).toBe(true);
    expect(canContain('bpmn:Task', 'bpmn:Choreography')).toBe(false);
  });
});

// --- resize -----------------------------------------------------------------

test.describe('canvas rules: shape.resize', () => {
  test('activities, pools, lanes and artifacts resize; events, gateways and data do not', () => {
    for (const type of ['bpmn:Task', 'bpmn:UserTask', 'bpmn:SubProcess', 'bpmn:Transaction',
      'bpmn:CallActivity', 'bpmn:ChoreographyTask', 'bpmn:Participant', 'bpmn:Lane',
      'bpmn:Group', 'bpmn:TextAnnotation']) {
      expect(isResizable(type), type).toBe(true);
      expect(rules.canResize(node(type)), type).toBe(true);
    }
    for (const type of ['bpmn:StartEvent', 'bpmn:EndEvent', 'bpmn:BoundaryEvent',
      'bpmn:ExclusiveGateway', 'bpmn:DataObjectReference', 'bpmn:DataStoreReference']) {
      expect(isResizable(type), type).toBe(false);
      expect(rules.canResize(node(type)), type).toBe(false);
    }
  });

  test('minimum sizes are per type, most specific first', () => {
    expect(minSizeFor('bpmn:Task')).toEqual({ width: 100, height: 80 });
    expect(minSizeFor('bpmn:Transaction')).toEqual({ width: 100, height: 80 });
    expect(minSizeFor('bpmn:ChoreographyTask')).toEqual({ width: 100, height: 80 });
    expect(minSizeFor('bpmn:Participant')).toEqual({ width: 300, height: 60 });
    expect(minSizeFor('bpmn:TextAnnotation')).toEqual({ width: 50, height: 30 });
    expect(minSizeFor('bpmn:StartEvent')).toEqual({ width: 20, height: 20 });
  });

  test('new bounds below the floor are refused', () => {
    const task = node('bpmn:Task');
    expect(rules.canResize(task, { width: 100, height: 80 })).toBe(true);
    expect(rules.canResize(task, { width: 99, height: 80 })).toBe(false);
    expect(rules.canResize(task, { width: 100, height: 79 })).toBe(false);
    expect(rules.allowed('shape.resize', { shape: task, newBounds: { x: 0, y: 0, width: 40, height: 30 } }))
      .toBe(false);
  });

  test('an override replaces the built-in floor', () => {
    const loose = new Rules({ minSizes: { 'bpmn:Task': { width: 40, height: 30 } } });
    expect(loose.canResize(node('bpmn:Task'), { width: 40, height: 30 })).toBe(true);
    expect(minSizeFor('bpmn:Task', { 'bpmn:Task': { width: 1, height: 1 } })).toEqual({ width: 1, height: 1 });
  });

  test('a missing shape never resizes', () => {
    expect(rules.canResize(undefined)).toBe(false);
    expect(rules.allowed('shape.resize', {})).toBe(false);
  });
});

// --- append -----------------------------------------------------------------

test.describe('canvas rules: shape.append', () => {
  test('the context pad offers append on anything a sequence flow may leave', () => {
    for (const type of ['bpmn:Task', 'bpmn:UserTask', 'bpmn:StartEvent', 'bpmn:ExclusiveGateway',
      'bpmn:SubProcess', 'bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent']) {
      expect(rules.canAppend(node(type)), type).toBe(true);
    }
  });

  test('it does not on end events, artifacts, data shapes or pools', () => {
    for (const type of ['bpmn:EndEvent', 'bpmn:TextAnnotation', 'bpmn:Group',
      'bpmn:DataObjectReference', 'bpmn:Participant', 'bpmn:Lane']) {
      expect(rules.canAppend(node(type)), type).toBe(false);
    }
    expect(rules.canAppend(undefined)).toBe(false);
  });

  test('the AppendMenuProvider context key (`element`) is honoured', () => {
    expect(rules.allowed('shape.append', { element: node('bpmn:Task') })).toBe(true);
    expect(rules.allowed('shape.append', { element: node('bpmn:EndEvent') })).toBe(false);
  });
});

// --- the diagram-js-shaped entry point --------------------------------------

test.describe('canvas rules: allowed(action, context)', () => {
  test('an ungated action is allowed, as in diagram-js', () => {
    expect(rules.allowed('connection.updateWaypoints', {})).toBe(true);
    expect(rules.allowed('something.nobody.registered')).toBe(true);
  });

  test('elements.move checks every shape against the drop target', () => {
    const pool = node('bpmn:Participant');
    expect(rules.allowed('elements.move', { shapes: [node('bpmn:Task'), node('bpmn:StartEvent')], target: pool }))
      .toBe(true);
    expect(rules.allowed('elements.move', { shapes: [node('bpmn:Task'), node('bpmn:Participant')], target: pool }))
      .toBe(false);
    // No target: a plain move within the current parent is ungated.
    expect(rules.allowed('elements.move', { shapes: [node('bpmn:Participant')] })).toBe(true);
  });

  test('every verdict collapses to the boolean the EditorPort.rules adapter needs', () => {
    const verdicts = [
      rules.allowed('connection.create', { source: node('bpmn:Task'), target: node('bpmn:EndEvent') }),
      rules.allowed('shape.attach', { shape: node('bpmn:BoundaryEvent'), parent: node('bpmn:Task') }),
      rules.allowed('shape.append', { source: node('bpmn:Task') }),
    ];
    expect(verdicts.map((verdict) => !!verdict)).toEqual([true, true, true]);
  });
});
