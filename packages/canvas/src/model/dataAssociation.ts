/**
 * Data associations — create/delete `bpmn:DataInputAssociation` and
 * `bpmn:DataOutputAssociation` between a data shape and an activity (design §1
 * "add edge … delete → remove BO from its container **and** its `planeElement`",
 * §2 "Data … data-input/output associations (dotted)", §6 P5).
 *
 * A data association is the one connection that is **not** filed in a container.
 * It hangs off the activity itself — `activity.dataInputAssociations` /
 * `activity.dataOutputAssociations` — and only one of its two ends is a reference
 * to the data shape:
 *
 * | | `sourceRef` (isMany) | `targetRef` | filed on |
 * |---|---|---|---|
 * | `DataInputAssociation` (data → activity) | `[dataShape]` | the activity's *input slot* | `activity.dataInputAssociations` |
 * | `DataOutputAssociation` (activity → data) | the activity's *output slot* | `dataShape` | `activity.dataOutputAssociations` |
 *
 * The "slot" is where the two shapes of a studyflow document diverge, and this
 * module writes whichever one the activity is already in (`@core/document/io-specification.ts`
 * is the authority on both):
 *
 * - **Compact form** — the activity has no `bpmn:InputOutputSpecification`. The slot
 *   ref is simply left unset; `expandIoSpecification` mints the `bpmn:DataInput` /
 *   `bpmn:DataOutput` (and the input/output sets) on the way out to standard BPMN,
 *   and `inlineIoSpecification` folds it away again on the way in. This is what the
 *   canvas sees for a document the app imported, so it is the common path.
 * - **Declared form** — the activity carries an `ioSpecification` (a standard-BPMN
 *   document opened as-is, e.g. the shipped `sklearn_pipeline` example). Then a bare
 *   association would be a dangling half-declaration, so the slot is minted too: a
 *   `bpmn:DataInput`/`bpmn:DataOutput` filed in the `ioSpecification` and referenced
 *   from its `inputSets`/`outputSets`, named the way core's own expansion names it.
 *
 * {@link pruneDataAssociation} is the exact inverse of that second half: deleting an
 * association gives back the slot it minted (and the `ioSpecification` itself once
 * it declares nothing), so a create+delete round-trips to the document it started
 * from instead of leaving a declared-but-unassociated `dataInput` behind — which
 * would silently make the activity un-inlineable on the next save.
 *
 * As with `model/remove.ts` and `model/expand.ts`, this module only mutates the
 * moddle tree; the scene bookkeeping, revision bump and bus events stay in
 * `model/writeback.ts`.
 */

import { IdGenerator } from '@canvas/model/ids.ts';
import {
  asList,
  asModdle,
  clearParent,
  mint,
  modelOf,
  nameOf,
  prop,
  pullFrom,
  pushInto,
  refBOs,
  setParent,
  setProp,
  setRef,
  type ModdleFactory,
} from '@canvas/model/moddle.ts';
import type { ModdleObject, SceneNode } from '@canvas/model/scene.ts';
import { isDataShape } from '@canvas/rules/rules.ts';

/** The association a data shape feeding an activity is drawn as. */
export const DATA_INPUT_ASSOCIATION = 'bpmn:DataInputAssociation';
/** The association an activity producing a data shape is drawn as. */
export const DATA_OUTPUT_ASSOCIATION = 'bpmn:DataOutputAssociation';

/** Which way the data flows, relative to the activity. */
export type DataAssociationDirection = 'input' | 'output';

/** Whether `type` is one of the two data-association types. */
export function isDataAssociationType(type: string): boolean {
  return type === DATA_INPUT_ASSOCIATION || type === DATA_OUTPUT_ASSOCIATION;
}

/** The association type for a direction. */
export function typeForDirection(direction: DataAssociationDirection): string {
  return direction === 'input' ? DATA_INPUT_ASSOCIATION : DATA_OUTPUT_ASSOCIATION;
}

/** The two ends of a data association, sorted into their BPMN roles. */
export interface DataAssociationEnds {
  /** The data shape (`bpmn:DataObjectReference`, `bpmn:DataStoreReference`, …). */
  data: SceneNode;
  /** The activity (or event) the association hangs off. */
  activity: SceneNode;
  direction: DataAssociationDirection;
}

/**
 * Sort a `source → target` pair into `{ data, activity, direction }`.
 *
 * The drawn direction *is* the BPMN direction — the rules already classify the pair
 * that way (`rules/rules.ts` `structuralConnection`: a data shape as source yields a
 * `DataInputAssociation`, a data shape as target a `DataOutputAssociation`) — so the
 * type is derived from which end is the data shape rather than trusted from the
 * caller.
 *
 * Returns `undefined` when the pair is not one data shape and one shape that can
 * actually hold that direction, which is exactly when the rules refuse it. The
 * second half matters: only `bpmn:Activity` and `bpmn:ThrowEvent` own
 * `dataInputAssociations`, and only `bpmn:Activity` and `bpmn:CatchEvent` own
 * `dataOutputAssociations` — filing one onto, say, a start event would land in
 * moddle's `$attrs` and serialize as garbage, so the descriptor is asked.
 */
