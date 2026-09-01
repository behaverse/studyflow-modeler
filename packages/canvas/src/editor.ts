/**
 * `Editor` — the editor-agnostic facade app-side code talks to, declared ONCE.
 *
 * App-side consumers (React components, hooks, command handlers, simulation UI,
 * export, provenance, import) reach the diagram editor only through this
 * interface, and through nothing else. Names describe intent, not any editor's
 * service names; several still carry a bpmn-js name in parentheses below, because
 * that is the vocabulary the app grew up on and the fastest way to read what a
 * member means.
 *
 * It lives beside {@link Canvas} rather than in the app because the dependency is
 * one-directional: the canvas is a leaf and must not import `@modeler/*`, while
 * `@modeler/*` already imports `@canvas/*` freely. `@modeler/editor/port`
 * re-exports every name here, so app-side imports are unchanged — and there is no
 * second copy to drift from.
 *
 * Most members are the canvas's own services under the facade's names: `selection`
 * IS the {@link Selection}, `events` IS the {@link EventBus}, `canvas` IS the
 * {@link Canvas}. Only four carry meaning the canvas does not have on its own —
 * `mutate` (the undo-step bracket), the history quintet, `importXML`/`saveXML` (a
 * moddle round trip) and the three app services (`model`, `templates`,
 * `simulation`) — and those are assembled by {@link createEditor} below.
 *
 * There is deliberately no `view` member. Viewport, layers and per-element view
 * state are the canvas's own (`zoomToFit`, `getViewbox`, `getViewport().setViewbox`,
 * `getHostLayer`, `planePath`, `goToPlane`, `addMarker`, `scrollToElement`, …), and
 * app chrome calls them on {@link Editor.canvas}: a second set of names for them
 * bought nothing but a projection to keep in step.
 *
 * The canvas has no command stack. Each `mutate.*` call is one logical undo step,
 * closed with {@link EditorHistory.record} — the app's commit point, from which
 * autosave, provenance and dirty-tracking take their `CommandStackChanged`.
 */

// Concrete modules, not the barrel: `index.ts` re-exports from this file, so
// importing it back here would be a cycle.
import type { Canvas } from './Canvas.ts';
import { createMutations } from './model/mutations.ts';
import type { EventBus } from '@core/events/bus.ts';
import type { Selection } from './interaction/selection.ts';

export type { Canvas, EventBus, Selection };

/**
 * A diagram element (shape, connection, root or label) as handed out by the editor.
 *
 * Structural fields app-side code relies on: `id`, `type` (incl. the `'label'`
 * sentinel), `businessObject`, `di`, `x`, `y`, `width`, `height`, `waypoints`,
 * `source`, `target`, `parent`, `label`, `outgoing`.
 */
export type EditorElement = any;

/** A moddle object (business object, DI, or extension element). */
export type ModelElement = any;

/** The schema-aware bpmn-moddle instance; the document model outlives the editor. */
export type Moddle = import('bpmn-moddle').BpmnModdle;

export type Rect = { x: number; y: number; width: number; height: number };

export type Viewbox = Rect & {
  scale: number;
  inner: Rect;
  outer: { width: number; height: number };
};

/**
 * Event topics cross the seam under their existing (bpmn-js) names, which is what
 * lets `events` be the canvas's own bus. Subscribed app-side: `diagram.init`, `diagram.destroy`,
 * `ElementDblClick`, `RootSet`, `SelectionChanged`, `ElementChanged`,
 * `ElementsChanged`, `CommandStackChanged`, `ImportDone`,
 * `TokenSimulationToggle`. Fired app-side: `TokenSimulationToggle`,
 * `ElementTemplatesChanged`.
 *
 * `CommandStackChanged` means "one mutation was applied" — not "one command stack
 * step". The editor has no command stack; the app history layer
 * (`editor/history.ts`) fires it, once per recorded mutation.
 */
export type EditorEventListener = (event: any) => any;

/** Element lookup (bpmn-js: `elementRegistry` + canvas root resolution). */
export interface EditorElements {
  get(id: string): EditorElement | undefined;
  /** Iteration follows the editor's registration order (export code relies on it). */
  forEach(fn: (element: EditorElement) => void): void;
  filter(fn: (element: EditorElement) => boolean): EditorElement[];
  /** The current root (process, collaboration or choreography plane). */
  root(): EditorElement;
  /** The root/plane containing `element`, or `undefined` when it has none. */
  findRoot(element: EditorElement): EditorElement | undefined;
  /** The SVG graphics group rendered for `element`. */
  getGraphics(element: EditorElement): SVGElement;
}

