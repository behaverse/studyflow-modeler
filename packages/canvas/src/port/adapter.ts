/**
 * `createCanvasEditorPort` — the canvas-backed implementation of the app's editor
 * facade (design §3 `port/adapter.ts`, §4 EDITORPORT MAPPING).
 *
 * The facade itself lives in the app (`packages/modeler/src/editor/port.ts`), but
 * this package must not import from `packages/modeler` (hard rule: the canvas is a
 * leaf). So the port shape is re-declared here, member for member, and the app
 * assigns the result to its own `EditorPort` **structurally** — one interface, two
 * adapters, checked at the assignment site.
 *
 * Split of responsibilities (design §4):
 *
 * - **(C) canvas implements** — `elements`, `view`, `mutate`, `selection`, `events`,
 *   `rules`, `gestures`, `saveSVG`, `getDefinitions`.
 * - **(A) app supplies** — the history quartet (`revision`/`undo`/`redo`/`canUndo`/
 *   `canRedo`), `importXML`/`saveXML`, `model` (bpmn-moddle), `popup`, `templates`,
 *   `simulation`. Every one of those arrives through {@link CanvasPortDeps} and the
 *   adapter forwards; sensible defaults exist for the ones that can be expressed
 *   over `deps.model` + the canvas alone (import/save XML), so a test can drive the
 *   port with nothing but a moddle instance.
 *
 * The canvas has no command stack. Each `mutate.*` call is one logical undo step:
 * the adapter brackets it with `history.beginMutation`/`endMutation` (the app's
 * snapshot points) and then fires `commandStack.changed` on the canvas bus, so
 * autosave / provenance / dirty-tracking keep working unchanged on both backends.
 */

import { Canvas } from '@canvas/Canvas.ts';
import { EventBus } from '@canvas/events/bus.ts';
import { createShape as makePrototype } from '@canvas/interaction/create.ts';
import type { CreatePrototype, ShapeDescriptor } from '@canvas/interaction/create.ts';
import { prop, setProp } from '@canvas/model/moddle.ts';
import type {
  Bounds,
  ModdleObject,
  Plane,
  Point,
  Scene,
  SceneElement,
  SceneLabel,
  SceneNode,
} from '@canvas/model/scene.ts';
import { definitionsOf } from '@canvas/model/writeback.ts';
import { append, create as svgCreate } from '@canvas/render/svg.ts';
import { sceneBounds } from '@canvas/view/viewport.ts';

// --- the port shape, re-declared (never imported) -----------------------------

/** A diagram element as handed across the facade (`EditorElement` in the app). */
export type PortElement = any;

/** A moddle object (business object, DI, or extension) — `ModelElement` in the app. */
export type PortModelElement = any;

/** The schema-aware `bpmn-moddle` instance; the document outlives the editor. */
export type PortModdle = import('bpmn-moddle').BpmnModdle;

/** An axis-aligned rectangle. */
export type PortRect = { x: number; y: number; width: number; height: number };

/** The facade's viewbox: the visible rect, its scale, plus diagram/container extents. */
export type PortViewbox = PortRect & {
  scale: number;
  inner: PortRect;
  outer: { width: number; height: number };
};

/** A bus listener; the payload is topic-specific. */
export type PortEventListener = (event: any) => any;

/** Element lookup (`EditorElements`). */
export interface PortElements {
  get(id: string): PortElement | undefined;
  forEach(fn: (element: PortElement) => void): void;
  filter(fn: (element: PortElement) => boolean): PortElement[];
  root(): PortElement;
  findRoot(element: PortElement): PortElement | undefined;
  getGraphics(element: PortElement): SVGElement;
}

/** Viewport, layers and per-element view state (`EditorView`). */
export interface PortView {
  zoom(): number;
  zoomToFit(): void;
  viewbox(): PortViewbox;
  setViewbox(box: PortRect): void;
  getAbsoluteBBox(element: PortElement): PortRect;
  getContainer(): HTMLElement;
  getLayer(name: string, index?: number): SVGElement;
  addMarker(elementOrId: PortElement | string, marker: string): void;
  removeMarker(elementOrId: PortElement | string, marker: string): void;
  scrollToElement(
    element: PortElement,
    padding?: number | { top: number; right: number; bottom: number; left: number },
  ): void;
}

