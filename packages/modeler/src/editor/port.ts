/**
 * EditorPort — the editor-agnostic facade app-side code talks to.
 *
 * App-side consumers (React components, hooks, command handlers, simulation UI,
 * export, provenance, import) reach the diagram editor only through this
 * interface, and through nothing else — which is what let bpmn-js be replaced
 * underneath them without any of them noticing.
 *
 * Names describe intent, not any editor's service names. One implementation
 * ships: `createCanvasEditorPort` (`@behaverse/studyflow-canvas`) over the native
 * canvas, assembled with its app-supplied halves in `@modeler/editor/canvasBackend`.
 * Several members still carry a bpmn-js name in parentheses below — that is the
 * vocabulary the app grew up on, and the fastest way to read what a member means.
 *
 * Members marked *app-backed* are not the editor's to answer at all: the history
 * quartet, `importXML`/`saveXML` and `model` are served by the app
 * (`editor/history.ts`, bpmn-moddle), so they outlive the editor under them.
 * `@modeler/editor/registry` hands out the implementation.
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
  /** A custom SVG layer, created on first use. Layers are ordered by `index`. */
  getLayer(name: string, index?: number): SVGElement;
  /**
   * The trail of plane roots from the document root to the one on screen — what the
   * sub-process breadcrumb renders (`drilldown/Breadcrumbs.tsx`). A single entry
   * means "at the root", and the breadcrumb stays down.
   */
  planePath(): EditorElement[];
  /**
   * Show the plane `root` stands for (a member of `planePath()`). View-only: it
   * writes nothing and records no undo step. Returns whether the view moved.
   */
  goToPlane(root: EditorElement): boolean;
  /** Show or hide the background grid ("Show grid" in settings). */
  setGridVisible(visible: boolean): void;
  /**
   * Turn grid SNAPPING on or off ("Snap to grid" in settings) — the other half of
   * the grid, and a separate preference: the dots are a backdrop, the snap decides
   * where a drag may land (parity spec addendum 7, which asks for it on by default
   * "and keep a setting to disable").
   */
  setSnapToGrid(on: boolean): void;
  addMarker(elementOrId: EditorElement | string, marker: string): void;
  removeMarker(elementOrId: EditorElement | string, marker: string): void;
  /** Centre the view on `element`. May throw for elements outside the current root; callers guard. */
  scrollToElement(element: EditorElement): void;
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

export interface EditorSelection {
  get(): EditorElement[];
  select(elements: EditorElement | EditorElement[] | null, add?: boolean): void;
}

export interface EditorEvents {
  on(topic: string, listener: EditorEventListener): void;
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
   * Click-append: place `shape` beside `source` and connect the two, as one undo
   * step (`@canvas/interaction/autoplace.ts`).
   *
   * `undefined` when the editor's rules reject the shape.
   */
  appendShape(source: EditorElement, shape: EditorElement): EditorElement | undefined;
  /**
   * Begin dragging a new connection out of `source` — the context pad's connect
   * entry (parity spec addendum 4). Returns whether the gesture started.
   */
  startConnect(source: EditorElement, event?: MouseEvent | any): boolean;
  /**
   * Draw a transient GHOST of what `appendShape` would create, where it would create
   * it — the context pad's hover preview (parity spec addendum 5). Writes nothing;
   * `clearPreview` takes it down. Returns whether a ghost went up.
   */
  previewAppend(source: EditorElement, shape: EditorElement): boolean;
  /** Remove any transient gesture preview (`previewAppend`). */
  clearPreview(): void;
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
   * served by `editor/history.ts`.
   */
  revision(): number;
  /** App-backed: the app's snapshot history (`editor/history.ts`). */
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  /** App-backed: parsed with bpmn-moddle, then handed to the editor. */
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
