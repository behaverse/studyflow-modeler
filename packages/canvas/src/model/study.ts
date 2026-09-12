/**
 * The study is the diagram's root, whichever kind it is. The first pool turns a process root into a
 * collaboration (`model/mutator.ts`) and deleting the last pool turns it back (`model/remove.ts`); the study
 * stays the same object through both, so what makes it the study passes from one root to the other.
 */

import { renameStateEntry, STUDY_EXTENSION_TYPE } from '@core/document/index.ts';

import type { IdGenerator } from '@canvas/model/ids.ts';
import { asModdle, modelOf, moveExtension, prop, setParent, setProp } from '@canvas/model/moddle.ts';
import type { ModdleObject, Scene } from '@canvas/model/scene.ts';

/** What each root keeps: its id (swapped instead), its content, and its extensions but the Study. */
const KEPT = new Set(['id', 'artifacts', 'extensionElements']);

type Described = {
  $descriptor?: { properties?: { name: string; default?: unknown }[]; propertiesByName?: Record<string, unknown> };
};

/**
 * `to` becomes the root and takes the study over from `from`: its id, the fields both kinds declare (name,
 * documentation, tags) and the Study; `from` gets a fresh id. The process's entry in the run state follows the
 * process's id, since its properties are what the entry holds.
 */
export function handOverStudy(scene: Scene, from: ModdleObject, to: ModdleObject, ids: IdGenerator): void {
  const process = from.$type === 'bpmn:Process' ? from : to;
  const scope = process.id;
  to.id = from.id;
  from.id = ids.next(from.$type);
  const shared = (to as Described).$descriptor?.propertiesByName ?? {};
  for (const property of (from as Described).$descriptor?.properties ?? []) {
    if (KEPT.has(property.name) || !shared[property.name]) continue;
    const value = prop(from, property.name);
    if (value === undefined || value === property.default || (Array.isArray(value) && value.length === 0)) continue;
    setProp(to, property.name, value);
    setProp(from, property.name, undefined);
    for (const child of Array.isArray(value) ? value : [value]) if (asModdle(child)) setParent(child, to);
  }
  const study = moveExtension(from, to, STUDY_EXTENSION_TYPE, modelOf(scene.definitions));
  if (study && scope && process.id) renameStateEntry(study, scope, process.id);
  setRoot(scene, to);
}

/** Make `root` what the diagram depicts; the root element stays the same object. */
function setRoot(scene: Scene, root: ModdleObject): void {
  scene.root = root;
  const element = scene.rootElement as { id: string; type: string; businessObject: ModdleObject };
  element.businessObject = root;
  element.id = String(root.id ?? element.id);
  element.type = root.$type;
}