/** Undoable document mutations (`EditorMutations`); each call is one undo step. */
export interface PortMutations {
  setColor(
    elements: PortElement | PortElement[],
    colors: { fill?: string | null; stroke?: string | null },
  ): void;
  updateProperties(element: PortElement, properties: Record<string, unknown>): void;
  update(element: PortElement, target: PortModelElement, properties: Record<string, unknown>): void;
  updateModdleProperties(
    element: PortElement,
    moddleElement: PortModelElement,
    properties: Record<string, unknown>,
  ): void;
  resizeShape(shape: PortElement, bounds: PortRect): void;
  createShape(
    shape: PortElement,
    position: PortRect | { x: number; y: number },
    parent: PortElement,
    hints?: Record<string, unknown>,
  ): PortElement;
  createConnection(
    source: PortElement,
    target: PortElement,
    connection: PortElement,
    parent: PortElement,
    hints?: Record<string, unknown>,
  ): PortElement;
}

/** Selection set (`EditorSelection`). */
export interface PortSelection {
  get(): PortElement[];
  select(elements: PortElement | PortElement[] | null, add?: boolean): void;
}

/** Event bus projection (`EditorEvents`). */
export interface PortEvents {
  on(topic: string, listener: PortEventListener): void;
  on(topic: string, priority: number, listener: PortEventListener): void;
  off(topic: string, listener: PortEventListener): void;
  fire(topic: string, payload?: Record<string, unknown>): void;
}

/** Rule evaluation (`EditorRules`). */
export interface PortRules {
  allowed(action: string, context?: Record<string, unknown>): boolean;
}

/** Interactive gestures started from app chrome (`EditorGestures`). */
export interface PortGestures {
  createShape(attrs: { type: string; businessObject?: PortModelElement } & Record<string, unknown>): PortElement;
  startCreate(
    event: MouseEvent | any,
    elements: PortElement | PortElement[],
    context?: { hints?: Record<string, unknown>; source?: PortElement },
  ): void;
  startLasso(event: MouseEvent | any): void;
  /** Retired on this backend (design §4 (3)) — a diagram-js `dragging` workaround. */
  primeHover(event: MouseEvent | any): void;
  /**
   * Canvas-only extension: begin a connect drag out of `source` (context pad /
   * append). The bpmn-js backend reaches the same gesture through its context pad.
   */
  startConnect(source: PortElement, event?: MouseEvent | any): boolean;
}

/** Popup menus opened from app chrome (`EditorPopup`) — app-fulfilled here. */
export interface PortPopup {
  open(
    providerId: string,
    position: { x: number; y: number; cursor: { x: number; y: number } },
    options?: { title?: string; width?: number; search?: boolean },
  ): void;
}

/** Schema-aware document model access (`EditorModel`) — always bpmn-moddle. */
export interface PortModel {
  moddle(): PortModdle;
  create(type: string, properties?: Record<string, unknown>): PortModelElement;
  createBusinessObject(type: string, properties?: Record<string, unknown>): PortModelElement;
  fromXML(xml: string): Promise<{ rootElement: PortModelElement }>;
  toXML(definitions: PortModelElement, options?: { format?: boolean }): Promise<{ xml: string }>;
  ids: {
    nextPrefixed(prefix: string, element?: PortModelElement): string;
    assigned(id: string): unknown;
  };
}

/** Element templates offered by the palette (`EditorTemplates`) — an app service. */
export interface PortTemplates {
  getAll(): any[];
  createElement(template: any): PortElement | PortElement[];
}

/** Token simulation control (`EditorSimulation`) — an app service. */
export interface PortSimulation {
  toggle(): void;
  isActive(): boolean;
}

/**
 * The full facade this adapter produces. Structurally identical to the app's
 * `EditorPort` (plus `gestures.startConnect`), so
 * `const port: EditorPort = createCanvasEditorPort(canvas, deps)` type-checks.
 */
export interface CanvasEditorPort {
  revision(): number;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  importXML(xml: string): Promise<{ warnings: unknown[] }>;
  saveXML(options?: { format?: boolean }): Promise<{ xml: string }>;
  saveSVG(): Promise<{ svg: string }>;
  getDefinitions(): PortModelElement | undefined;

