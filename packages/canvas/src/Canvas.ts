/**
 * `Canvas` — the top-level facade (design §3 `Canvas.ts`). Owns the scene, the SVG
 * root + layer stack, the viewport, the renderer, and the interaction modules:
 * {@link Canvas.importDefinitions} builds a {@link Scene} from a `bpmn:Definitions`
 * moddle tree (with DI) and renders it (P1), then selection/hit-testing (P2),
 * drag/resize/label editing with DI writeback (P3), and the rules-gated create and
 * connect/reconnect gestures (P4) work on it.
 *
 * The canvas owns the ONLY document-level pointer loop: `interaction/drag.ts`,
 * `interaction/create.ts` and `interaction/connect.ts` are pure start/update/end
 * state machines, and {@link Canvas.handlePointerMove} feeds whichever one the
 * gesture's intent named. A palette create ({@link Canvas.startCreate}) may begin
 * outside the canvas, so it installs the same listeners without a canvas
 * `pointerdown`.
 *
 * The SVG DOM is created via {@link svg} helpers, which default to the global
 * `document` (present under the playwright/chromium test DOM) and can be swapped
 * with `setDocument` for a headless harness.
 */

import { EventBus } from '@canvas/events/bus.ts';
import { importDefinitions } from '@canvas/model/import.ts';
import type { ImportOptions } from '@canvas/model/import.ts';
import type {
  ModdleObject,
  Point,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';
import { hitTest, nodesIntersecting, normalizeRect } from '@canvas/interaction/hit.ts';
import type { HitOptions } from '@canvas/interaction/hit.ts';
import { Selection } from '@canvas/interaction/selection.ts';
import type { HandleHit, WaypointHit } from '@canvas/interaction/selection.ts';
import { DEFAULT_GRID_SIZE, Drag, snapTo } from '@canvas/interaction/drag.ts';
import { Create, createShape, type CreatePrototype, type ShapeDescriptor } from '@canvas/interaction/create.ts';
import { Connect, type ConnectionEnd } from '@canvas/interaction/connect.ts';
import { LabelEditing } from '@canvas/interaction/labelEditing.ts';
import type { ElementDblClickEvent } from '@canvas/interaction/labelEditing.ts';
import type { ParticipantBand } from '@canvas/model/choreography.ts';
import type { ElementColors } from '@canvas/model/color.ts';
import { dataAssociationEnds, isDataAssociationType } from '@canvas/model/dataAssociation.ts';
import { isExpandable } from '@canvas/model/expand.ts';
import type { SetExpandedOptions } from '@canvas/model/expand.ts';
import { Writeback } from '@canvas/model/writeback.ts';
import { IdGenerator } from '@canvas/model/ids.ts';
import { Rules } from '@canvas/rules/rules.ts';
import {
  edgesAffectedBy,
  rerouteEdges as rerouteEdgeSet,
  type RouteOptions,
} from '@canvas/routing/orthogonal.ts';
import { append, create, ownerDocument, remove } from '@canvas/render/svg.ts';
import { ensureArrowMarkers, Renderer } from '@canvas/render/renderer.ts';
import type { RendererOptions } from '@canvas/render/renderer.ts';
import { Layers } from '@canvas/view/layers.ts';
import { sceneBounds, Viewport } from '@canvas/view/viewport.ts';

/** Options for constructing a {@link Canvas}. */
export interface CanvasOptions extends RendererOptions {
  /** Host element the SVG root is appended to. A detached `<div>` is created if omitted. */
  container?: HTMLElement;
  /** Import-time warning sink, forwarded to {@link importDefinitions}. */
  onWarning?: ImportOptions['onWarning'];
  /** Snap dragged geometry to a grid (default off — design §3 "behind a flag"). */
  snapToGrid?: boolean;
  /** Grid step used when {@link CanvasOptions.snapToGrid} is on. */
  gridSize?: number;
  /** Minimum node width/height a resize may produce. */
  minNodeSize?: number;
  /** Rule engine gating create/connect/reconnect. Defaults to a fresh {@link Rules}. */
  rules?: Rules;
  /**
   * Double-clicking a sub-process toggles its expanded state instead of opening the
   * inline label editor (the minimal UI affordance for design §1's expand/collapse).
   * Default `true`; turn it off to keep double-click purely a rename gesture.
   */
  toggleExpandOnDoubleClick?: boolean;
}

/** Screen-pixel drag threshold separating a click from a marquee or a drag. */
const MARQUEE_THRESHOLD_PX = 3;

/** What a pointer press intends to do once it passes the drag threshold. */
type GestureIntent =
  | 'marquee'
  | 'move'
  | 'resize'
  | 'waypoint'
  | 'create'
  | 'connect'
  | 'reconnect'
  | 'none';

/** In-flight pointer gesture state (marquee / click / drag discrimination). */
interface GestureState {
  downScreen: Point;
  downDiagram: Point;
  shift: boolean;
  intent: GestureIntent;
  /** Set once the gesture is on empty space and past the drag threshold. */
  marquee: boolean;
  /** Set once a {@link Drag} session has actually started. */
  dragging: boolean;
  handle?: HandleHit;
  waypoint?: WaypointHit;
}

/** Whether a key event landed in a text field, where Backspace/Delete edit text. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Which end of an edge an endpoint-waypoint index refers to, if either. */
function endpointOf(edge: SceneEdge, index: number): ConnectionEnd | undefined {
  if (index === 0) return 'source';
  if (index === edge.waypoints.length - 1) return 'target';
  return undefined;
}

/** Editable-SVG canvas: hit-testing, selection, drag/resize, create + connect (P2–P4). */
export class Canvas {
  private readonly container: HTMLElement;
  private readonly root: SVGSVGElement;
  private readonly layers: Layers;
  private readonly viewport: Viewport;
  private readonly renderer: Renderer;
  private readonly bus: EventBus;
  private readonly selection: Selection;
  private readonly labelEditing: LabelEditing;
  private readonly rules: Rules;
  private readonly create: Create;
  private readonly connect: Connect;
  private readonly onWarning?: ImportOptions['onWarning'];
  private readonly gridSize?: number;
  private readonly minNodeSize?: number;
  private readonly toggleExpandOnDoubleClick: boolean;
  private snapToGrid: boolean;
  private scene?: Scene;
  private writeback?: Writeback;
  private drag?: Drag;

  private gesture?: GestureState;
  private marqueeRect?: SVGRectElement;
  private readonly onMove = (ev: Event) => this.handlePointerMove(ev as MouseEvent);
  private readonly onUp = (ev: Event) => this.handlePointerUp(ev as MouseEvent);
  private readonly onKeyDown = (ev: Event) => this.handleKeyDown(ev as KeyboardEvent);
  private readonly onShortcut = (ev: Event) => this.handleShortcut(ev as KeyboardEvent);

  constructor(options: CanvasOptions = {}) {
    const doc = ownerDocument();
    this.container = options.container ?? doc.createElement('div');
    this.onWarning = options.onWarning;
    this.snapToGrid = options.snapToGrid ?? false;
    this.gridSize = options.gridSize;
    this.minNodeSize = options.minNodeSize;
    this.toggleExpandOnDoubleClick = options.toggleExpandOnDoubleClick ?? true;

    this.root = create('svg', {
      class: 'sf-canvas',
      width: '100%',
      height: '100%',
      preserveAspectRatio: 'xMidYMid meet',
    }) as SVGSVGElement;
    this.root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    append(this.container, this.root);

    this.layers = new Layers(this.root);
    ensureArrowMarkers(this.layers.defs);
    this.viewport = new Viewport(this.root, this.container);
    this.renderer = new Renderer(options);
    this.bus = new EventBus();
    this.selection = new Selection({
      layer: this.layers.getLayer('selection'),
      getGraphics: (id) => this.renderer.graphicsById.get(id),
      getScale: () => this.viewport.getViewbox().scale,
      bus: this.bus,
    });

    this.labelEditing = new LabelEditing({
      container: this.container,
      viewport: this.viewport,
      bus: this.bus,
      getScene: () => this.scene,
      getWriteback: () => this.writeback,
      redraw: (elements) => this.redrawElements(elements),
    });

    this.rules = options.rules ?? new Rules();
    this.create = new Create({
      getScene: () => this.scene,
      getWriteback: () => this.writeback,
      rules: this.rules,
      hitTest: (point) => this.hitTest(point),
      layer: this.layers.getLayer('overlays'),
      getScale: () => this.viewport.getViewbox().scale,
      snap: (point) => this.snapPoint(point),
    });
    this.connect = new Connect({
      getScene: () => this.scene,
      getWriteback: () => this.writeback,
      rules: this.rules,
      hitTest: (point) => this.hitTest(point),
      layer: this.layers.getLayer('overlays'),
      getScale: () => this.viewport.getViewbox().scale,
    });

    this.root.addEventListener('pointerdown', (ev) => this.handlePointerDown(ev as MouseEvent));
    this.root.addEventListener('dblclick', (ev) => this.handleDoubleClick(ev as MouseEvent));
    // Keyboard shortcuts (Delete/Backspace) are scoped to the canvas rather than the
    // document: the container is made focusable and takes focus on a press, and the
    // listener sits on it so a key pressed over the diagram bubbles up to it. The
    // focus hook is on the *container*, never the SVG root — `toSVG` serializes the
    // root, and an exported diagram must not carry editor plumbing.
    if (!this.container.hasAttribute('tabindex')) this.container.setAttribute('tabindex', '0');
    this.container.addEventListener('keydown', this.onShortcut);
  }

  /**
   * Build a {@link Scene} from `definitions` (a `bpmn:Definitions` moddle tree that
   * already carries DI) and render it read-only, then fit the viewport. Returns the
   * scene.
   */
  importDefinitions(definitions: ModdleObject): Scene {
    this.labelEditing.reset();
    this.selection.clear();
    this.scene = importDefinitions(definitions, { onWarning: this.onWarning });
    this.writeback = new Writeback(this.scene, this.bus, IdGenerator.fromDefinitions(definitions));
    this.create.cancel();
    this.connect.cancel();
    this.drag = new Drag({
      writeback: this.writeback,
      redraw: (elements) => this.redrawElements(elements),
      snapToGrid: this.snapToGrid,
      gridSize: this.gridSize,
      minSize: this.minNodeSize,
    });
    this.layers.clear();
    this.renderer.renderScene(
      this.scene,
      this.layers.getLayer('shapes'),
      this.layers.getLayer('connections'),
    );
    this.zoomToFit();
    return this.scene;
  }

  /** The current scene, or `undefined` before an import. */
  getScene(): Scene | undefined {
    return this.scene;
  }

  /** The host element the SVG root lives in. */
  getContainer(): HTMLElement {
    return this.container;
  }

  /** The root `<svg>` element. */
  getSvg(): SVGSVGElement {
    return this.root;
  }

  /** The viewport (pan/zoom/transforms). */
  getViewport(): Viewport {
    return this.viewport;
  }

  /** The `<g>` rendered for an element id, if any. */
  getGraphics(id: string): SVGGElement | undefined {
    return this.renderer.graphicsById.get(id);
  }

  /** Fit the viewport to every rendered element (with padding). */
  zoomToFit(padding = 40): void {
    if (!this.scene) return;
    const elements: SceneElement[] = [];
    for (const element of this.scene.elementsById.values()) {
      if (element.kind === 'node' || element.kind === 'edge') elements.push(element);
    }
    this.viewport.fitBounds(sceneBounds(elements), padding);
  }

  /** The event bus (`selection.changed`, `element(s).changed`, …). */
  getEventBus(): EventBus {
    return this.bus;
  }

  /** The selection set + overlay (design §3 `interaction/selection.ts`). */
  getSelection(): Selection {
    return this.selection;
  }

  /** The inline label editor (design §3 `interaction/labelEditing.ts`). */
  getLabelEditing(): LabelEditing {
    return this.labelEditing;
  }

  /** The DI writeback for the current scene, or `undefined` before an import. */
  getWriteback(): Writeback | undefined {
    return this.writeback;
  }

  /** The drag/resize gesture runner, or `undefined` before an import. */
  getDrag(): Drag | undefined {
    return this.drag;
  }

  /** The rule engine gating create/connect/reconnect (design §3 `rules/rules.ts`). */
  getRules(): Rules {
    return this.rules;
  }

  /** The palette create gesture (design §3 `interaction/create.ts`). */
  getCreate(): Create {
    return this.create;
  }

  /** The connect/reconnect gesture (design §3 `interaction/connect.ts`). */
  getConnect(): Connect {
    return this.connect;
  }

  // --- create / connect gestures (P4) ---------------------------------------

  /**
   * Turn a palette descriptor into a detached prototype — the facade's
   * `gestures.createShape` (`packages/modeler/src/editor/port.ts`). The result has
   * no scene identity; hand it to {@link Canvas.startCreate} or
   * {@link Canvas.createElement}.
   */
  createShape(descriptor: ShapeDescriptor | CreatePrototype): CreatePrototype {
    return createShape(descriptor);
  }

  /**
   * Begin a palette create drag — the facade's `gestures.startCreate`. `event` is
   * the palette's own mouse event (it may originate outside the canvas), so the
   * document-level pointer listeners are installed here rather than on a canvas
   * `pointerdown`. With no event the prototype starts at the viewport centre.
   */
  startCreate(event: MouseEvent | undefined, descriptor: ShapeDescriptor | CreatePrototype): boolean {
    if (!this.scene) return false;
    const prototype = createShape(descriptor);
    const point = event ? this.eventPoint(event) : this.viewportCentre();
    if (!this.create.start(prototype, point)) return false;
    this.gesture = {
      downScreen: event ? { x: event.clientX, y: event.clientY } : { x: 0, y: 0 },
      downDiagram: point,
      shift: false,
      intent: 'create',
      marquee: false,
      dragging: true,
    };
    this.listen();
    return true;
  }

  /**
   * Place a shape centred on a diagram point without a drag (click-to-place, and
   * the programmatic path). Returns the new node, or `undefined` when the rules
   * reject the drop.
   */
  createElement(descriptor: ShapeDescriptor | CreatePrototype, center: Point): SceneNode | undefined {
    const node = this.create.createAt(createShape(descriptor), center);
    if (node) this.mount(node);
    if (node) this.selection.select(node);
    return node;
  }

  /** Begin dragging a new connection out of `source` (context pad / append). */
  startConnect(source: SceneNode, event?: MouseEvent): boolean {
    if (!this.scene) return false;
    const point = event ? this.eventPoint(event) : { x: source.x + source.width, y: source.y + source.height / 2 };
    if (!this.connect.start(source, point)) return false;
    this.gesture = {
      downScreen: event ? { x: event.clientX, y: event.clientY } : { x: 0, y: 0 },
      downDiagram: point,
      shift: false,
      intent: 'connect',
      marquee: false,
      dragging: true,
    };
    this.listen();
    return true;
  }

  /**
   * Connect two nodes without a drag: mints the flow the rules name, with routed +
   * cropped waypoints, and selects it. `undefined` when the rules refuse the pair.
   */
  connectElements(source: SceneNode, target: SceneNode): SceneEdge | undefined {
    const edge = this.connect.connect(source, target);
    if (!edge) return undefined;
    this.mount(edge);
    this.selection.select(edge);
    return edge;
  }

  /**
   * Move one end of an existing connection onto `node` (gated by
   * `connection.reconnect`), re-routing it. Returns whether it happened.
   */
  reconnectElement(edge: SceneEdge, end: ConnectionEnd, node: SceneNode): boolean {
    if (!this.connect.reconnect(edge, end, node)) return false;
    this.redrawElements([edge]);
    return true;
  }

  // --- expand / collapse (P5) -----------------------------------------------

  /**
   * Expand or collapse a sub-process: `BPMNShape.isExpanded` is written through to
   * the live DI ({@link Writeback.setExpanded}), the shape resizes to match, and the
   * contents it hides/reveals are re-drawn here — a collapsed container's descendants
   * (including a nested plane's, design §1) render `display="none"` and stop taking
   * hits, while their business objects and DI stay exactly where the document put
   * them. Returns whether anything was written.
   */
  setExpanded(node: SceneNode, expanded: boolean, options?: SetExpandedOptions): boolean {
    const writeback = this.writeback;
    if (!writeback) return false;
    const { changed, contents } = writeback.setExpanded(node, expanded, options);
    if (changed.length === 0) return false;
    // Contents first, then the container and its edges, so the selection overlay is
    // refreshed against the final geometry.
    this.redrawElements([...contents, ...changed]);
    return true;
  }

  /** Flip a sub-process between expanded and collapsed ({@link Canvas.setExpanded}). */
  toggleExpanded(node: SceneNode, options?: SetExpandedOptions): boolean {
    return this.setExpanded(node, node.isExpanded === false, options);
  }

  /** Whether `node` is a container whose expanded state can be toggled. */
  canExpand(node: SceneNode): boolean {
    return isExpandable(node.type);
  }

  /**
   * Show or hide a gateway's marker (`BPMNShape.isMarkerVisible` — the × of an
   * exclusive gateway) and re-draw it. Returns whether anything was written.
   */
  setMarkerVisible(node: SceneNode, visible: boolean): boolean {
    const writeback = this.writeback;
    if (!writeback || !writeback.setMarkerVisible(node, visible)) return false;
    this.redrawElements([node]);
    return true;
  }

  // --- data associations (P5) ------------------------------------------------

  /**
   * Connect a data shape and an activity with a data association: the
   * `bpmn:DataInputAssociation` / `bpmn:DataOutputAssociation` business object (filed
   * on the activity, with its `ioSpecification` slot minted when the activity
   * declares one) AND its `bpmndi:BPMNEdge`, routed and cropped like any other
   * connection. The direction follows which end is the data shape.
   *
   * Same gate and same path as dragging one: the rules classify the pair
   * (`rules/rules.ts` `structuralConnection` names exactly these two types for a
   * data shape and an activity/throw-or-catch event), and the verdict is honoured
   * here too — so this is {@link Canvas.connectElements} narrowed to data
   * associations, not a second way in. Returns `undefined` when the rules refuse
   * the pair or would make it some other kind of connection.
   */
  createDataAssociation(source: SceneNode, target: SceneNode): SceneEdge | undefined {
    if (!dataAssociationEnds(source, target)) return undefined;
    const verdict = this.rules.canConnect(source, target);
    if (!verdict || !isDataAssociationType(verdict.type)) return undefined;
    return this.connectElements(source, target);
  }

  // --- choreography bands (P5) -----------------------------------------------

  /**
   * Rename a choreography participant band. The text belongs to the
   * `bpmn:Participant` the task references, not to the task
   * ({@link Writeback.setBandName}) — and that participant is usually shared, so
   * every task drawing a band for it is re-drawn here. Returns whether anything was
   * written.
   */
  setBandName(node: SceneNode, band: ParticipantBand, name: string): boolean {
    const changed = this.writeback?.setBandName(node, band, name) ?? [];
    if (changed.length === 0) return false;
    this.redrawElements(changed);
    return true;
  }

  /** Make `band`'s participant the initiating one, and re-draw the shading. */
  setInitiator(node: SceneNode, band: ParticipantBand): boolean {
    if (!this.writeback?.setInitiator(node, band)) return false;
    this.redrawElements([node]);
    return true;
  }

  /** Flip which choreography band initiates ({@link Canvas.setInitiator}). */
  swapInitiator(node: SceneNode): boolean {
    if (!this.writeback?.swapInitiator(node)) return false;
    this.redrawElements([node]);
    return true;
  }

  // --- colour (P5) -----------------------------------------------------------

  /**
   * Set the fill and/or stroke of `elements` — the facade's `mutate.setColor`. The
   * colours are written onto each element's DI in the bpmn.io colour extension
   * (`model/color.ts`) and the elements are re-drawn from it. An omitted field is
   * left alone; a falsy one clears that colour; a connection takes a stroke only.
   * Returns the elements actually re-coloured.
   */
  setColor(elements: SceneElement | readonly SceneElement[], colors: ElementColors): SceneElement[] {
    const changed = this.writeback?.setColor(elements, colors) ?? [];
    if (changed.length > 0) this.redrawElements(changed);
    return changed;
  }

  // --- deletion (P5) --------------------------------------------------------

  /**
   * Delete the current selection. Returns every element actually removed — the
   * closure of the request, so deleting a container also reports its descendants
   * and deleting a node reports its incident edges.
   */
  deleteSelection(): SceneElement[] {
    return this.deleteElements(this.selection.get());
  }

  /**
   * Delete `elements` from the document and the canvas: the scene/moddle half runs
   * through {@link Writeback.deleteElements} (business objects unfiled, references
   * pruned, DI and nested planes dropped — `model/remove.ts`), and the canvas half
   * here drops the SVG graphics, closes an inline editor that was open on a removed
   * element, narrows the selection to the survivors, and re-draws the neighbours
   * whose endpoint lists changed.
   */
  deleteElements(elements: SceneElement | readonly SceneElement[]): SceneElement[] {
    const writeback = this.writeback;
    if (!writeback || !this.scene) return [];
    const list = Array.isArray(elements)
      ? (elements as readonly SceneElement[]).slice()
      : [elements as SceneElement];
    if (list.length === 0) return [];

    const session = this.labelEditing.getSession();
    const { removed, changed } = writeback.deleteElements(list);
    if (removed.length === 0) return [];

    if (session && removed.includes(session.element)) this.labelEditing.cancel();

    const removedIds = new Set(removed.map((element) => element.id));
    const keep = this.selection.get().filter((element) => !removedIds.has(element.id));
    for (const element of removed) this.renderer.erase(element.id);
    this.selection.select(keep.length > 0 ? keep : null);
    this.redrawElements(changed);
    return removed;
  }

  /** Move one waypoint of an edge to a diagram point and commit it (P3 semantics). */
  private moveWaypoint(edge: SceneEdge, index: number, point: Point): void {
    const writeback = this.writeback;
    if (!writeback || index < 0 || index >= edge.waypoints.length) return;
    const at = this.snapPoint(point);
    const points = edge.waypoints.map((p) => ({ x: p.x, y: p.y }));
    points[index] = at;
    writeback.setEdgeWaypoints(edge, points);
    this.redrawElements([edge]);
  }

  /** Draw a newly created element's graphics into its layer and index them. */
  private mount(element: SceneElement): SVGGElement {
    const g = element.kind === 'node'
      ? this.renderer.drawShape(element)
      : this.renderer.drawEdge(element);
    append(this.layers.getLayer(element.kind === 'node' ? 'shapes' : 'connections'), g);
    this.renderer.graphicsById.set(element.id, g);
    return g;
  }

  /** The diagram-space centre of the current viewport (create with no pointer). */
  private viewportCentre(): Point {
    const box = this.viewport.getViewbox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Grid-snap a diagram point when snapping is on. */
  private snapPoint(point: Point): Point {
    if (!this.snapToGrid) return { ...point };
    const step = this.gridSize ?? DEFAULT_GRID_SIZE;
    return { x: snapTo(point.x, step), y: snapTo(point.y, step) };
  }

  /** Turn grid snapping for drag/resize on or off (design §3, off by default). */
  setSnapToGrid(on: boolean): void {
    this.snapToGrid = on;
    this.drag?.setSnapToGrid(on);
  }

  /** Whether grid snapping is on. */
  isSnapToGrid(): boolean {
    return this.snapToGrid;
  }

  /**
   * Re-draw `elements` from their current scene geometry and refresh the selection
   * overlay. Called on every live drag frame and after any external geometry edit.
   */
  redrawElements(elements: SceneElement[]): void {
    for (const element of elements) {
      this.renderer.redraw(element);
      this.selection.restoreMarkers(element.id);
    }
    this.selection.refresh();
  }

  /**
   * Re-route the edges `elements` affects — every edge docked to one of the given
   * nodes (their nested children included) plus any edge listed outright — through
   * the orthogonal router (`routing/orthogonal.ts`), cropping each endpoint to its
   * shape outline. `elements` defaults to the current selection.
   *
   * This is the deliberate counterpart to the drag-time behaviour: a live
   * move/resize keeps P3's minimal "endpoints follow the shape" docking
   * (`model/writeback.ts` `dockConnectedEdges`), and a *real* re-route is an
   * explicit act — what a dropped connect gesture, a reconnect, or a "clean up
   * layout" command asks for.
   *
   * Committed as one batch through {@link Writeback}: one revision bump, one
   * `elements.changed`, `di:waypoint` written for each edge that actually moved.
   * Returns the edges whose waypoints changed.
   */
  rerouteEdges(
    elements?: SceneElement | readonly SceneElement[],
    options?: RouteOptions,
  ): SceneEdge[] {
    const writeback = this.writeback;
    if (!this.scene || !writeback) return [];
    const list = elements === undefined
      ? this.selection.get()
      : Array.isArray(elements)
        ? (elements as readonly SceneElement[])
        : [elements as SceneElement];
    const changed = rerouteEdgeSet(edgesAffectedBy(list), options);
    if (changed.length > 0) {
      writeback.commit(changed);
      this.redrawElements(changed);
    }
    return changed;
  }

  /**
   * The topmost {@link SceneElement} under a diagram-coordinate `point`, or
   * `undefined` for empty space. Geometry-based (works under jsdom).
   */
  hitTest(point: Point, options?: HitOptions): SceneElement | undefined {
    if (!this.scene) return undefined;
    return hitTest(this.scene, point, options);
  }

  // --- pointer interaction --------------------------------------------------

  /** Diagram coordinates of a pointer/mouse event. */
  private eventPoint(ev: MouseEvent): Point {
    return this.viewport.toDiagram({ x: ev.clientX, y: ev.clientY });
  }

  private handlePointerDown(ev: MouseEvent): void {
    if (!this.scene) return;
    // Only the primary button starts a selection gesture.
    if (typeof ev.button === 'number' && ev.button !== 0) return;
    // Take the keyboard focus so the canvas-scoped shortcuts (Delete) reach us.
    if (this.container.ownerDocument.activeElement !== this.container) {
      this.container.focus?.({ preventScroll: true });
    }
    const pt = this.eventPoint(ev);

    // Selection-overlay handles are checked first and never change the selection:
    // they sit on top of everything and belong to an already-selected element.
    const handle = this.selection.handleAt(pt);
    const waypoint = handle ? undefined : this.selection.waypointAt(pt);

    let intent: GestureIntent = 'marquee';
    if (handle) intent = 'resize';
    else if (waypoint) {
      // Grabbing a *terminal* waypoint of a selected edge re-connects that end
      // (rules-gated); dropped clear of any shape it falls back to P3's free
      // endpoint move. An interior waypoint only ever bends the polyline.
      intent = endpointOf(waypoint.edge, waypoint.index) ? 'reconnect' : 'waypoint';
    }

    let hit: SceneElement | undefined;
    if (!handle && !waypoint) {
      hit = this.hitTest(pt);
      if (hit) {
        if (ev.shiftKey) this.selection.toggle(hit);
        else if (!this.selection.isSelected(hit)) this.selection.select(hit);
        // A hit with an existing selection under a shift-less press keeps the set
        // (so a subsequent drag moves the group); a plain press on an unselected
        // element selects just it (above).
        intent = this.selection.isSelected(hit) ? 'move' : 'none';
      }
    }

    this.gesture = {
      downScreen: { x: ev.clientX, y: ev.clientY },
      downDiagram: pt,
      shift: !!ev.shiftKey,
      intent,
      marquee: false,
      dragging: false,
      handle,
      waypoint,
    };

    this.listen();
  }

  /** Install the document-level pointer/key listeners a live gesture needs. */
  private listen(): void {
    const doc = this.root.ownerDocument ?? ownerDocument();
    doc.addEventListener('pointermove', this.onMove);
    doc.addEventListener('pointerup', this.onUp);
    doc.addEventListener('keydown', this.onKeyDown);
  }

  private handlePointerMove(ev: MouseEvent): void {
    const g = this.gesture;
    if (!g) return;
    const pt = this.eventPoint(ev);
    if (g.dragging) {
      this.updateGesture(g, pt);
      return;
    }
    const dx = ev.clientX - g.downScreen.x;
    const dy = ev.clientY - g.downScreen.y;
    if (!g.marquee && Math.hypot(dx, dy) < MARQUEE_THRESHOLD_PX) return;

    if (g.intent === 'marquee') {
      g.marquee = true;
      this.drawMarquee(g.downDiagram, pt);
      return;
    }
    if (this.startDrag(g)) {
      g.dragging = true;
      this.updateGesture(g, pt);
    }
  }

  /** Feed a live pointer position to whichever gesture the intent named. */
  private updateGesture(g: GestureState, point: Point): void {
    if (g.intent === 'create') this.create.update(point);
    else if (g.intent === 'connect' || g.intent === 'reconnect') this.connect.update(point);
    else this.drag?.update(point);
  }

  /** Open the {@link Drag} session the gesture's intent calls for. */
  private startDrag(g: GestureState): boolean {
    const drag = this.drag;
    if (!drag) return false;
    if (g.intent === 'resize' && g.handle) {
      return drag.startResize(g.handle.node, g.handle.handle, g.downDiagram);
    }
    if (g.intent === 'waypoint' && g.waypoint) {
      return drag.startWaypoint(g.waypoint.edge, g.waypoint.index, g.downDiagram);
    }
    if (g.intent === 'reconnect' && g.waypoint) {
      const end = endpointOf(g.waypoint.edge, g.waypoint.index);
      return !!end && this.connect.startReconnect(g.waypoint.edge, end, g.downDiagram);
    }
    if (g.intent === 'move') {
      const nodes = this.selection.get().filter((e): e is SceneNode => e.kind === 'node');
      return drag.startMove(nodes, g.downDiagram);
    }
    return false;
  }

  private handlePointerUp(ev: MouseEvent): void {
    const g = this.gesture;
    this.endGesture();
    if (!g || !this.scene) {
      this.clearMarquee();
      return;
    }

    if (g.dragging) {
      const pt = this.eventPoint(ev);
      if (g.intent === 'create') {
        const node = this.create.end(pt);
        if (node) {
          this.mount(node);
          this.selection.select(node);
        }
      } else if (g.intent === 'connect' || g.intent === 'reconnect') {
        const kind = this.connect.getKind();
        const edge = this.connect.end(pt);
        if (edge) {
          if (kind === 'connect') this.mount(edge);
          else this.redrawElements([edge]);
          this.selection.select(edge);
        } else if (kind === 'reconnect' && g.waypoint) {
          // The endpoint was not dropped on a shape that would take it: keep P3's
          // free endpoint move rather than snapping back, so dragging a terminal
          // waypoint into open space still just bends the edge.
          this.moveWaypoint(g.waypoint.edge, g.waypoint.index, pt);
        }
      } else {
        this.drag?.end(pt);
      }
    } else if (g.marquee) {
      const from = g.downDiagram;
      const to = this.eventPoint(ev);
      const rect = normalizeRect({
        x: from.x,
        y: from.y,
        width: to.x - from.x,
        height: to.y - from.y,
      });
      const nodes = nodesIntersecting(this.scene, rect);
      this.selection.select(nodes, g.shift);
    } else if (g.intent === 'marquee' && !g.shift) {
      // A plain click on empty space clears the selection.
      this.selection.clear();
    }
    this.clearMarquee();
  }

  /**
   * A double click fires `element.dblclick` (so the app can hook it) and opens the
   * inline label editor over the element's label. The label of an event/gateway/data
   * shape is drawn *outside* its bounds, so a click that misses every shape is given
   * a second chance against the external-label boxes.
   *
   * On a sub-process the double click means "open me up" instead: it toggles the
   * expanded state ({@link Canvas.setExpanded}) — the minimal UI affordance for the
   * P5 expand/collapse writeback, switchable off with
   * {@link CanvasOptions.toggleExpandOnDoubleClick}.
   */
  private handleDoubleClick(ev: MouseEvent): void {
    if (!this.scene) return;
    const pt = this.eventPoint(ev);
    const element = this.hitTest(pt) ?? this.labelEditing.labelTargetAt(pt);
    if (!element) return;

    this.bus.fire<ElementDblClickEvent>('element.dblclick', {
      element,
      originalEvent: ev,
      point: pt,
    });
    if (!this.selection.isSelected(element)) this.selection.select(element);
    if (
      this.toggleExpandOnDoubleClick
      && element.kind === 'node'
      && isExpandable(element.type)
    ) {
      this.toggleExpanded(element);
      return;
    }
    this.labelEditing.activate(element, { at: pt });
  }

  /**
   * Canvas-scoped keyboard shortcuts. Delete/Backspace removes the selection — but
   * never while an inline label editor (or any other text field) has the key, where
   * Backspace means "erase a character".
   */
  private handleShortcut(ev: KeyboardEvent): void {
    if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
    if (ev.defaultPrevented || this.labelEditing.isActive() || isTextEntry(ev.target)) return;
    if (this.deleteSelection().length === 0) return;
    ev.preventDefault();
  }

  /** Escape abandons an in-flight drag without writing anything back. */
  private handleKeyDown(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' || !this.gesture) return;
    this.drag?.cancel();
    this.create.cancel();
    this.connect.cancel();
    this.endGesture();
    this.clearMarquee();
  }

  /** Drop the gesture state and its document-level listeners. */
  private endGesture(): void {
    this.gesture = undefined;
    const doc = this.root.ownerDocument ?? ownerDocument();
    doc.removeEventListener('pointermove', this.onMove);
    doc.removeEventListener('pointerup', this.onUp);
    doc.removeEventListener('keydown', this.onKeyDown);
  }

  private drawMarquee(a: Point, b: Point): void {
    const rect = normalizeRect({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
    if (!this.marqueeRect) {
      this.marqueeRect = create('rect', { class: 'sf-marquee' }) as SVGRectElement;
      const scale = this.viewport.getViewbox().scale || 1;
      this.marqueeRect.setAttribute('fill', 'rgba(26,115,232,0.08)');
      this.marqueeRect.setAttribute('stroke', '#1a73e8');
      this.marqueeRect.setAttribute('stroke-width', String(1 / scale));
      this.marqueeRect.setAttribute('stroke-dasharray', `${3 / scale},${2 / scale}`);
      append(this.layers.getLayer('overlays'), this.marqueeRect);
    }
    this.marqueeRect.setAttribute('x', String(rect.x));
    this.marqueeRect.setAttribute('y', String(rect.y));
    this.marqueeRect.setAttribute('width', String(rect.width));
    this.marqueeRect.setAttribute('height', String(rect.height));
  }

  private clearMarquee(): void {
    remove(this.marqueeRect);
    this.marqueeRect = undefined;
  }

  /** Serialize the live canvas SVG to a string (design §4 `saveSVG`). */
  toSVG(): string {
    const doc = ownerDocument();
    const view = (doc.defaultView ?? (typeof window !== 'undefined' ? window : undefined)) as
      | (Window & typeof globalThis)
      | undefined;
    if (view && typeof view.XMLSerializer === 'function') {
      return new view.XMLSerializer().serializeToString(this.root);
    }
    // Fallback for a DOM without XMLSerializer.
    return this.root.outerHTML ?? '';
  }
}
