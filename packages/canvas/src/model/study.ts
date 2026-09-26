/**
 * The study is the diagram's root, whichever kind it is. The first pool turns a process root into a
 * collaboration (`model/mutator.ts`) and deleting the last pool turns it back (`model/remove.ts`). What
 * that means for the document is core's `handOverStudy`; the scene only changes which root it depicts.
 */

import { handOverStudy } from '@core/document/index.ts';

import type { IdGenerator } from '@canvas/model/ids.ts';
import type { ModdleObject, Scene } from '@canvas/model/scene.ts';

/** `to` becomes the root the diagram depicts and takes the study over from `from`, which gets a fresh id. */
export function changeRoot(scene: Scene, from: ModdleObject, to: ModdleObject, ids: IdGenerator): void {
  handOverStudy(from, to, ids.next(from.$type));
  scene.root = to;
  // The root element stays the same object, for whoever holds it; only what it depicts changes.
  const element = scene.rootElement as { id: string; type: string; businessObject: ModdleObject };
  element.businessObject = to;
  element.id = String(to.id ?? element.id);
  element.type = to.$type;
}
