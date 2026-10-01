/**
 * Data associations: create and delete `bpmn:DataInputAssociation` and
 * `bpmn:DataOutputAssociation` between a data shape and an activity.
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
 * Like `study/remove.ts`, this module only writes the study model; the scene
 * bookkeeping, the revision bump and the events are the Mutator's.
 */

import { IdGenerator } from '@canvas/study/ids.ts';
import { addRef, dropRef, idsIn, listOf, mint, nameOf, setRef } from '@canvas/study/elements.ts';
import type { SceneNode } from '@canvas/study/scene.ts';
import { isDataShape } from '@core/document/outline.ts';
import { associationPropertyFor, type DataAssociationDirection } from '@core/element/index.ts';
import { isElement, type Element, type StudyModel } from '@core/model/index.ts';

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
 * that way (`study/rules.ts` `structuralConnection`: a data shape as source yields a
 * `DataInputAssociation`, a data shape as target a `DataOutputAssociation`) — so the
 * type is derived from which end is the data shape rather than trusted from the
 * caller.
 *
 * Returns `undefined` when the pair is not one data shape and one shape that can
 * actually hold that direction, which is exactly when the rules refuse it: only
 * `bpmn:Activity` and `bpmn:ThrowEvent` own `dataInputAssociations`, and only
 * `bpmn:Activity` and `bpmn:CatchEvent` own `dataOutputAssociations`, so the metamodel is asked.
 */
export function dataAssociationEnds(
  model: StudyModel,
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
  return model.property(ends.activity.element, associationPropertyFor(ends.direction)) ? ends : undefined;
}

/** The activity a data association hangs off, read from the study: the element that holds it. */
export function activityOf(model: StudyModel, association: Element): Element | undefined {
  const parent = model.parentOf(association);
  return parent && !isDataShape(model.host(parent)) ? parent : undefined;
}

/**
 * Wire a freshly minted association to its two ends and file it on the activity: its `sourceRef`/`targetRef` at the
 * schema's own cardinality (`sourceRef` is a list, `targetRef` is not), the `ioSpecification` slot minted when the
 * activity declares one, and the association in the activity's `dataInput|OutputAssociations`.
 */
export function wireDataAssociation(
  model: StudyModel,
  association: Element,
  ends: DataAssociationEnds,
  ids: IdGenerator,
): void {
  const activity = ends.activity.element;
  const data = ends.data.element;
  const io = ioSpecificationOf(activity);

  if (ends.direction === 'input') {
    setRef(model, association, 'sourceRef', data);
    // With no `ioSpecification` the target slot stays unset — the compact form core's
    // `expandIoSpecification` fills in on the way out to standard BPMN.
    if (io) setRef(model, association, 'targetRef', mintDataInput(model, io, activity, data, ids));
  } else {
    setRef(model, association, 'targetRef', data);
    if (io) setRef(model, association, 'sourceRef', mintDataOutput(model, io, activity, ids));
  }

  model.file(association, activity, associationPropertyFor(ends.direction));
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
export function pruneDataAssociation(model: StudyModel, association: Element, activity: Element | undefined): void {
  if (!activity) return;
  const io = ioSpecificationOf(activity);
  if (!io) return;

  const declarations = [...idsIn(association.targetRef), ...idsIn(association.sourceRef)]
    .map((id) => model.get(id))
    .filter((ref): ref is Element => !!ref && (ref.type === 'bpmn:DataInput' || ref.type === 'bpmn:DataOutput'));

  for (const declaration of declarations) {
    if (isStillDeclared(activity, declaration, association)) continue;
    for (const set of listOf(io, 'inputSets')) dropRef(set, 'dataInputRefs', declaration);
    for (const set of listOf(io, 'outputSets')) dropRef(set, 'dataOutputRefs', declaration);
    model.unfile(declaration);
  }

  if (listOf(io, 'dataInputs').length > 0) return;
  if (listOf(io, 'dataOutputs').length > 0) return;
  // An `ioSpecification` declaring neither inputs nor outputs is noise the compact
  // form has no room for; core's own inlining drops it for exactly this reason.
  model.unfile(io);
}

// --- internals ---------------------------------------------------------------

/** The activity's `bpmn:InputOutputSpecification`, when it declares one. */
function ioSpecificationOf(activity: Element): Element | undefined {
  return isElement(activity.ioSpecification) ? activity.ioSpecification : undefined;
}

/** Whether anything other than `exclude` still needs `declaration`. */
function isStillDeclared(activity: Element, declaration: Element, exclude: Element): boolean {
  for (const direction of ['input', 'output'] as const) {
    for (const association of listOf(activity, associationPropertyFor(direction))) {
      if (association === exclude) continue;
      if ([...idsIn(association.sourceRef), ...idsIn(association.targetRef)].includes(declaration.id!)) return true;
    }
  }
  // A multi-instance marker may bind the same slot (`@core/document/io-specification.ts`
  // refuses to inline an activity whose `loopCharacteristics` reference it).
  const loop = activity.loopCharacteristics;
  if (!isElement(loop)) return false;
  return ['loopDataInputRef', 'loopDataOutputRef', 'inputDataItem', 'outputDataItem']
    .some((name) => idsIn(loop[name]).includes(declaration.id!));
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
function mintDataInput(model: StudyModel, io: Element, activity: Element, data: Element, ids: IdGenerator): Element {
  const name = nameOf(data) || data.id || 'input';
  const dataInput = mint('bpmn:DataInput', { id: uniqueId(ids, `${activityId(activity)}_in_${idSlug(name)}`), name });
  model.file(dataInput, io, 'dataInputs');
  addRef(setOf(model, io, 'inputSets', activity, ids), 'dataInputRefs', dataInput);
  return dataInput;
}

/**
 * The `bpmn:DataOutput` an association's `sourceRef` points at. Core folds every
 * implicit output of an activity onto ONE `result` slot, so an existing one is
 * reused rather than duplicated.
 */
function mintDataOutput(model: StudyModel, io: Element, activity: Element, ids: IdGenerator): Element {
  const existing = listOf(io, 'dataOutputs').find((out) => nameOf(out) === 'result');
  if (existing) {
    addRef(setOf(model, io, 'outputSets', activity, ids), 'dataOutputRefs', existing);
    return existing;
  }
  const dataOutput = mint('bpmn:DataOutput', { id: uniqueId(ids, `${activityId(activity)}_result`), name: 'result' });
  model.file(dataOutput, io, 'dataOutputs');
  addRef(setOf(model, io, 'outputSets', activity, ids), 'dataOutputRefs', dataOutput);
  return dataOutput;
}

/** The first `bpmn:InputSet`/`bpmn:OutputSet` of an `ioSpecification`, minted if absent. */
function setOf(model: StudyModel, io: Element, property: 'inputSets' | 'outputSets', activity: Element, ids: IdGenerator): Element {
  const existing = listOf(io, property)[0];
  if (existing) return existing;
  const suffix = property === 'inputSets' ? 'inputSet' : 'outputSet';
  const created = mint(property === 'inputSets' ? 'bpmn:InputSet' : 'bpmn:OutputSet', { id: uniqueId(ids, `${activityId(activity)}_${suffix}`) });
  model.file(created, io, property);
  return created;
}

function activityId(activity: Element): string {
  return activity.id || 'activity';
}