/** Undoable document mutations (bpmn-js: `modeling`; each call is one undo step). */
export interface EditorMutations {
  setColor(
    elements: EditorElement | EditorElement[],
    colors: { fill?: string | null; stroke?: string | null },
  ): void;
  updateProperties(element: EditorElement, properties: Record<string, unknown>): void;
  /**
   * Routes a write to `target` through the right undoable command: the element's
   * own business object goes through `updateProperties`, any other reachable
   * model object through `updateModdleProperties`. This makes `mutate` itself an
   * `AttributeUpdater` for `@core/element`'s `setAttribute`/`setExpressionLanguage`.
   */
  update(element: EditorElement, target: ModelElement, properties: Record<string, unknown>): void;
  /** Updates `moddleElement`, a model object reachable from `element` (nested BO, DI, extension). */
  updateModdleProperties(
    element: EditorElement,
    moddleElement: ModelElement,
    properties: Record<string, unknown>,
  ): void;
  resizeShape(shape: EditorElement, bounds: Rect): void;
  /**
   * Click-append: place `shape` beside `source` and connect the two, as ONE undo
   * step (`@canvas/interaction/autoplace.ts`). A mutation rather than a gesture —
   * the shape and the flow land inside a single `step()` bracket, which is the whole
   * reason the pair is undone together.
   *
   * `undefined` when the editor's rules reject the shape.
   */
  appendShape(source: EditorElement, shape: EditorElement): EditorElement | undefined;
  /** `undefined` when the editor's rules reject the drop. */
  createShape(
    shape: EditorElement,
    position: Rect | { x: number; y: number },
    parent: EditorElement,
    hints?: Record<string, unknown>,
  ): EditorElement | undefined;
  /**
   * `undefined` when the editor's rules reject the connection. `connection` and
   * `parent` are hints: the canvas derives the flow type from its own rules.
   */
  createConnection(
    source: EditorElement,
    target: EditorElement,
    connection: EditorElement,
    parent: EditorElement,
    hints?: Record<string, unknown>,
  ): EditorElement | undefined;
  /**
   * Retype `element` to `attrs.type` in place, as one undo step — the context pad's
   * wrench, "Change element" (ux-spec §4 entry 4). The name comes across; the
   * incident flows are rewired onto the replacement; the old element goes.
   *
   * `undefined` when the editor's rules refuse the swap, or when the element
   * already IS that type — callers treat a falsy answer as "nothing happened".
   */
  replaceShape(
    element: EditorElement,
    attrs: { type: string } & Record<string, unknown>,
  ): EditorElement | undefined;
  /**
   * Delete `elements` and their closure (a container's contents, a node's incident
   * edges) as one undo step — the context pad's trash, and any other app-side
   * delete. The keyboard route belongs to the editor and reaches the same closure.
   *
   * Returns everything actually removed.
   */
  removeElements(elements: EditorElement | EditorElement[]): EditorElement[];
}

/**
 * The editor's rule verdicts, as a `boolean`.
 *
 * The only thing the facade adds over {@link Canvas.getRules}: `Rules.allowed`
 * answers a truthy `ConnectionSpec` ("allowed, and here is the flow type") where app
 * chrome asks a yes/no question (`rules/rules.ts` documents the mirroring).
 */
export interface EditorRules {
  /** Evaluates an editor rule (e.g. `shape.append`) against `context`. */
  allowed(action: string, context?: Record<string, unknown>): boolean;
}

/** Schema-aware document model access (bpmn-moddle) — injected by the app. */
export interface EditorModel {
  /** The moddle instance itself — passed opaquely into `@core/document` XML passes. */
  moddle(): Moddle;
  /** A plain moddle object (no id bookkeeping) — extension and BPMN types alike. */
  create(type: string, properties?: Record<string, unknown>): ModelElement;
  /** An id-assigning business object (bpmn-js: `bpmnFactory.create`). */
  createBusinessObject(type: string, properties?: Record<string, unknown>): ModelElement;
  fromXML(xml: string): Promise<{ rootElement: ModelElement }>;
  toXML(definitions: ModelElement, options?: { format?: boolean }): Promise<{ xml: string }>;
  ids: {
    nextPrefixed(prefix: string, element?: ModelElement): string;
    /** Truthy when `id` is already claimed in the document. */
    assigned(id: string): unknown;
  };
}

/** Element templates offered by the palette (custom `elementTemplates` service). */
export interface EditorTemplates {
  getAll(): any[];
  /** Detached shape(s) for a template, ready for {@link Canvas.startCreate}. */
  createElement(template: any): EditorElement | EditorElement[];
}

/** Token simulation control (custom `tokenSimulator` service). */
export interface EditorSimulation {
  toggle(): void;
  isActive(): boolean;
}