  elements: PortElements;
  view: PortView;
  mutate: PortMutations;
  selection: PortSelection;
  events: PortEvents;
  rules: PortRules;
  gestures: PortGestures;
  popup: PortPopup;
  model: PortModel;
  templates: PortTemplates;
  simulation: PortSimulation;
}

// --- injected (A) dependencies ------------------------------------------------

/**
 * The app-level history the canvas backend borrows in place of a command stack
 * (design §4 (1)). `revision` is the app's monotonic edit counter; the adapter
 * brackets every `mutate.*` call with {@link CanvasPortHistory.beginMutation} and
 * {@link CanvasPortHistory.endMutation} so the app can snapshot the moddle document
 * either side of the write.
 */
export interface CanvasPortHistory {
  revision(): number;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Snapshot point: called immediately BEFORE a mutation applies. */
  beginMutation?(label: string): void;
  /** Commit point: called immediately AFTER a mutation applied. */
  endMutation?(label: string): void;
  /** Called after an import, which resets the history silently (no revision bump). */
  reset?(): void;
}

/** Everything the adapter cannot get from the canvas alone (design §4 "(A)"). */
export interface CanvasPortDeps {
  /** The bpmn-moddle bridge. Required — the document model outlives the editor. */
  model: PortModel;
  /** App-level undo/redo. Omitted: the port reports an empty, unusable history. */
  history?: CanvasPortHistory;
  /** App-owned popup menus (append menu, colour picker). Omitted: `open` is a no-op. */
  popup?: PortPopup;
  /** Palette element templates. Omitted: `getAll()` is empty. */
  templates?: PortTemplates;
  /** Token simulation. Omitted: inert. */
  simulation?: PortSimulation;
  /** Override the default `fromXML` → `importDefinitions` import. */
  importXML?: (xml: string) => Promise<{ warnings: unknown[] }>;
  /** Override the default `toXML(getDefinitions())` serialization. */
  saveXML?: (options?: { format?: boolean }) => Promise<{ xml: string }>;
  /**
   * Fire `commandStack.changed` on the canvas bus after each mutation. Default
   * `true` — the app's `attachAutosave` / provenance hooks subscribe to it. Turn it
   * off when the app history layer owns that topic itself.
   */
  emitCommandStackChanged?: boolean;
}

// --- root elements ------------------------------------------------------------

/**
 * The facade's "root element": app code reads `editor.elements.root()` for the
 * diagram name, for export scoping and as the inspector's fallback selection. A
 * `bpmndi:BPMNPlane` is exactly that in the scene model, but it is not a
 * {@link SceneElement}, so it is projected onto one shape here — `id`, `type`,
 * `businessObject`, `di`, `children` — and memoized per plane so identity
 * comparisons (`e.element === editor.elements.root()`) hold.
 */
export interface PortRoot {
  readonly id: string;
  readonly type: string;
  readonly isRoot: true;
  businessObject: ModdleObject;
  di: ModdleObject;
  children: SceneElement[];
  parent: undefined;
  plane: Plane;
}

const roots = new WeakMap<Plane, PortRoot>();

/** The memoized {@link PortRoot} projection of `plane`. */
function rootOf(plane: Plane): PortRoot {
  let root = roots.get(plane);
  if (!root) {
    root = {
      id: String(prop(plane.businessObject, 'id') ?? plane.id),
      type: plane.businessObject.$type,
      isRoot: true,
      businessObject: plane.businessObject,
      di: plane.di,
      children: plane.children,
      parent: undefined,
      plane,
    };
    roots.set(plane, root);
  }
  // The plane's child list is rebuilt on create/delete; keep the projection live.
  root.children = plane.children;
  return root;
}

/** Whether `value` is the plane projection rather than a real scene element. */
function isRoot(value: unknown): value is PortRoot {
  return !!value && (value as PortRoot).isRoot === true;
}

/** Whether `value` is a drawable scene element (node or edge), not a label. */
function isSceneElement(value: SceneElement | SceneLabel | undefined): value is SceneElement {
  return !!value && (value.kind === 'node' || value.kind === 'edge');
}