export function dataAssociationEnds(
  source: SceneNode | undefined,
  target: SceneNode | undefined,
): DataAssociationEnds | undefined {
  if (!source || !target || source === target) return undefined;
  const sourceIsData = isDataShape(source.type);
  const targetIsData = isDataShape(target.type);
  if (sourceIsData === targetIsData) return undefined;
  const ends: DataAssociationEnds = sourceIsData
    ? { data: source, activity: target, direction: 'input' }
    : { data: target, activity: source, direction: 'output' };
  return canHoldAssociations(ends.activity.businessObject, ends.direction) ? ends : undefined;
}

/**
 * Whether `bo`'s moddle descriptor declares the association list for `direction`.
 * A plain bag with no descriptor (the hand-built-scene fallback) is trusted.
 */
function canHoldAssociations(bo: ModdleObject, direction: DataAssociationDirection): boolean {
  const byName = (bo as { $descriptor?: { propertiesByName?: Record<string, unknown> } })
    .$descriptor?.propertiesByName;
  if (!byName) return true;
  return byName[associationPropertyFor(direction)] !== undefined;
}

/**
 * The activity a data association hangs off, read from the *document* rather than
 * from the scene: the association's own moddle `$parent`. Used by deletion, which
 * must find the owner even for an association the importer could only half resolve.
 */
export function activityOf(bo: ModdleObject): ModdleObject | undefined {
  const parent = asModdle((bo as { $parent?: unknown }).$parent);
  return parent && !isDataShape(parent.$type) ? parent : undefined;
}

/** The list property a direction's associations are filed under. */
export function associationPropertyFor(direction: DataAssociationDirection): string {
  return direction === 'input' ? 'dataInputAssociations' : 'dataOutputAssociations';
}

/**
 * Wire a freshly minted association business object to its two ends and file it on
 * the activity. Writes `sourceRef`/`targetRef` at the schema's own cardinality
 * ({@link setRef} reads the descriptor: `sourceRef` is a list, `targetRef` is not),
 * mints the `ioSpecification` slot when the activity declares one, and pushes the
 * association into the activity's `dataInput|OutputAssociations`.
 */
export function wireDataAssociation(
  bo: ModdleObject,
  ends: DataAssociationEnds,
  ids: IdGenerator,
): void {
  const activity = ends.activity.businessObject;
  const data = ends.data.businessObject;
  const io = ioSpecificationOf(activity);
  const factory = modelOf(activity) ?? modelOf(data) ?? modelOf(bo);

  if (ends.direction === 'input') {
    setRef(bo, 'sourceRef', data);
    // With no `ioSpecification` the target slot stays unset — the compact form core's
    // `expandIoSpecification` fills in on the way out to standard BPMN.
    if (io) setRef(bo, 'targetRef', mintDataInput(io, activity, data, factory, ids));
  } else {
    setRef(bo, 'targetRef', data);
    if (io) setRef(bo, 'sourceRef', mintDataOutput(io, activity, factory, ids));
  }

  setParent(bo, activity);
  pushInto(activity, associationPropertyFor(ends.direction), bo);
}

/**
 * Give back the `ioSpecification` slot a removed association owned: the
 * `bpmn:DataInput`/`bpmn:DataOutput` it referenced (unless another association on the
 * same activity still does), that slot's entry in every input/output set, and the
 * `ioSpecification` itself once it declares nothing at all.
 *
 * Call it while the association is still wired — before its refs are cleared and
 * before it is unfiled — so its slot is still reachable.
 */
export function pruneDataAssociation(bo: ModdleObject, activity: ModdleObject | undefined): void {
  if (!activity) return;
  const io = ioSpecificationOf(activity);
  if (!io) return;

  const declarations = [
    ...refBOs(prop(bo, 'targetRef')),
    ...refBOs(prop(bo, 'sourceRef')),
  ].filter((ref) => ref.$type === 'bpmn:DataInput' || ref.$type === 'bpmn:DataOutput');

  for (const declaration of declarations) {
    if (isStillDeclared(activity, declaration, bo)) continue;
    pullFrom(io, declaration.$type === 'bpmn:DataInput' ? 'dataInputs' : 'dataOutputs', declaration);
    for (const set of asList(prop(io, 'inputSets'))) pullFrom(set, 'dataInputRefs', declaration);
    for (const set of asList(prop(io, 'outputSets'))) pullFrom(set, 'dataOutputRefs', declaration);
    clearParent(declaration);
  }

  if (asList(prop(io, 'dataInputs')).length > 0) return;
  if (asList(prop(io, 'dataOutputs')).length > 0) return;
  // An `ioSpecification` declaring neither inputs nor outputs is noise the compact
  // form has no room for; core's own inlining drops it for exactly this reason.
  setProp(activity, 'ioSpecification', undefined);
  clearParent(io);
}