/**
 * The history quintet, as the app READS it off the editor (`provenance/trail.ts`,
 * `provenance/Provenance.tsx`, `app/commands.ts`, `settings/attachAutosave.ts`).
 * Declared apart from {@link Editor} only so the injected {@link EditorHistory}
 * and the facade that forwards to it cannot drift.
 */
export interface EditorHistoryView {
  /**
   * Monotonic revision of the document's edit history: bumps on every applied,
   * undone or redone mutation (not on import, which resets the history silently).
   * The app's answer to "has the document changed since I last looked?".
   */
  revision(): number;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

/**
 * The app-level history the canvas borrows in place of a command stack (design §4
 * (1)) — `editor/history.ts`'s snapshot store. Required: the canvas has no undo of
 * its own, so an editor without one is not an editor.
 */
export interface EditorHistory extends EditorHistoryView {
  /** Commit point: called immediately AFTER a mutation applied. */
  record(): void;
  /** A fresh document was imported: forget the past, re-baseline silently. */
  reset(): void;
}

/** The editor the app holds (`ModelerContext`), built in `editor/mount.ts`. */
export interface Editor extends EditorHistoryView {
  /** App-backed: parsed with bpmn-moddle, then handed to the editor. */
  importXML(xml: string): Promise<{ warnings: unknown[] }>;
  saveXML(options?: { format?: boolean }): Promise<{ xml: string }>;
  /** The document's `bpmn:Definitions` root, or `undefined` before the first import. */
  getDefinitions(): ModelElement | undefined;

  elements: EditorElements;
  mutate: EditorMutations;
  rules: EditorRules;
  /** The canvas's own selection set + overlay, under the facade's name. */
  selection: Selection;
  /** The canvas's own event bus, under the facade's name. */
  events: EventBus;
  /**
   * The canvas itself — and the home of everything the facade does not rename.
   *
   * Every INTERACTIVE gesture app chrome starts: `createShape`, `startCreate`,
   * `activateLasso`, `startConnect`, `previewAppend`/`clearAppendPreview`, `toSVG`.
   * None of those writes the document (an append does, and lives on
   * {@link EditorMutations} for exactly that reason), so none needs a facade name.
   *
   * And every VIEW member: `zoomToFit`, `getViewbox`, `getViewport()`,
   * `getAbsoluteBBox`, `getContainer`, `getHostLayer`, `planePath`, `goToPlane`,
   * `setGridVisible`, `setSnapToGrid`, `addMarker`/`removeMarker`,
   * `scrollToElement`.
   */
  canvas: Canvas;
  /** Injected, then republished: the document model outlives the editor. */
  model: EditorModel;

  templates: EditorTemplates;
  simulation: EditorSimulation;

  /**
   * Tear the editor down: unbind every listener it put on the container and the
   * document, dispose the app-side halves and detach the diagram. Called when the
   * host unmounts (`app/Modeler.tsx`); the instance is dead afterwards.
   */
  destroy(): void;
}

/**
 * `createEditor` — the {@link Editor} the app holds, assembled over a live canvas.
 *
 * There is almost nothing here, and that is the point. Most of the facade IS the
 * canvas under another name (`selection`, `events`, `canvas`), so this only
 * carries the members the canvas genuinely does not have:
 *
 * - **the history quintet** — the canvas has no command stack; undo is the app's
 *   snapshot store (`editor/history.ts`), and the facade republishes it;
 * - **`importXML` / `saveXML`** — a bpmn-moddle round trip, then the canvas import
 *   and the `ImportDone` + `RootSet` pair app chrome re-reads itself on;
 * - **`rules`** — a `!!` over the canvas's verdict, which is a `ConnectionSpec`;
 * - **`mutate`** — built beside it (`model/mutations.ts`), which is where the
 *   undo-step bracket's internals live.
 *
 * Nothing forwards. The view members app chrome used to reach through `Editor.view`
 * are the canvas's own and are called on `Editor.canvas` directly.
 *
 * `@modeler/editor/mount.ts` builds the canvas and the app services this takes, and
 * fastens `templates`, `simulation` and `destroy` onto the result.
 */

/** The facade minus the three members the app fastens on last (`@modeler/editor/mount.ts`). */
export type EditorCore = Omit<Editor, 'templates' | 'simulation' | 'destroy'>;

/** What the facade cannot get from the canvas alone — both outlive the editor. */
export interface EditorDeps {
  /** The bpmn-moddle bridge; the document model outlives the editor. */
  model: EditorModel;
  /**
   * App-level undo/redo (`editor/history.ts`). It also owns the
   * `CommandStackChanged` topic, firing once per recorded mutation.
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
    bus.fire('ImportDone', { error: null, warnings });
    bus.fire('RootSet', { element: canvas.getRoot() });
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