/** The bounding box of a scene element in diagram coordinates. */
function boundsOf(element: SceneElement): Bounds {
  if (element.kind === 'node') {
    return { x: element.x, y: element.y, width: element.width, height: element.height };
  }
  return sceneBounds([element]);
}

// --- the adapter --------------------------------------------------------------

/**
 * Build the editor facade over `canvas`. One adapter per canvas instance (the app
 * memoizes it the way `getEditorPort` does for bpmn-js), so the revision fallback
 * counter spans the canvas's whole life.
 */
export function createCanvasEditorPort(canvas: Canvas, deps: CanvasPortDeps): CanvasEditorPort {
  const bus: EventBus = canvas.getEventBus();
  const model = deps.model;
  const emitCommandStack = deps.emitCommandStackChanged ?? true;
  /** Fallback revision when no app history is injected (design §4: canvas counts scene mutations). */
  let localRevision = 0;
  /** Custom `<g>` layers the app asks for by name (`view.getLayer`). */
  const customLayers = new Map<string, SVGGElement>();

  const scene = (): Scene | undefined => canvas.getScene();

  const requireScene = (): Scene => {
    const s = scene();
    if (!s) throw new Error('@behaverse/studyflow-canvas: no diagram imported yet');
    return s;
  };

  /** Resolve a facade element (or id) to the scene element it stands for. */
  const resolve = (value: PortElement | string): SceneElement | undefined => {
    if (typeof value === 'string') {
      const found = scene()?.elementsById.get(value);
      return isSceneElement(found) ? found : undefined;
    }
    if (!value || isRoot(value)) return undefined;
    if (value.kind === 'node' || value.kind === 'edge') return value as SceneElement;
    const found = value.id ? scene()?.elementsById.get(value.id) : undefined;
    return isSceneElement(found) ? found : undefined;
  };

  /**
   * Run one logical undo step: snapshot point, the write, commit point, revision
   * bump, `commandStack.changed`. `apply` returns the elements to re-draw.
   */
  const step = <T>(label: string, apply: () => T, changed?: (result: T) => SceneElement[]): T => {
    deps.history?.beginMutation?.(label);
    const result = apply();
    const dirty = changed?.(result) ?? [];
    if (dirty.length > 0) canvas.redrawElements(dirty);
    deps.history?.endMutation?.(label);
    localRevision += 1;
    if (emitCommandStack) bus.fire('commandStack.changed', {});
    return result;
  };

  /** Write `properties` onto a moddle object; returns whether anything changed. */
  const writeProps = (target: ModdleObject, properties: Record<string, unknown>): boolean => {
    let touched = false;
    for (const [key, value] of Object.entries(properties)) {
      if (prop(target, key) === value) continue;
      setProp(target, key, value);
      touched = true;
    }
    return touched;
  };

  /** Fire the change events for a facade element that is not a scene element. */
  const fireChanged = (element: PortElement): void => {
    bus.fire('element.changed', { element });
    bus.fire('elements.changed', { elements: [element] });
  };

  const elements: PortElements = {
    get: (id) => {
      const s = scene();
      if (!s) return undefined;
      const root = rootOf(s.rootPlane);
      if (id === root.id) return root;
      return s.elementsById.get(id);
    },
    forEach: (fn) => {
      const s = scene();
      if (!s) return;
      // Root first, then import order — the order export code walks (`export/drawio.ts`).
      fn(rootOf(s.rootPlane));
      for (const element of s.elementsById.values()) {
        if (isSceneElement(element)) fn(element);
      }
    },
    filter: (fn) => {
      const out: PortElement[] = [];
      elements.forEach((element) => {
        if (fn(element)) out.push(element);
      });
      return out;
    },
    root: () => rootOf(requireScene().rootPlane),
    findRoot: (element) => {
      const s = scene();
      if (!s || !element) return undefined;
      if (isRoot(element)) return element;
      const target = resolve(element);
      if (!target) return undefined;
      // Climb to the topmost node, then find the plane that lists it.
      let top: SceneElement = target;
      while (top.parent) top = top.parent;
      for (const plane of s.planes) {
        if (plane.children.includes(top)) return rootOf(plane);
      }
      return rootOf(s.rootPlane);
    },
    getGraphics: (element) => {
      if (isRoot(element)) return canvas.getSvg();
      const id = typeof element === 'string' ? element : element?.id;
      const gfx = id ? canvas.getGraphics(id) : undefined;
      if (!gfx) throw new Error(`@behaverse/studyflow-canvas: no graphics for '${String(id)}'`);
      return gfx;
    },
  };

  const view: PortView = {
    zoom: () => canvas.getViewport().zoom(),
    zoomToFit: () => canvas.zoomToFit(),
    viewbox: () => {
      const box = canvas.getViewport().getViewbox();
      const s = scene();
      const drawable: SceneElement[] = [];
      if (s) {
        for (const element of s.elementsById.values()) {
          if (isSceneElement(element)) drawable.push(element);
        }
      }
      const container = canvas.getContainer();
      return {
        ...box,
        inner: drawable.length > 0 ? sceneBounds(drawable) : { x: 0, y: 0, width: 0, height: 0 },
        outer: {
          width: container.clientWidth || box.width,
          height: container.clientHeight || box.height,
        },
      };
    },
    setViewbox: (box) => canvas.getViewport().setViewbox(box),
    getAbsoluteBBox: (element) => {
      const target = resolve(element);
      const bounds = target
        ? boundsOf(target)
        : { x: 0, y: 0, width: 0, height: 0 };
      return canvas.getViewport().getAbsoluteBBox(bounds);
    },
    getContainer: () => canvas.getContainer(),
    getLayer: (name, index) => {
      let layer = customLayers.get(name);
      if (!layer) {
        layer = svgCreate('g', {
          class: `sf-layer sf-layer-${name}`,
          'data-layer': name,
          'data-layer-index': String(index ?? 0),
        }) as SVGGElement;
        customLayers.set(name, layer);
      }
      // Custom layers live inside `overlays` so an import (`Layers.clear`) drops them
      // the way diagram-js drops its own; re-attach if that already happened.
      if (!layer.parentNode) {
        const host = canvas.getSvg().querySelector('[data-layer="overlays"]') ?? canvas.getSvg();
        append(host as Element, layer);
      }
      return layer;
    },
    addMarker: (elementOrId, marker) => {
      const target = resolve(elementOrId);
      if (target) canvas.getSelection().addMarker(target, marker);
    },
    removeMarker: (elementOrId, marker) => {
      const target = resolve(elementOrId);
      if (target) canvas.getSelection().removeMarker(target, marker);
    },
    // `padding` is a diagram-js scroll hint; the canvas centres the element instead.
    scrollToElement: (element) => {
      const target = resolve(element);
      if (!target) throw new Error('@behaverse/studyflow-canvas: element is not on the current plane');
      canvas.getViewport().scrollToElement(target);
    },
  };

  const mutate: PortMutations = {
    setColor: (targets, colors) => {
      const list = (Array.isArray(targets) ? targets : [targets])
        .map(resolve)
        .filter((element): element is SceneElement => !!element);
      step('setColor', () => canvas.setColor(list, colors));
    },
    updateProperties: (element, properties) => {
      const target = resolve(element);
      const bo: ModdleObject = target?.businessObject ?? element?.businessObject ?? element;
      step(
        'updateProperties',
        () => writeProps(bo, properties),
        (touched) => (touched && target ? [target] : []),
      );
      if (!target) fireChanged(element);
      else canvas.getWriteback()?.touch(target);
    },
    update: (element, target, properties) => {
      const bo = (element?.businessObject ?? element) as ModdleObject;
      if (target === bo) mutate.updateProperties(element, properties);
      else mutate.updateModdleProperties(element, target, properties);
    },
    updateModdleProperties: (element, moddleElement, properties) => {
      const target = resolve(element);
      step(
        'updateModdleProperties',
        () => writeProps(moddleElement as ModdleObject, properties),
        (touched) => (touched && target ? [target] : []),
      );
      if (!target) fireChanged(element);
      else canvas.getWriteback()?.touch(target);
    },
    resizeShape: (shape, bounds) => {
      const target = resolve(shape);
      if (!target || target.kind !== 'node') return;
      step('resizeShape', () => canvas.getWriteback()?.setNodeBounds(target, bounds) ?? [], (changed) => changed);
    },
    createShape: (shape, position, _parent, _hints) => step(
      'createShape',
      () => canvas.createElement(shape as ShapeDescriptor | CreatePrototype, {
        x: position.x,
        y: position.y,
      } as Point),
    ),
    createConnection: (source, target, _connection, _parent, _hints) => step('createConnection', () => {
      const from = resolve(source);
      const to = resolve(target);
      if (!from || from.kind !== 'node' || !to || to.kind !== 'node') return undefined;
      return canvas.connectElements(from as SceneNode, to as SceneNode);
    }),
  };

  const selection: PortSelection = {
    get: () => canvas.getSelection().get(),
    select: (targets, add) => {
      if (targets === null || targets === undefined) {
        canvas.getSelection().select(null, add);
        return;
      }
      const list = (Array.isArray(targets) ? targets : [targets])
        .map(resolve)
        .filter((element): element is SceneElement => !!element);
      canvas.getSelection().select(list.length > 0 ? list : null, add);
    },
  };

  const events: PortEvents = {
    on: (topic: string, priorityOrListener: number | PortEventListener, listener?: PortEventListener) => {
      if (typeof priorityOrListener === 'number') {
        if (listener) bus.on(topic, priorityOrListener, listener);
      } else {
        bus.on(topic, priorityOrListener);
      }
    },
    off: (topic, listener) => bus.off(topic, listener),
    fire: (topic, payload) => bus.fire(topic, payload ?? {}),
  };

  const rules: PortRules = {
    allowed: (action, context) => !!canvas.getRules().allowed(action, context ?? {}),
  };

  const gestures: PortGestures = {
    createShape: (attrs) => makePrototype(attrs as ShapeDescriptor),
    startCreate: (event, list) => {
      const first = Array.isArray(list) ? list[0] : list;
      if (!first) return;
      canvas.startCreate(event ?? undefined, first as ShapeDescriptor | CreatePrototype);
    },
    // Dragging empty canvas PANS on this backend (parity spec §10), so the palette's
    // lasso button is the only way to lasso: it arms the tool, and the next drag
    // draws the marquee.
    startLasso: () => canvas.activateLasso(),
    // Design §4 (3): a diagram-js `dragging` workaround with no native counterpart.
    primeHover: () => undefined,
    startConnect: (source, event) => {
      const from = resolve(source);
      if (!from || from.kind !== 'node') return false;
      return canvas.startConnect(from as SceneNode, event);
    },
  };

  const defaultImportXML = async (xml: string): Promise<{ warnings: unknown[] }> => {
    const warnings: unknown[] = [];
    const { rootElement } = await model.fromXML(xml);
    canvas.importDefinitions(rootElement as ModdleObject);
    localRevision = 0;
    deps.history?.reset?.();
    bus.fire('import.done', { error: null, warnings });
    bus.fire('root.set', { element: elements.root() });
    return { warnings };
  };

  const defaultSaveXML = async (options?: { format?: boolean }): Promise<{ xml: string }> => {
    const definitions = port.getDefinitions();
    if (!definitions) throw new Error('@behaverse/studyflow-canvas: nothing to serialize');
    const { xml } = await model.toXML(definitions, options);
    return { xml };
  };

  const port: CanvasEditorPort = {
    revision: () => deps.history?.revision() ?? localRevision,
    undo: () => deps.history?.undo(),
    redo: () => deps.history?.redo(),
    canUndo: () => !!deps.history?.canUndo(),
    canRedo: () => !!deps.history?.canRedo(),

    importXML: (xml) => (deps.importXML ?? defaultImportXML)(xml),
    saveXML: (options) => (deps.saveXML ?? defaultSaveXML)(options),
    saveSVG: async () => ({ svg: canvas.toSVG() }),
    getDefinitions: () => {
      const s = scene();
      return s ? definitionsOf(s) : undefined;
    },

    elements,
    view,
    mutate,
    selection,
    events,
    rules,
    gestures,

    popup: deps.popup ?? { open: () => undefined },
    model,
    templates: deps.templates ?? { getAll: () => [], createElement: () => [] },
    simulation: deps.simulation ?? { toggle: () => undefined, isActive: () => false },
  };

  return port;
}
