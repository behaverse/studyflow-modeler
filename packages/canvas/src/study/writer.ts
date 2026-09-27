/**
 * The writes of one `edit`: each goes onto moddle, is recorded against the element the edit is about, and
 * redraws wherever the written value shows (a participant's name on every task that takes it, say).
 */

import { isDataShape } from '@core/document/outline.ts';
import type { ModdleWriter } from '@core/element/index.ts';
import { getProperty, setProperty } from '@core/element/moddle.ts';
import { tasksReferencing } from '@canvas/study/choreography.ts';
import { idPrefixFor, needsId, type IdGenerator } from '@canvas/study/ids.ts';
import { mint, modelOf } from '@canvas/study/moddle.ts';
import type { Mutator } from '@canvas/study/mutator.ts';
import type { Drawable, ModdleObject, Scene, SceneNode } from '@canvas/study/scene.ts';

/** What an `edit` hands its callback: writes the study records, and new moddle with ids of its own. */
export interface StudyWriter extends ModdleWriter {
  /** A new moddle element, holding an id no other element holds when its type carries one. */
  create(type: string, properties?: Record<string, unknown>): ModdleObject;
  /** `base`, else `base_2`, `base_3`…: the first id the document does not hold, taken from now on. */
  freeId(base: string): string;
  /** The document's ids, for helpers that mint their own (core's choreography participants). */
  readonly ids: Pick<IdGenerator, 'assigned' | 'nextPrefixed'>;
}

/** The writer of an edit about `about`, a drawn element; without one, the edit is recorded on the root. */
export function writerFor(scene: Scene, mutator: Mutator, about: Drawable | undefined): StudyWriter {
  const { ids } = mutator;
  return {
    set(target, props) {
      const moddle = target as ModdleObject;
      for (const [key, value] of Object.entries(props)) {
        if (getProperty(moddle, key) !== value) setProperty(moddle, key, value);
      }
      if (about) mutator.touch(drawnFrom(scene, about, moddle, props));
      else mutator.record(scene.rootElement);
    },
    create(type, properties = {}) {
      const element = mint(modelOf(scene.definitions), type, properties);
      if (element.id) ids.claim(element.id);
      else if (needsId(element)) element.id = ids.nextPrefixed(idPrefixFor(element), element);
      return element;
    },
    freeId(base) {
      let id = base;
      for (let n = 2; ids.assigned(id); n += 1) id = `${base}_${n}`;
      ids.claim(id);
      return id;
    },
    ids,
  };
}

/** What draws something of `moddle` once `properties` are written on it: `target`, and whatever else shows it. */
function drawnFrom(scene: Scene, target: Drawable, moddle: ModdleObject, properties: Record<string, unknown>): Drawable[] {
  // A participant's name is drawn on every choreography task it takes a band of, not only where it was edited.
  if (target.kind === 'node' && moddle.$type === 'bpmn:Participant' && 'name' in properties) {
    return tasksReferencing(scene, moddle, target);
  }
  const drawn = new Set<Drawable>([target]);
  // A flow draws its source's `default` as a slash, so a new default redraws every flow that leaves the source.
  const source = scene.byBusinessObject.get(moddle);
  if ('default' in properties && source?.kind === 'node') for (const edge of source.outgoing) drawn.add(edge);
  // A step may draw what the data it reads holds (a glyph a Parameters object sets).
  if (target.kind === 'node' && isDataShape(target.type)) for (const step of stepsReading(scene, target)) drawn.add(step);
  return [...drawn];
}

/** Every step whose data inputs read `source`. */
function stepsReading(scene: Scene, source: SceneNode): SceneNode[] {
  const out: SceneNode[] = [];
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'node' || element === source) continue;
    const associations = (getProperty(element.businessObject, 'dataInputAssociations') ?? []) as ModdleObject[];
    if (associations.some((association) => ((getProperty(association, 'sourceRef') ?? []) as unknown[]).includes(source.businessObject))) {
      out.push(element);
    }
  }
  return out;
}
