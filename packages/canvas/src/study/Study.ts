/**
 * A study: the document (its BPMN definitions and the scene drawn from them), the one place it is
 * edited, and the news of each edit. It needs no DOM: a canvas is one view of a study, and several
 * views may share one.
 */

import { fromWireDefinitions, looksLikeXml, readerWarning, studyflowToDefinitions, toWireXml } from '@core/document';
import type { Moddle } from '@core/element/moddle';
import { writeDi } from '@canvas/study/di.ts';
import { importDefinitions, type ImportOptions } from '@canvas/study/import.ts';
import { Mutator, type Commit } from '@canvas/study/mutator.ts';
import type { Drawable, ModdleObject, Scene } from '@canvas/study/scene.ts';

/**
 * What one commit did to the study, and why. An 'edit' says what it added, changed and removed; a 'load' is a
 * whole new document: everything before it removed, everything after it added, and the root changed.
 */
export interface StudyChange extends Commit {
  readonly cause: 'edit' | 'load';
}

export interface OpenOptions extends ImportOptions {
  /** Reads the text: a moddle over the schemas the document uses. */
  moddle: Moddle;
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
  private readonly options: ImportOptions;

  private constructor(definitions: ModdleObject, options: ImportOptions) {
    this.options = options;
    this.read(definitions, 0);
  }

  /** A study of `text`, a `.studyflow.yaml` or BPMN XML file. */
  static async open(text: string, options: OpenOptions): Promise<Study> {
    return new Study(await parse(text, options.moddle, options.onWarning), options);
  }

  /** A study of `definitions`, which it edits in place from here on. */
  static fromDefinitions(definitions: ModdleObject, options: ImportOptions = {}): Study {
    return new Study(definitions, options);
  }

  /** Replace the document with `source`, file text or definitions, as one change: a 'load'. */
  async load(source: string | ModdleObject): Promise<void> {
    const definitions = typeof source === 'string' ? await parse(source, moddleOf(this.definitions), this.options.onWarning) : source;
    const before = studyInternals(this).scene;
    const after = this.read(definitions, before.revision + 1);
    this.announce({ cause: 'load', added: drawables(after), changed: [after.rootElement], removed: drawables(before) });
  }

  /** The document as a BPMN XML file holds it: the drawing written into its DI, and a pure choreography on its own root. */
  async toXml(): Promise<string> {
    const { scene } = studyInternals(this);
    writeDi(scene);
    const moddle = moddleOf(scene.definitions);
    const { xml } = await moddle.toXML(scene.definitions, { format: true });
    return toWireXml(xml, moddle);
  }

  /** The `bpmn:Definitions` the study edits. */
  get definitions(): ModdleObject {
    return studyInternals(this).scene.definitions;
  }

  /** Goes up by one on every change. */
  get revision(): number {
    return studyInternals(this).scene.revision;
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
    internals.set(this, { scene, mutator: new Mutator(scene, (commit) => this.announce({ cause: 'edit', ...commit })) });
    return scene;
  }

  private announce(change: StudyChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
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

function drawables(scene: Scene): Drawable[] {
  return [...scene.elementsById.values()].filter((element): element is Drawable => element.kind !== 'label');
}
