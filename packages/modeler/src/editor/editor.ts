/**
 * `createEditor` — the {@link Editor} the app holds, assembled over a live canvas.
 *
 * There is almost nothing here, and that is the point. Most of the facade IS the
 * canvas under another name (`selection`, `events`, `canvas`), so this file only
 * carries the members the canvas genuinely does not have:
 *
 * - **the history quintet** — the canvas has no command stack; undo is the app's
 *   snapshot store (`editor/history.ts`), and the facade republishes it;
 * - **`importXML` / `saveXML`** — a bpmn-moddle round trip, then the canvas import
 *   and the `import.done` + `root.set` pair app chrome re-reads itself on;
 * - **`rules`** — a `!!` over the canvas's verdict, which is a `ConnectionSpec`;
 * - **`mutate`** — built in the canvas package (`@canvas/model/mutations.ts`), which
 *   is where the undo-step bracket's internals live.
 *
 * Nothing forwards. The view members app chrome used to reach through `Editor.view`
 * are the canvas's own and are called on `Editor.canvas` directly.
 *
 * `editor/mount.ts` builds the canvas and the app services this takes, and fastens
 * `templates`, `simulation` and `destroy` onto the result.
 */

import { createMutations } from '@canvas/index.ts';
import type { Canvas } from '@canvas/index.ts';
import type {
  Editor,
  EditorHistory,
  EditorModel,
  ModelElement,
} from '@modeler/editor/port';

/** The facade minus the three members the app fastens on last (`editor/mount.ts`). */
export type EditorCore = Omit<Editor, 'templates' | 'simulation' | 'destroy'>;

/** What the facade cannot get from the canvas alone — both outlive the editor. */
export interface EditorDeps {
  /** The bpmn-moddle bridge; the document model outlives the editor. */
  model: EditorModel;
  /**
   * App-level undo/redo (`editor/history.ts`). It also owns the
   * `commandStack.changed` topic, firing once per recorded mutation.
   */
  history: EditorHistory;
}

/** Assemble the editor facade over `canvas`. One per canvas instance. */
export function createEditor(canvas: Canvas, deps: EditorDeps): EditorCore {
  const { model, history } = deps;
  const bus = canvas.getEventBus();

  const importXML = async (xml: string): Promise<{ warnings: unknown[] }> => {
    const warnings: unknown[] = [];
    const { rootElement } = await model.fromXML(xml);
    canvas.importDefinitions(rootElement as ModelElement);
    history.reset();
    bus.fire('import.done', { error: null, warnings });
    bus.fire('root.set', { element: canvas.getRoot() });
    return { warnings };
  };

  const saveXML = async (options?: { format?: boolean }): Promise<{ xml: string }> => {
    const definitions = canvas.getDefinitions();
    if (!definitions) throw new Error('@behaverse/studyflow-modeler: nothing to serialize');
    const { xml } = await model.toXML(definitions, options);
    return { xml };
  };

  return {
    revision: () => history.revision(),
    undo: () => history.undo(),
    redo: () => history.redo(),
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),

    importXML,
    saveXML,
    getDefinitions: () => canvas.getDefinitions(),

    elements: canvas.getElements(),
    mutate: createMutations(canvas, history),
    // `Rules.allowed` answers a truthy `ConnectionSpec`; app chrome asks yes/no.
    rules: { allowed: (action, context) => !!canvas.getRules().allowed(action, context ?? {}) },
    selection: canvas.getSelection(),
    events: bus,
    canvas,

    model,
  };
}
