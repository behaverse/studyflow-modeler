/**
 * The study is the diagram's root, whichever kind it is. The first pool turns a process root into a
 * collaboration (`study/mutator.ts`) and deleting the last pool turns it back (`study/remove.ts`). What
 * that means for the study is core's `handOverStudyIn`; the scene only changes which root it depicts.
 */

import type { Element } from '@core/model/index.ts';
import { handOverStudyIn } from '@core/model/root.ts';

import type { IdGenerator } from '@canvas/study/ids.ts';
import type { Scene } from '@canvas/study/scene.ts';

/** `to` becomes the root the diagram depicts and takes the study over from `from`, which gets a fresh id. */
export function changeRoot(scene: Scene, from: Element, to: Element, ids: IdGenerator): void {
  handOverStudyIn(scene.model, from, to, ids.next(scene.model.host(from)));
  scene.root = to;
  // The root element stays the same object, for whoever holds it; only what it depicts changes.
  const element = scene.rootElement as { id: string; type: string; element: Element };
  element.element = to;
  element.id = String(to.id ?? element.id);
  element.type = scene.model.host(to);
}
