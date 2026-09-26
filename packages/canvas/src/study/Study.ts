/**
 * A study: the document (its BPMN definitions and the scene drawn from them), the one place it is
 * edited, its undo history, and the news of each change. It needs no DOM: a canvas is one view of a
 * study, and several views may share one.
 */

import { definitionsToStudyflow, fromWireDefinitions, looksLikeXml, readerWarning, studyflowToDefinitions, toWireXml } from '@core/document';
import { setAttribute } from '@core/element/index.ts';
import type { Moddle } from '@core/element/moddle';
import { writeDi } from '@canvas/study/di.ts';
import { importDefinitions, type ImportOptions } from '@canvas/study/import.ts';
import { findById } from '@canvas/study/moddle.ts';
import { Mutator, type Commit } from '@canvas/study/mutator.ts';
import type { Drawable, ModdleObject, Scene } from '@canvas/study/scene.ts';
import { writerFor, type StudyWriter } from '@canvas/study/writer.ts';

/**
 * What one change did to the study, and why. An 'edit' is one commit: what it added, changed and removed. A
 * 'load', an 'undo' and a 'redo' put another document in place, and say so by id: what only the old one held is
 * removed, what only the new one holds added, and everything else changed, the root among it.
 */
export interface StudyChange extends Commit {
  readonly cause: 'edit' | 'load' | 'undo' | 'redo';
}

export interface OpenOptions extends ImportOptions {
  /** Reads the text: a moddle over the schemas the document uses. */
  moddle: Moddle;
}

/**
 * What one verb did, as data a host or an AI reads alike: the ids of the elements it added, changed and removed,
 * or, when `ok` is false, why it wrote nothing.
 */
export interface StudyResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
}

type ChangeListener = (change: StudyChange) => void;

