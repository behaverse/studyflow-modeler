/**
 * A study: the document (its BPMN definitions and the scene drawn from them), the one place it is
 * edited, and the news of each edit. It needs no DOM: a canvas is one view of a study, and several
 * views may share one.
 */

import { importDefinitions, type ImportOptions } from '@canvas/study/import.ts';
import { Mutator, type Commit } from '@canvas/study/mutator.ts';
import type { ModdleObject, Scene } from '@canvas/study/scene.ts';

/** What one commit did to the study, and why. */
export interface StudyChange extends Commit {
  readonly cause: 'edit';
}

type ChangeListener = (change: StudyChange) => void;

/** What the canvas package reads and writes behind a study's public surface. */
export interface StudyInternals {
  readonly scene: Scene;
  readonly mutator: Mutator;
}

const internals = new WeakMap<Study, StudyInternals>();

/** The scene and mutator behind `study`, for the canvas's views and gestures. The package index does not export it. */
export function studyInternals(study: Study): StudyInternals {
  return internals.get(study)!;
}

export class Study {
  private readonly listeners = new Set<ChangeListener>();

  constructor(definitions: ModdleObject, options: ImportOptions = {}) {
    const scene = importDefinitions(definitions, options);
    const mutator = new Mutator(scene, (commit) => this.announce({ cause: 'edit', ...commit }));
    internals.set(this, { scene, mutator });
  }

  /** The `bpmn:Definitions` the study edits. */
  get definitions(): ModdleObject {
    return studyInternals(this).scene.definitions;
  }

  /** Goes up by one on every commit. */
  get revision(): number {
    return studyInternals(this).scene.revision;
  }

  /** Hear each commit, once, in the order listeners subscribed; the returned function unsubscribes. */
  on(_event: 'change', listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private announce(change: StudyChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}