// --- internals ---------------------------------------------------------------

/** The activity's `bpmn:InputOutputSpecification`, when it declares one. */
function ioSpecificationOf(activity: ModdleObject): ModdleObject | undefined {
  return asModdle(prop(activity, 'ioSpecification'));
}

/** Whether anything other than `exclude` still needs `declaration`. */
function isStillDeclared(
  activity: ModdleObject,
  declaration: ModdleObject,
  exclude: ModdleObject,
): boolean {
  for (const direction of ['input', 'output'] as const) {
    for (const association of asList(prop(activity, associationPropertyFor(direction)))) {
      if (association === exclude) continue;
      if (refBOs(prop(association, 'sourceRef')).includes(declaration)) return true;
      if (refBOs(prop(association, 'targetRef')).includes(declaration)) return true;
    }
  }
  // A multi-instance marker may bind the same slot (`@core/document/io-specification.ts`
  // refuses to inline an activity whose `loopCharacteristics` reference it).
  const loop = asModdle(prop(activity, 'loopCharacteristics'));
  if (!loop) return false;
  return ['loopDataInputRef', 'loopDataOutputRef', 'inputDataItem', 'outputDataItem']
    .some((name) => refBOs(prop(loop, name)).includes(declaration));
}

/** A document-unique id for `base`, falling back to a counter suffix when taken. */
function uniqueId(ids: IdGenerator, base: string): string {
  if (ids.assigned(base)) return ids.nextPrefixed(`${base}_`);
  ids.claim(base);
  return base;
}

/** Core's own id slug for an io slot (`@core/document/io-specification.ts` `idSlug`). */
function idSlug(name: string): string {
  return name.replace(/[^A-Za-z0-9_]+/g, '_');
}

/**
 * Mint the `bpmn:DataInput` an association's `targetRef` points at, named after the
 * data shape it is fed from — the same slot name (and id shape) core's
 * `expandIoSpecification` would have produced for the compact form.
 */
function mintDataInput(
  io: ModdleObject,
  activity: ModdleObject,
  data: ModdleObject,
  factory: ModdleFactory | undefined,
  ids: IdGenerator,
): ModdleObject {
  const name = nameOf(data) || (typeof data.id === 'string' ? data.id : '') || 'input';
  const id = uniqueId(ids, `${activityId(activity)}_in_${idSlug(name)}`);
  const dataInput = mint(factory, 'bpmn:DataInput', { id, name });
  setParent(dataInput, io);
  pushInto(io, 'dataInputs', dataInput);
  pushInto(setOf(io, 'inputSets', activity, factory, ids), 'dataInputRefs', dataInput);
  return dataInput;
}

/**
 * The `bpmn:DataOutput` an association's `sourceRef` points at. Core folds every
 * implicit output of an activity onto ONE `result` slot, so an existing one is
 * reused rather than duplicated.
 */
function mintDataOutput(
  io: ModdleObject,
  activity: ModdleObject,
  factory: ModdleFactory | undefined,
  ids: IdGenerator,
): ModdleObject {
  const existing = asList(prop(io, 'dataOutputs')).find((out) => nameOf(out) === 'result');
  if (existing) {
    pushInto(setOf(io, 'outputSets', activity, factory, ids), 'dataOutputRefs', existing);
    return existing;
  }
  const dataOutput = mint(factory, 'bpmn:DataOutput', {
    id: uniqueId(ids, `${activityId(activity)}_result`),
    name: 'result',
  });
  setParent(dataOutput, io);
  pushInto(io, 'dataOutputs', dataOutput);
  pushInto(setOf(io, 'outputSets', activity, factory, ids), 'dataOutputRefs', dataOutput);
  return dataOutput;
}

/** The first `bpmn:InputSet`/`bpmn:OutputSet` of an `ioSpecification`, minted if absent. */
function setOf(
  io: ModdleObject,
  property: 'inputSets' | 'outputSets',
  activity: ModdleObject,
  factory: ModdleFactory | undefined,
  ids: IdGenerator,
): ModdleObject {
  const existing = asList(prop(io, property))[0];
  if (existing) return existing;
  const suffix = property === 'inputSets' ? 'inputSet' : 'outputSet';
  const created = mint(factory, property === 'inputSets' ? 'bpmn:InputSet' : 'bpmn:OutputSet', {
    id: uniqueId(ids, `${activityId(activity)}_${suffix}`),
  });
  setParent(created, io);
  pushInto(io, property, created);
  return created;
}

function activityId(activity: ModdleObject): string {
  return typeof activity.id === 'string' && activity.id ? activity.id : 'activity';
}
