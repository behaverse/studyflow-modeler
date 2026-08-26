/**
 * EditorPort — the editor-agnostic facade app-side code talks to.
 *
 * App-side consumers (React components, hooks, command handlers, simulation UI,
 * export, provenance, import) reach the diagram editor only through this
 * interface. Editor-internal modules (`bpmn/`, `draw/`, `contextPad/`,
 * `palette/module`, `templates/`) keep using bpmn-js directly and belong to the
 * bpmn backend alone.
 *
 * Names describe intent, not bpmn-js service names. There are two implementations:
 *
 * - `createBpmnEditorPort` (`@modeler/editor/bpmnAdapter`) over a bpmn-js modeler;
 * - `createCanvasEditorPort` (`@behaverse/studyflow-canvas`) over the native canvas,
 *   assembled with its app-supplied halves in `@modeler/editor/canvasBackend`.
 *
 * Members marked *app-backed* below are not the editor's to answer: the history
 * quartet, `importXML`/`saveXML` and `model` are served by the app on both
 * backends (`editor/history.ts`, bpmn-moddle), so the two backends agree on them
 * by construction. `@modeler/editor/registry` picks the implementation; nothing
 * app-side may branch on which one it got.
 */

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
 * Event topics cross the seam under their existing (bpmn-js) names to keep the
 * adapter thin. Subscribed app-side: `diagram.init`, `diagram.destroy`,
 * `element.dblclick`, `root.set`, `selection.changed`, `element.changed`,
 * `elements.changed`, `commandStack.changed`, `import.done`,
 * `tokenSimulation.toggle`. Fired app-side: `tokenSimulation.toggle`,
 * `elementTemplates.changed`.
 *
 * `commandStack.changed` means "one mutation was applied" — not "one command stack
 * step". On the bpmn backend the command stack fires it; on the canvas backend the
 * app history layer (`editor/history.ts`) does, once per recorded mutation.
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

/** Viewport, layers and per-element view state (bpmn-js: `canvas`). */
export interface EditorView {
  /** Current zoom scale. */
  zoom(): number;
  zoomToFit(): void;
  viewbox(): Viewbox;
  setViewbox(box: Rect): void;
  /** Bounding box of `element` in screen (container) coordinates. */
  getAbsoluteBBox(element: EditorElement): Rect;
  /** The DOM element hosting the diagram (queried for its `svg`, class toggles, rects). */
  getContainer(): HTMLElement;
  /**
   * A custom SVG layer, created on first use. `index` is a z-order *hint*: the
   * bpmn backend orders layers by it, the canvas backend only records it.
   */
  getLayer(name: string, index?: number): SVGElement;
  /**
   * Show or hide the background grid ("Show grid" in settings). Optional: the bpmn
   * backend already re-asserts the setting itself from a diagram-js behavior
   * (`bpmn/behaviors.ts` `GridVisibility` over `diagram-js-grid`), so only a backend
   * that owns no such module publishes this. Call it as `setGridVisible?.(…)`.
   */
  setGridVisible?(visible: boolean): void;
  addMarker(elementOrId: EditorElement | string, marker: string): void;
  removeMarker(elementOrId: EditorElement | string, marker: string): void;
  /**
   * May throw for elements outside the current root; callers guard. `padding` is a
   * hint: the bpmn backend honours it, the canvas backend centres the element.
   */
  scrollToElement(
    element: EditorElement,
    padding?: number | { top: number; right: number; bottom: number; left: number },
  ): void;
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
  /** `undefined` when the backend's rules reject the drop. */
  createShape(
    shape: EditorElement,
    position: Rect | { x: number; y: number },
    parent: EditorElement,
    hints?: Record<string, unknown>,
  ): EditorElement | undefined;
  /**
   * `undefined` when the backend's rules reject the connection. `connection` and
   * `parent` are hints: the canvas derives the flow type from its own rules.
   */
  createConnection(
    source: EditorElement,
    target: EditorElement,
    connection: EditorElement,
    parent: EditorElement,
    hints?: Record<string, unknown>,
  ): EditorElement | undefined;
}

export interface EditorSelection {
  get(): EditorElement[];
  select(elements: EditorElement | EditorElement[] | null, add?: boolean): void;
}

export interface EditorEvents {
  on(topic: string, listener: EditorEventListener): void;
  on(topic: string, priority: number, listener: EditorEventListener): void;
  off(topic: string, listener: EditorEventListener): void;
  fire(topic: string, payload?: Record<string, unknown>): void;
}