/** How many edits an undo can go back through. */
const UNDO_DEPTH = 50;

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
  private readonly options: ImportOptions;
  /** The document after each edit, as `.studyflow.yaml` text, oldest first: what undo and redo go back and forth through. */
  private snapshots: string[];
  /** The snapshot of the document the study holds. */
  private current = 0;
  /** The last commit, for the verb that made it to report. */
  private committed?: Commit;

  private constructor(definitions: ModdleObject, options: ImportOptions) {
    this.options = options;
    this.read(definitions, 0);
    // As read, before any edit: the DI is the file's, so nothing is written back yet.
    this.snapshots = [definitionsToStudyflow(definitions)];
  }

  /** A study of `text`, a `.studyflow.yaml` or BPMN XML file. */
  static async open(text: string, options: OpenOptions): Promise<Study> {
    return new Study(await parse(text, options.moddle, options.onWarning), options);
  }

  /** A study of `definitions`, which it edits in place from here on. */
  static fromDefinitions(definitions: ModdleObject, options: ImportOptions = {}): Study {
    return new Study(definitions, options);
  }

  /** Replace the document with `source`, file text or definitions, as one change: a 'load', which the history starts over from. */
  async load(source: string | ModdleObject): Promise<void> {
    const definitions = typeof source === 'string' ? await parse(source, moddleOf(this.definitions), this.options.onWarning) : source;
    this.replace(definitions, 'load');
  }

  /** The document as a BPMN XML file holds it: the drawing written into its DI, and a pure choreography on its own root. */
  async toXml(): Promise<string> {
    const { scene } = studyInternals(this);
    writeDi(scene);
    const moddle = moddleOf(scene.definitions);
    const { xml } = await moddle.toXML(scene.definitions, { format: true });
    return toWireXml(xml, moddle);
  }

  /** The `bpmn:Definitions` the study edits: another object after a load, an undo or a redo. */
  get definitions(): ModdleObject {
    return studyInternals(this).scene.definitions;
  }

  /** Goes up by one on every change. */
  get revision(): number {
    return studyInternals(this).scene.revision;
  }

  /** Set `attribute` on the element `id` names, where its schema keeps it (core's `setAttribute`); 'name' renames. */
  set({ id, attribute, value }: { id: string; attribute: string; value: unknown }): StudyResult {
    const found = this.find(id);
    if (!found) return refused(`no element '${id}'`);
    return this.write(found.drawn, (writer) => setAttribute(found.moddle, attribute, value, writer));
  }

  /** Write the moddle behind `id` in place, as one commit: for what `set` cannot spell. In-process only, not a tool. */
  edit(id: string, write: (writer: StudyWriter) => void): StudyResult {
    const found = this.find(id);
    if (!found) return refused(`no element '${id}'`);
    return this.write(found.drawn, write);
  }

  /** Go back to the document before the last edit; false when the history holds none. */
  undo(): boolean {
    return this.travel(-1);
  }

  /** Go forward to the edit the last undo went back from; false when there is none. */
  redo(): boolean {
    return this.travel(1);
  }

  get canUndo(): boolean {
    return this.current > 0;
  }

  get canRedo(): boolean {
    return this.current < this.snapshots.length - 1;
  }

  /** Hear each change, once, in the order listeners subscribed; the returned function unsubscribes. */
  on(_event: 'change', listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Edit `definitions` from here on, in the form the canvas edits (as a file opens), and return their scene. */
  private read(definitions: ModdleObject, revision: number): Scene {
    fromWireDefinitions(definitions, this.options.onWarning);
    const scene = importDefinitions(definitions, this.options);
    scene.revision = revision;
    internals.set(this, { scene, mutator: new Mutator(scene, (commit) => this.edited(commit)) });
    return scene;
  }

  /**
   * The element `id` names, and the moddle behind it: a drawn one (a caption stands for what it captions), the root,
   * or anything else the document holds, which is not drawn.
   */
  private find(id: string): { drawn?: Drawable; moddle: ModdleObject } | undefined {
    const { scene } = studyInternals(this);
    if (id === scene.rootElement.id) return { moddle: scene.rootElement.businessObject };
    const element = scene.elementsById.get(id);
    if (element) {
      const drawn = element.kind === 'label' ? element.owner : element;
      return { drawn, moddle: drawn.businessObject };
    }
    const moddle = findById(scene.definitions, id);
    return moddle && { moddle };
  }

  /** Run `write` as one commit about `drawn` (the root, without it), and say what it did by id. */
  private write(drawn: Drawable | undefined, write: (writer: StudyWriter) => void): StudyResult {
    const { scene, mutator } = studyInternals(this);
    this.takeCommitted();
    mutator.batch(() => write(writerFor(scene, mutator, drawn)));
    const commit = this.takeCommitted();
    return {
      ok: true,
      added: (commit?.added ?? []).map((element) => element.id),
      changed: (commit?.changed ?? []).map((element) => element.id),
      removed: (commit?.removed ?? []).map((element) => element.id),
    };
  }

  /** The commit made since the last take: none when nothing was written, or when a batch around this one is still open. */
  private takeCommitted(): Commit | undefined {
    const commit = this.committed;
    this.committed = undefined;
    return commit;
  }

  /** A commit: the document as it now stands is the newest snapshot, unless it is the one the study holds. */
  private edited(commit: Commit): void {
    this.committed = commit;
    const { scene } = studyInternals(this);
    writeDi(scene);
    const snapshot = definitionsToStudyflow(scene.definitions);
    if (snapshot !== this.snapshots[this.current]) {
      this.snapshots.length = this.current + 1;
      this.snapshots.push(snapshot);
      if (this.snapshots.length > UNDO_DEPTH + 1) this.snapshots.shift();
      this.current = this.snapshots.length - 1;
    }
    this.announce({ cause: 'edit', ...commit });
  }

  private travel(step: -1 | 1): boolean {
    const snapshot = this.snapshots[this.current + step];
    if (snapshot === undefined) return false;
    this.current += step;
    this.replace(studyflowToDefinitions(snapshot, moddleOf(this.definitions), this.options.onWarning), step < 0 ? 'undo' : 'redo');
    return true;
  }

  /** Put `definitions` in place of the document, as one change; a load starts the history over. */
  private replace(definitions: ModdleObject, cause: 'load' | 'undo' | 'redo'): void {
    const before = studyInternals(this).scene;
    const after = this.read(definitions, before.revision + 1);
    if (cause === 'load') {
      this.snapshots = [definitionsToStudyflow(definitions)];
      this.current = 0;
    }
    this.announce({ cause, ...byId(before, after) });
  }

  private announce(change: StudyChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}

function refused(reason: string): StudyResult {
  return { ok: false, reason, added: [], changed: [], removed: [] };
}

/** File text, `.studyflow.yaml` or BPMN XML, as definitions. */
async function parse(text: string, moddle: Moddle, onWarning?: (message: string) => void): Promise<ModdleObject> {
  if (!looksLikeXml(text)) return studyflowToDefinitions(text, moddle, onWarning);
  const { rootElement, warnings } = await moddle.fromXML(text);
  for (const warning of warnings) onWarning?.(readerWarning(warning));
  return rootElement;
}

/** The moddle that built `definitions`: it reads and writes their files. */
function moddleOf(definitions: ModdleObject): Moddle {
  return definitions.$model as Moddle;
}

/** One scene in place of another, by id: the nodes and edges only `before` held, those only `after` holds, and the rest. */
function byId(before: Scene, after: Scene): Commit {
  const drawables = (scene: Scene): Drawable[] => [...scene.elementsById.values()].filter((element): element is Drawable => element.kind !== 'label');
  const kept = drawables(after).filter((element) => before.elementsById.has(element.id));
  return {
    added: drawables(after).filter((element) => !before.elementsById.has(element.id)),
    changed: [after.rootElement, ...kept],
    removed: drawables(before).filter((element) => !after.elementsById.has(element.id)),
  };
}