export interface EditorRules {
  /** Evaluates an editor rule (e.g. `shape.append`) against `context`. */
  allowed(action: string, context?: Record<string, unknown>): boolean;
}

/** Interactive gestures started from app chrome (palette, menus). */
export interface EditorGestures {
  /** A detached shape suitable for `startCreate` (bpmn-js: `elementFactory.createShape`). */
  createShape(attrs: { type: string; businessObject?: ModelElement } & Record<string, unknown>): EditorElement;
  /** Begins a create drag from `event` (bpmn-js: `create.start`). */
  startCreate(
    event: MouseEvent | any,
    elements: EditorElement | EditorElement[],
    context?: { hints?: Record<string, unknown>; source?: EditorElement },
  ): void;
  /** Begins lasso selection from `event`. */
  startLasso(event: MouseEvent | any): void;
  /**
   * Primes hover on the root so a create drag previews before the first mouse move.
   * A diagram-js `dragging` workaround with no counterpart elsewhere — optional, and
   * absent on backends that need no priming. Call it as `primeHover?.(event)`.
   */
  primeHover?(event: MouseEvent | any): void;
  /**
   * Click-append: place `shape` beside `source` and connect the two, as one undo
   * step. Optional — the bpmn backend gets the gesture from
   * `bpmn-js-create-append-anything` (`autoPlace.append`) inside its own popup and
   * publishes nothing here, so app chrome calls `appendShape?.(…)` and falls back to
   * `mutate.createShape` + `mutate.createConnection`.
   *
   * `undefined` when the backend's rules reject the shape.
   */
  appendShape?(source: EditorElement, shape: EditorElement): EditorElement | undefined;
}

/**
 * Popup menus opened from app chrome, anchored on the current root.
 *
 * `providerId` names a menu, not a diagram-js provider: the bpmn backend resolves
 * it through `popupMenu`'s provider registry, and any other backend must fulfil the
 * same ids from app chrome, using `view.getAbsoluteBBox` for the anchor geometry.
 */
export interface EditorPopup {
  open(
    providerId: string,
    position: { x: number; y: number; cursor: { x: number; y: number } },
    options?: { title?: string; width?: number; search?: boolean },
  ): void;
}

/** Schema-aware document model access (bpmn-moddle). */
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
  /** Detached shape(s) for a template, ready for `gestures.startCreate`. */
  createElement(template: any): EditorElement | EditorElement[];
}

/** Token simulation control (custom `tokenSimulator` service). */
export interface EditorSimulation {
  toggle(): void;
  isActive(): boolean;
}

export interface EditorPort {
  /**
   * App-backed. Monotonic revision of the document's edit history: bumps on every
   * applied, undone or redone mutation (not on import, which resets the history
   * silently). The app's answer to "has the document changed since I last looked?",
   * served by `editor/history.ts` on both backends.
   */
  revision(): number;
  /** App-backed: the bpmn command stack, or the app's snapshot history. */
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  /** App-backed: parsed with bpmn-moddle, then handed to the backend. */
  importXML(xml: string): Promise<{ warnings: unknown[] }>;
  saveXML(options?: { format?: boolean }): Promise<{ xml: string }>;
  saveSVG(): Promise<{ svg: string }>;
  /** The document's `bpmn:Definitions` root, or `undefined` before the first import. */
  getDefinitions(): ModelElement | undefined;

  elements: EditorElements;
  view: EditorView;
  mutate: EditorMutations;
  selection: EditorSelection;
  events: EditorEvents;
  rules: EditorRules;
  gestures: EditorGestures;
  popup: EditorPopup;
  model: EditorModel;
  templates: EditorTemplates;
  simulation: EditorSimulation;
}

/**
 * `is` from `bpmn-js/lib/util/ModelUtil`, reimplemented verbatim so app-side
 * files need no direct bpmn-js import.
 */
export function is(element: EditorElement | ModelElement, type: string): boolean {
  const bo = getBusinessObject(element);
  return !!bo && typeof bo.$instanceOf === 'function' && bo.$instanceOf(type);
}

/** `getBusinessObject` from `bpmn-js/lib/util/ModelUtil`, reimplemented verbatim. */
export function getBusinessObject(element: EditorElement): ModelElement {
  return (element && element.businessObject) || element;
}
