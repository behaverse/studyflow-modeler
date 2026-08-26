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

import { BPMN } from '@core/constants.ts';

import { EventBus } from '@canvas/events/bus.ts';
import { importDefinitions } from '@canvas/model/import.ts';
import type { ImportOptions } from '@canvas/model/import.ts';
import type {
  Bounds,
  ModdleObject,
  Point,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';
import { hitTest, nodesIntersecting, normalizeRect } from '@canvas/interaction/hit.ts';
import type { HitOptions } from '@canvas/interaction/hit.ts';
import { EDITING_MARKER, Selection } from '@canvas/interaction/selection.ts';
import type { HandleHit, WaypointHit } from '@canvas/interaction/selection.ts';
import { DEFAULT_GRID_SIZE, Drag, snapTo, withDescendants } from '@canvas/interaction/drag.ts';
import { Create, createShape, type CreatePrototype, type ShapeDescriptor } from '@canvas/interaction/create.ts';
import { Connect, type ConnectionEnd } from '@canvas/interaction/connect.ts';
import {
  collectSnapTargets,
  snapMove,
  snapPoint,
  type SnapTargets,
} from '@canvas/interaction/snapping.ts';
import { LabelEditing } from '@canvas/interaction/labelEditing.ts';
import type {
  DirectEditingEvent,
  ElementDblClickEvent,
} from '@canvas/interaction/labelEditing.ts';
import type { ParticipantBand } from '@canvas/model/choreography.ts';
import type { ElementColors } from '@canvas/model/color.ts';
import { dataAssociationEnds, isDataAssociationType } from '@canvas/model/dataAssociation.ts';
import { isCollapsed, isExpandable } from '@canvas/model/expand.ts';
import { ExternalLabels, isLabelElement } from '@canvas/model/externalLabel.ts';
import type { SetExpandedOptions } from '@canvas/model/expand.ts';
import { depthOf } from '@canvas/model/tree.ts';
import { Writeback } from '@canvas/model/writeback.ts';
import { IdGenerator } from '@canvas/model/ids.ts';
import { Rules } from '@canvas/rules/rules.ts';
import {
  edgesAffectedBy,
  rerouteEdges as rerouteEdgeSet,
  type RouteOptions,
} from '@canvas/routing/orthogonal.ts';
import { labelIdOf } from '@canvas/render/labels.ts';
import { OUTLINE_CLASS } from '@canvas/render/outline.ts';
import { append, create, ownerDocument, remove } from '@canvas/render/svg.ts';
import { ensureArrowMarkers, Renderer } from '@canvas/render/renderer.ts';
import type { RendererOptions } from '@canvas/render/renderer.ts';
import { Layers } from '@canvas/view/layers.ts';
import { injectCanvasStyles } from '@canvas/view/theme.ts';
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

/** Diagram units one arrow key moves the selection (parity spec §9). */
const SMALL_NUDGE = 1;
/** …and with `Shift` held. */
const LARGE_NUDGE = 10;

/**
 * Zoom factor of one keyboard step. diagram-js divides its whole zoom range
 * (`0.2`…`4`) into ten steps, so one press multiplies the scale by `(4/0.2)^(1/10)`
 * — which is the `1.349282860755920` the reference capture recorded for `Ctrl+=`
 * from 1:1, to every digit.
 */
const ZOOM_STEP = Math.pow(4 / 0.2, 1 / 10);

/**
 * Whether a freshly created shape opens its label editor (parity spec §7 "on drop
 * the new element is selected and its direct-editing label editor opens").
 *
 * bpmn-js does NOT do this for everything it creates — `LabelEditingProvider` hooks
 * `create.end` and activates only for a task, a text annotation, a group, or a
 * COLLAPSED sub-process: the shapes whose label is drawn inside them and which are
 * therefore created unnamed and useless. An event or a gateway keeps its caption
 * outside and is left alone, and the reference capture agrees (a dropped user task
 * reports `editorOpen: true`; a click-placed parallel gateway reports only the
 * selection).
 */
function opensEditorOnCreate(node: SceneNode): boolean {
  if (EDIT_ON_CREATE_TYPES.has(node.type)) return true;
  return isCollapsed(node);
}

/** The types {@link opensEditorOnCreate} names outright (bpmn-js's `isAny` list). */
const EDIT_ON_CREATE_TYPES = new Set<string>([
  BPMN.Task,
  BPMN.UserTask,
  BPMN.ServiceTask,
  BPMN.ScriptTask,
  BPMN.ManualTask,
  BPMN.SendTask,
  BPMN.ReceiveTask,
  BPMN.BusinessRuleTask,
  BPMN.TextAnnotation,
  BPMN.Group,
]);

/**
 * Wheel sensitivity — diagram-js's `ZoomScroll` `DEFAULT_SCALE`. One notch of a
 * plain wheel pans by `scale x deltaY` screen pixels; with `Ctrl` the same delta is
 * turned into a fraction of a zoom step (see {@link Canvas.handleWheel}).
 */
const WHEEL_SCALE = 0.75;

/** Zoom range wheel zooming is capped to (diagram-js `ZoomScroll` `RANGE`). */
const WHEEL_ZOOM_RANGE = { min: 0.2, max: 4 };

/**
 * Logarithmic size of one wheel zoom step. diagram-js zooms the wheel at HALF the
 * keyboard's step size (`NUM_STEPS * 2`), which is what turns a single -240 notch at
 * 1:1 into the `1.16158640` the reference capture recorded.
 */
const WHEEL_ZOOM_STEP = Math.log10(WHEEL_ZOOM_RANGE.max / WHEEL_ZOOM_RANGE.min) / 20;

/** Accumulated wheel delta a zoom needs before it steps (diagram-js `DELTA_THRESHOLD`). */
const WHEEL_DELTA_THRESHOLD = 0.1;

/** What a pointer press intends to do once it passes the drag threshold. */
type GestureIntent =
  | 'pan'
  | 'marquee'
  | 'move'
  | 'resize'
  | 'waypoint'
  | 'create'
  | 'connect'
  | 'reconnect'
  | 'none';

/**
 * What the live gesture snaps against, captured once when it starts: the
 * neighbouring coordinates worth aligning to, plus the geometry the alignment is
 * measured from — a moving shape's ORIGINAL bounds (its centre is what aligns), or
 * the original position of the corner / bendpoint being dragged.
 */
interface SnapContext {
  targets: SnapTargets;
  bounds?: Bounds;
  point?: Point;
}

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
  /**
   * The already-selected member of a MULTI-selection this gesture pressed on with no
   * modifier. The press keeps the whole set (a group drag has to be possible); if the
   * gesture ends as a plain click the selection collapses to just this element, which
   * is what diagram-js's `SelectionBehavior` does on `element.click`.
   */
  collapseTo?: SceneElement;
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
  /** Frozen copies of what a live move started from, painted at 0.3 behind the ghost. */
  private dragOriginals?: SVGGElement;
  /** Ids currently carrying a gesture marker, so teardown is exact. */
  private dragGhostIds: string[] = [];
  /** Ids currently tinted as a create gesture's drop target (see `markDropTarget`). */
  private dropTargetIds: string[] = [];
  private snapLines?: SVGGElement;
  /** What the live gesture may align to, and what it aligns FROM (see `snapGesture`). */
  private snapContext?: SnapContext;
  /** Screen point the last pan frame was measured from. */
  private panFrom?: Point;
  /**
   * The palette's lasso tool is armed: the next press starts a marquee instead of a
   * pan. Dragging empty canvas PANS on this backend (parity spec §10), so the lasso
   * is reachable only this way — exactly as in the reference, where the marquee is
   * the palette's first tool and nothing else.
   */
  private lassoArmed = false;
  /** Accumulated `Ctrl`+wheel delta, stepped once it passes the threshold. */
  private wheelDelta = 0;
  /** The synthetic elements external labels are selected/edited through. */
  private readonly labels = new ExternalLabels();
  /** What `Ctrl+C` / `Ctrl+X` last took (see {@link Canvas.getClipboard}). */
  private clipboard: SceneElement[] = [];
  private readonly onMove = (ev: Event) => this.handlePointerMove(ev as MouseEvent);
  private readonly onUp = (ev: Event) => this.handlePointerUp(ev as MouseEvent);
  private readonly onKeyDown = (ev: Event) => this.handleKeyDown(ev as KeyboardEvent);
  private readonly onShortcut = (ev: Event) => this.handleShortcut(ev as KeyboardEvent);
  // Bound fields, not inline arrows: `destroy()` has to be able to remove these.
  private readonly onDown = (ev: Event) => this.handlePointerDown(ev as MouseEvent);
  private readonly onDblClick = (ev: Event) => this.handleDoubleClick(ev as MouseEvent);
  private readonly onHover = (ev: Event) => this.handleHover(ev as MouseEvent);
  private readonly onWheel = (ev: Event) => this.handleWheel(ev as WheelEvent);
  private destroyed = false;

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
    // Editor chrome (outlines, handles, bendpoints, ghost, snap lines, lasso) is
    // painted from one stylesheet of diagram-js-shaped tokens rather than from
    // hard-coded attributes; see `view/theme.ts`. Idempotent per document.
    injectCanvasStyles(this.root.ownerDocument ?? doc);

    this.layers = new Layers(this.root);
    ensureArrowMarkers(this.layers.defs);
    this.viewport = new Viewport(this.root, this.container);
    this.renderer = new Renderer(options);
    this.bus = new EventBus();
    this.rules = options.rules ?? new Rules();
    this.selection = new Selection({
      layer: this.layers.getLayer('selection'),
      getGraphics: (id) => this.renderer.graphicsById.get(id),
      bus: this.bus,
      root: this.root,
      // The overlay offers exactly the gestures the rules allow: an event or a
      // gateway is selected with an outline and no resize handles. An external
      // LABEL is never resizable either — it is sized by its text.
      canResize: (node) => !isLabelElement(node) && this.rules.canResize(node),
    });

    this.labelEditing = new LabelEditing({
      container: this.container,
      viewport: this.viewport,
      bus: this.bus,
      getScene: () => this.scene,
      getWriteback: () => this.writeback,
      redraw: (elements) => this.redrawElements(elements),
      restoreFocus: () => this.focus(),
      // A marker, not an inline style: it survives the re-draws a live edit causes,
      // and the style layer decides what "hidden label" means (`view/theme.ts`).
      setLabelHidden: (element, hidden) => {
        if (hidden) this.selection.addMarker(element.id, 'sf-label-hidden');
        else this.selection.removeMarker(element.id, 'sf-label-hidden');
      },
    });

    // While the inline editor is open the element keeps its selection outline but
    // drops its resize chips — the reference state (parity spec §5). Driven off the
    // `directEditing.*` events rather than from inside `LabelEditing` so that EVERY
    // way of opening the editor (double click, `e`, a palette drop) is covered by
    // one rule, and it reuses the very suppression the `sf-resizing` path uses.
    this.bus.on<DirectEditingEvent>('directEditing.activate', ({ element }) => {
      this.selection.addMarker(element.id, EDITING_MARKER);
    });
    const endEditing = ({ element }: DirectEditingEvent) => {
      this.selection.removeMarker(element.id, EDITING_MARKER);
    };
    this.bus.on<DirectEditingEvent>('directEditing.complete', endEditing);
    this.bus.on<DirectEditingEvent>('directEditing.cancel', endEditing);

    this.create = new Create({
      getScene: () => this.scene,
      getWriteback: () => this.writeback,
      rules: this.rules,
      hitTest: (point) => this.hitTest(point),
      layer: this.layers.getLayer('overlays'),
      getScale: () => this.viewport.getViewbox().scale,
      snap: (point) => this.snapPoint(point),
      // The palette ghost is the shape itself in blue outline, and the element under
      // it is tinted by whether it would take the drop — parity spec §7.
      drawGhost: (prototype, bounds) => this.drawCreateGhost(prototype, bounds),
      markTarget: (target, allowed) => this.markDropTarget(target, allowed),
    });
    this.connect = new Connect({
      getScene: () => this.scene,
      getWriteback: () => this.writeback,
      rules: this.rules,
      hitTest: (point) => this.hitTest(point),
      layer: this.layers.getLayer('overlays'),
      getScale: () => this.viewport.getViewbox().scale,
    });

    this.root.addEventListener('pointerdown', this.onDown);
    this.root.addEventListener('dblclick', this.onDblClick);
    // Hover tracking. It exists for ONE reason: a connection reveals its bendpoints
    // when the pointer is over it. Hovering a shape is inert by design (parity spec
    // §3 — bpmn-js adds a class and changes nothing on screen), so nothing here
    // touches a shape's graphics.
    this.root.addEventListener('pointermove', this.onHover);
    // Wheel = pan, Ctrl/Cmd+wheel = zoom about the cursor (parity spec §10). Not
    // passive: both preventDefault, or the page scrolls under the diagram.
    this.root.addEventListener('wheel', this.onWheel, { passive: false });
    // Keyboard shortcuts (Delete/Backspace, and whatever the host binds) are scoped
    // to the canvas rather than the document: the SVG root is the focusable element
    // — the same place diagram-js puts it, so one host-side key handler serves both
    // — and the listener sits on the container so a key pressed over the diagram
    // bubbles up to it. `toSVG` serializes a *copy* with this plumbing stripped, so
    // an exported diagram never carries it.
    if (!this.root.hasAttribute('tabindex')) this.root.setAttribute('tabindex', '0');
    if (!this.container.hasAttribute('tabindex')) this.container.setAttribute('tabindex', '0');
    this.container.addEventListener('keydown', this.onShortcut);
  }

  /**
   * Tear the canvas down: every listener this instance installed comes off, the
   * SVG root is detached from the host container, and the scene/writeback are
   * dropped so nothing pins the `bpmn:Definitions` moddle tree.
   *
   * The keyboard listener sits on `options.container` — an element the HOST owns
   * and typically outlives the canvas (a route change, a backend switch, "New
   * diagram") — so without this a stale instance keeps receiving `keydown` and one
   * Delete keystroke runs `deleteSelection()` on every canvas ever built against
   * that container. A gesture in flight is abandoned rather than committed, which
   * also takes the document-level `pointermove`/`pointerup`/`keydown` trio off.
   *
   * Idempotent: calling it twice is a no-op.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    // Abandon anything in flight — this is a teardown, not a commit.
    this.drag?.cancel();
    this.create.cancel();
    this.connect.cancel();
    this.labelEditing.reset();
    this.endMovePreview();
    this.hideSnapLines();
    this.clearMarquee();
    this.endGesture();

    this.root.removeEventListener('pointerdown', this.onDown);
    this.root.removeEventListener('dblclick', this.onDblClick);
    this.root.removeEventListener('pointermove', this.onHover);
    this.root.removeEventListener('wheel', this.onWheel);
    this.container.removeEventListener('keydown', this.onShortcut);

    this.bus.clear();
    this.labels.clear();
    this.layers.clear();
    this.renderer.graphicsById.clear();
    remove(this.root);
    this.scene = undefined;
    this.writeback = undefined;
    this.drag = undefined;
  }

  /** Whether {@link Canvas.destroy} has run. */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Build a {@link Scene} from `definitions` (a `bpmn:Definitions` moddle tree that
   * already carries DI) and render it read-only, then fit the viewport. Returns the
   * scene.
   */
  importDefinitions(definitions: ModdleObject): Scene {
    this.labelEditing.reset();
    this.selection.clear();
    this.selection.setHovered(undefined);
    this.labels.clear();
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
      // Per-type floors (pool 300×60, activity 100×80, …) unless the host pinned a
      // single global one through `CanvasOptions.minNodeSize`.
      ...(this.minNodeSize === undefined
        ? { minSizeFor: (node: SceneNode) => this.rules.minSizeFor(node) }
        : {}),
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
    // `grabbing` for as long as the ghost is out, whether the palette button is still
    // held (press-drag) or was released a click ago (click-to-place). Parity spec §7.
    this.root.classList.add('sf-drag-active');
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
    if (node) this.placed(node);
    return node;
  }

  /**
   * What happens to a newly created shape the moment it lands, however it landed —
   * a press-drag drop, a click-to-place, or a programmatic
   * {@link Canvas.createElement}: it is drawn, it becomes the selection, and its
   * label editor opens on it (parity spec §7 — verified there as
   * `selected: [...], editorOpen: true`).
   *
   * Which shapes open an editor is bpmn-js's rule, not "all of them"
   * ({@link opensEditorOnCreate}): a task or an annotation is created to be named, so
   * the caret is waiting; an event or a gateway is not, and popping an empty caption
   * box under every dropped gateway would be noise.
   */
  private placed(node: SceneNode): void {
    this.mount(node);
    this.selection.select(node);
    if (opensEditorOnCreate(node)) this.labelEditing.activate(node);
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
    // A caption is not an element of the document: Delete with a label selected is
    // a no-op, as it is in bpmn-js (which filters labels out of the delete closure).
    const list = (Array.isArray(elements)
      ? (elements as readonly SceneElement[]).slice()
      : [elements as SceneElement]).filter((element) => !isLabelElement(element));
    if (list.length === 0) return [];

    const session = this.labelEditing.getSession();
    const { removed, changed } = writeback.deleteElements(list);
    if (removed.length === 0) return [];

    if (session && removed.includes(session.element)) this.labelEditing.cancel();

    const removedIds = new Set(removed.map((element) => element.id));
    for (const element of removed) this.labels.drop(element);
    // A hovered connection that just went away must not keep painting bendpoints.
    const hovered = this.selection.getHovered();
    if (hovered && removedIds.has(hovered.id)) this.selection.setHovered(undefined);
    const keep = this.selection.get().filter((element) => (
      !removedIds.has(element.id)
      // …and a caption goes with the element it names.
      && !(element.labelTarget && removedIds.has(element.labelTarget.id))
    ));
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

  /**
   * Draw a newly created element's graphics into its layer and index them.
   *
   * A node is spliced in at its DEPTH, not appended: the shapes layer is kept in
   * the same ancestors-first order `Renderer.renderScene` builds (and
   * `interaction/hit.ts` assumes), so a container dropped around existing shapes —
   * an expanded sub-process, a second participant — paints BEHIND them instead of
   * covering them with its own fill. Edges share one flat layer under the shapes,
   * so they simply append.
   */
  private mount(element: SceneElement): SVGGElement {
    const g = element.kind === 'node'
      ? this.renderer.drawShape(element)
      : this.renderer.drawEdge(element);
    const layer = this.layers.getLayer(element.kind === 'node' ? 'shapes' : 'connections');
    if (element.kind === 'node') layer.insertBefore(g, this.firstDeeperThan(layer, element));
    else append(layer, g);
    this.renderer.graphicsById.set(element.id, g);
    return g;
  }

  /**
   * The first child of `layer` drawn for a node nested strictly deeper than `node`
   * — the insertion point that keeps the layer depth-ordered — or `null` to append.
   */
  private firstDeeperThan(layer: SVGGElement, node: SceneNode): ChildNode | null {
    const scene = this.scene;
    if (!scene) return null;
    const depth = depthOf(node);
    for (const child of Array.from(layer.childNodes)) {
      const id = (child as Element).getAttribute?.('data-element-id');
      const other = id ? scene.elementsById.get(id) : undefined;
      if (other && other.kind === 'node' && depthOf(other) > depth) return child;
    }
    return null;
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
      // An element's caption is drawn inside its `<g>`, so a re-draw replaced it:
      // re-point the label element at the new geometry and put its own chrome back.
      const label = this.labels.of(element);
      if (label) {
        this.selection.restoreMarkers(label.id);
        continue;
      }
      // The caption is gone (renamed to nothing): a selection still holding it would
      // be pointing at an element that is no longer drawn.
      const stale = this.selection.get().find((e) => e.id === labelIdOf(element));
      if (stale) this.selection.deselect(stale);
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
  /**
   * Put the keyboard focus on the diagram (the SVG root), so canvas-scoped
   * shortcuts reach it. Called on every press, and whenever an overlay that stole
   * the focus — the inline label editor — hands it back.
   */
  focus(): void {
    const active = this.root.ownerDocument?.activeElement;
    if (active === this.root) return;
    (this.root as unknown as { focus?: (options?: FocusOptions) => void })
      .focus?.({ preventScroll: true });
  }

  hitTest(point: Point, options?: HitOptions): SceneElement | undefined {
    if (!this.scene) return undefined;
    return hitTest(this.scene, point, options);
  }

  /**
   * The element under a diagram point AS THE EDITOR SEES IT: an external LABEL is
   * its own element (parity spec §2) and wins over whatever it happens to sit on,
   * then ordinary {@link Canvas.hitTest} takes over. This is what a press and a
   * double click resolve through; `hitTest` stays the pure scene query.
   */
  elementAt(point: Point, options?: HitOptions): SceneElement | undefined {
    const scene = this.scene;
    if (!scene) return undefined;
    return this.labels.at(scene, point) ?? hitTest(scene, point, options);
  }

  /** The selectable element of `element`'s external label, if it draws one. */
  labelFor(element: SceneElement): SceneNode | undefined {
    return this.labels.of(element);
  }

  /**
   * Arm the palette's lasso tool — the ONLY way to lasso on this backend, because
   * dragging empty canvas pans (parity spec §8/§10). The next press starts a
   * marquee whatever is under it; the tool disarms itself when that gesture ends,
   * and `Escape` disarms it too.
   */
  activateLasso(): void {
    this.setLassoArmed(true);
  }

  /** Whether the lasso tool is armed. */
  isLassoArmed(): boolean {
    return this.lassoArmed;
  }

  private setLassoArmed(on: boolean): void {
    if (this.lassoArmed === on) return;
    this.lassoArmed = on;
    this.root.classList.toggle('sf-lasso-tool', on);
  }

  /**
   * Wheel gestures (parity spec §10), ported from diagram-js's `ZoomScroll` so the
   * numbers match to the digit: a plain wheel PANS (vertically, or horizontally with
   * `Shift`), and `Ctrl`/`Cmd`+wheel zooms about the cursor in half-steps of the
   * keyboard zoom, capped to diagram-js's own 0.2…4 range.
   */
  private handleWheel(ev: WheelEvent): void {
    if (this.destroyed || !this.scene) return;
    ev.preventDefault?.();
    const isZoom = !!(ev.ctrlKey || ev.metaKey);
    const byLines = ev.deltaMode !== 0;
    const factor = -1 * WHEEL_SCALE * (isZoom ? (byLines ? 0.32 : 0.02) : (byLines ? 16 : 1));

    if (!isZoom) {
      const deltaX = ev.deltaX ?? 0;
      const deltaY = ev.deltaY ?? 0;
      if (ev.shiftKey) this.panBy(factor * deltaY, 0);
      else this.panBy(factor * deltaX, factor * deltaY);
      return;
    }

    // Accumulate until the gesture is worth a step, so a trackpad's stream of tiny
    // deltas zooms once rather than forty times.
    const deltaY = ev.deltaY ?? 0;
    const delta = Math.hypot(ev.deltaX ?? 0, deltaY) * (deltaY >= 0 ? 1 : -1) * factor;
    this.wheelDelta += delta;
    if (Math.abs(this.wheelDelta) <= WHEEL_DELTA_THRESHOLD) return;
    this.wheelDelta = 0;
    this.zoomStep(delta > 0 ? 1 : -1, this.eventPoint(ev));
  }

  /**
   * One wheel zoom step from wherever the zoom currently is, about `center`: the
   * level is snapped onto the logarithmic step grid first (diagram-js `_zoom`), so a
   * fitted, off-grid zoom lands on a round step rather than carrying its remainder.
   */
  private zoomStep(direction: 1 | -1, center: Point): number {
    const current = this.viewport.getViewbox().scale;
    const linear = Math.log10(current > 0 ? current : 1);
    const stepped = Math.round(linear / WHEEL_ZOOM_STEP) * WHEEL_ZOOM_STEP
      + WHEEL_ZOOM_STEP * direction;
    const target = Math.min(
      WHEEL_ZOOM_RANGE.max,
      Math.max(WHEEL_ZOOM_RANGE.min, Math.pow(10, stepped)),
    );
    return this.viewport.zoom(target, center);
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
    // A palette create is already in flight — it was armed by `startCreate` from a
    // gesture that began outside the canvas, so this press is where the shape
    // lands, not the start of a new one. Overwriting the gesture here would turn
    // the pending drop into a marquee (click-to-place: click the palette tile,
    // then click the canvas).
    if (this.gesture?.intent === 'create') {
      const drop = this.eventPoint(ev);
      this.gesture.downScreen = { x: ev.clientX, y: ev.clientY };
      this.gesture.downDiagram = drop;
      this.create.update(drop);
      return;
    }
    // Take the keyboard focus so the canvas-scoped shortcuts (Delete) reach us.
    this.focus();
    // A press ends hover feedback: from here on the chrome belongs to the gesture.
    this.selection.setHovered(undefined);
    const pt = this.eventPoint(ev);

    // Selection-overlay handles are checked first and never change the selection:
    // they sit on top of everything and belong to an already-selected element.
    const handle = this.selection.handleAt(pt);
    const waypoint = handle ? undefined : this.selection.waypointAt(pt);

    // Empty canvas PANS (parity spec §10); the marquee is the palette lasso tool's,
    // and nothing else arms it ({@link Canvas.activateLasso}).
    let intent: GestureIntent = this.lassoArmed ? 'marquee' : 'pan';
    if (handle) intent = 'resize';
    else if (waypoint) {
      // Grabbing a *terminal* waypoint of a selected edge re-connects that end
      // (rules-gated); dropped clear of any shape it falls back to P3's free
      // endpoint move. An interior waypoint only ever bends the polyline.
      intent = endpointOf(waypoint.edge, waypoint.index) ? 'reconnect' : 'waypoint';
    }

    let hit: SceneElement | undefined;
    let collapseTo: SceneElement | undefined;
    // An armed lasso ignores what is under the pointer entirely, as diagram-js's
    // `LassoTool` does — the press starts a rectangle, it does not select a shape.
    if (!handle && !waypoint && !this.lassoArmed) {
      hit = this.elementAt(pt);
      if (hit) {
        if (ev.shiftKey) this.selection.toggle(hit);
        else if (!this.selection.isSelected(hit)) this.selection.select(hit);
        // The PRESS on an already-selected member of a multi-selection deliberately
        // keeps the whole set, so the drag that may follow moves the group (the
        // `'move'` intent below reads the set back). diagram-js's `SelectionBehavior`
        // collapses that set to the one element on `element.click` — i.e. only once
        // the gesture has ENDED without becoming a drag — so the decision is deferred
        // to the release and carried on the gesture (see `handlePointerUp`). A LABEL
        // is selectable but not draggable here — moving a caption off its shape writes
        // `bpmndi:BPMNLabel` bounds and is P6b — so a press on one starts no gesture,
        // but it still collapses on release like any other click.
        if (!ev.shiftKey && this.selection.isSelected(hit) && this.selection.get().length > 1) {
          collapseTo = hit;
        }
        intent = isLabelElement(hit)
          ? 'none'
          : this.selection.isSelected(hit) ? 'move' : 'none';
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
      collapseTo,
    };

    this.listen();
  }

  /** Install the document-level pointer/key listeners a live gesture needs. */
  private listen(): void {
    if (this.destroyed) return;
    const doc = this.root.ownerDocument ?? ownerDocument();
    doc.addEventListener('pointermove', this.onMove);
    doc.addEventListener('pointerup', this.onUp);
    doc.addEventListener('keydown', this.onKeyDown);
  }

  private handlePointerMove(ev: MouseEvent): void {
    const g = this.gesture;
    if (!g) return;
    // Panning is measured in SCREEN pixels: the viewBox moves under the pointer, so
    // a diagram coordinate taken before the frame no longer means what it meant.
    if (g.intent === 'pan') {
      this.updatePan(g, ev);
      return;
    }
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
      // Mark what is enclosed SO FAR — outlined, in the secondary blue the root's
      // `sf-dragging-active-lasso` class selects, but not yet in the selection set
      // (so `selection.changed` fires once, on release, not once per pointer frame).
      if (this.scene) {
        const rect = normalizeRect({
          x: g.downDiagram.x,
          y: g.downDiagram.y,
          width: pt.x - g.downDiagram.x,
          height: pt.y - g.downDiagram.y,
        });
        const enclosed = nodesIntersecting(this.scene, rect);
        this.selection.previewSelection(
          g.shift ? [...this.selection.get(), ...enclosed] : enclosed,
        );
      }
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
    else {
      // Alignment snapping adjusts where the gesture lands AND draws the guides for
      // it; grid snapping (off by default) is applied inside `Drag`, so its guides
      // can only be read off the result.
      this.drag?.update(this.snapGesture(g, point));
      if (this.snapToGrid) this.updateGridSnapLines(g);
    }
  }

  /**
   * Drag the viewport itself. The gesture only becomes a pan once it passes the same
   * threshold a marquee would, so a click on empty canvas still clears the selection.
   */
  private updatePan(g: GestureState, ev: MouseEvent): void {
    if (!g.dragging) {
      const dx = ev.clientX - g.downScreen.x;
      const dy = ev.clientY - g.downScreen.y;
      if (Math.hypot(dx, dy) < MARQUEE_THRESHOLD_PX) return;
      g.dragging = true;
      this.panFrom = { ...g.downScreen };
      this.root.classList.add('sf-panning');
    }
    const from = this.panFrom ?? g.downScreen;
    this.panBy(ev.clientX - from.x, ev.clientY - from.y);
    this.panFrom = { x: ev.clientX, y: ev.clientY };
  }

  /** Pan the viewport by a SCREEN-pixel delta (the content follows the pointer). */
  private panBy(dxScreen: number, dyScreen: number): void {
    const box = this.viewport.getViewbox();
    const rect = this.container.getBoundingClientRect();
    const scaleX = box.width / (rect.width || box.width);
    const scaleY = box.height / (rect.height || box.height);
    this.viewport.pan(dxScreen * scaleX, dyScreen * scaleY);
  }

  /** Open the {@link Drag} session the gesture's intent calls for. */
  private startDrag(g: GestureState): boolean {
    const drag = this.drag;
    if (!drag) return false;
    if (g.intent === 'resize' && g.handle) {
      // The rule engine has the last word, even though the overlay only draws
      // handles where it already said yes (`Selection.canResize`): a host that
      // swaps the rules mid-session must not leave a live gesture ungated.
      if (!this.rules.canResize(g.handle.node)) return false;
      if (!drag.startResize(g.handle.node, g.handle.handle, g.downDiagram)) return false;
      this.beginSnapping(g);
      // The shape being resized drops its own outline and chips, so the geometry
      // under the cursor is unobstructed.
      this.selection.addMarker(g.handle.node.id, 'sf-resizing');
      this.dragGhostIds = [g.handle.node.id];
      return true;
    }
    if (g.intent === 'waypoint' && g.waypoint) {
      if (!drag.startWaypoint(g.waypoint.edge, g.waypoint.index, g.downDiagram)) return false;
      this.beginSnapping(g);
      return true;
    }
    if (g.intent === 'reconnect' && g.waypoint) {
      const end = endpointOf(g.waypoint.edge, g.waypoint.index);
      return !!end && this.connect.startReconnect(g.waypoint.edge, end, g.downDiagram);
    }
    if (g.intent === 'move') {
      const nodes = this.movableSelection();
      if (!drag.startMove(nodes, g.downDiagram)) return false;
      this.beginSnapping(g, nodes);
      this.beginMovePreview(nodes);
      return true;
    }
    return false;
  }

  // --- drag feedback (parity spec §7) ----------------------------------------

  /**
   * Turn a starting move into the two-part feedback bpmn-js shows: the element that
   * follows the cursor becomes a GHOST — blue outline, no fills, label included —
   * while a frozen copy of the graphics stays behind at the original position,
   * dimmed to 0.3.
   *
   * The canvas moves the real scene geometry live (P3), so the ghost IS the element
   * and needs no separate render pass: it is the live `<g>` wearing the `sf-dragger`
   * marker, which the style layer paints as an outline. The dimmed original is the
   * only thing that has to be minted, and it is a static clone — it never updates,
   * because it is a picture of where the drag began. Ids are stripped from the
   * clone so nothing can address it as the element it copies.
   */
  private beginMovePreview(nodes: readonly SceneNode[]): void {
    this.endMovePreview();
    const moving = withDescendants(nodes);
    const elements: SceneElement[] = [...moving];
    const seen = new Set<string>(moving.map((node) => node.id));
    for (const node of moving) {
      for (const edge of [...node.outgoing, ...node.incoming]) {
        if (seen.has(edge.id)) continue;
        seen.add(edge.id);
        elements.push(edge);
      }
    }

    const frozen = create('g', { class: 'sf-drag-originals' }) as SVGGElement;
    for (const element of elements) {
      const g = this.renderer.graphicsById.get(element.id);
      if (!g) continue;
      const copy = g.cloneNode(true) as SVGGElement;
      copy.classList.add('sf-dragging');
      copy.classList.remove('selected');
      for (const tagged of [copy, ...Array.from(copy.querySelectorAll('[data-element-id]'))]) {
        tagged.removeAttribute('data-element-id');
      }
      append(frozen, copy);
      this.selection.addMarker(element.id, 'sf-dragger');
      this.dragGhostIds.push(element.id);
    }
    append(this.layers.getLayer('overlays'), frozen);
    this.dragOriginals = frozen;
  }

  // --- create feedback (parity spec §7 "Creating from the app palette") -------

  /**
   * The ghost a palette create drags: the prototype drawn by the REAL renderer, so
   * a user sees the task/gateway/event they are placing rather than a box, wearing
   * `sf-dragger` so the style layer paints it as pure blue outline (the same class,
   * and the same look, as the ghost of a move).
   *
   * The synthetic node exists for the length of one render call and is never indexed
   * — it has no id, no parent and no edges, and its `data-element-id` is stripped so
   * nothing can address the ghost as an element.
   */
  private drawCreateGhost(prototype: CreatePrototype, bounds: Bounds): SVGElement | undefined {
    const ghostNode: SceneNode = {
      id: '',
      kind: 'node',
      type: prototype.type,
      businessObject: prototype.businessObject ?? ({ $type: prototype.type } as ModdleObject),
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      children: [],
      incoming: [],
      outgoing: [],
      ...(prototype.isExpanded !== undefined ? { isExpanded: prototype.isExpanded } : {}),
    };
    const g = this.renderer.drawShape(ghostNode);
    g.removeAttribute('data-element-id');
    g.classList.add('sf-dragger');
    return g;
  }

  /**
   * Tint the element a create gesture is hovering: `sf-new-parent` when it would take
   * the drop (a container, or a sequence flow the shape is inserted into),
   * `sf-drop-not-ok` when it would refuse — which also turns the cursor to
   * `not-allowed` over it and everything inside it. Over empty canvas the ROOT
   * carries `sf-new-parent`, as the diagram-js root layer does.
   *
   * Marks are exact: whatever was marked last frame is unmarked first, so a gesture
   * that crosses ten shapes leaves none of them tinted.
   */
  private markDropTarget(target: SceneElement | undefined, allowed: boolean): void {
    for (const id of this.dropTargetIds) {
      this.selection.removeMarker(id, 'sf-new-parent');
      this.selection.removeMarker(id, 'sf-drop-not-ok');
    }
    this.dropTargetIds = [];
    this.root.classList.toggle('sf-new-parent', allowed && !target);
    if (!target) return;
    this.selection.addMarker(target.id, allowed ? 'sf-new-parent' : 'sf-drop-not-ok');
    this.dropTargetIds = [target.id];
  }

  /** Drop the drag feedback: the frozen originals and every gesture marker. */
  private endMovePreview(): void {
    remove(this.dragOriginals);
    this.dragOriginals = undefined;
    for (const id of this.dragGhostIds) {
      this.selection.removeMarker(id, 'sf-dragger');
      this.selection.removeMarker(id, 'sf-resizing');
    }
    this.dragGhostIds = [];
  }

  /** The selected shapes a move gesture actually carries (a caption is not one). */
  private movableSelection(): SceneNode[] {
    return this.selection.get().filter(
      (e): e is SceneNode => e.kind === 'node' && !isLabelElement(e),
    );
  }

  /**
   * Capture what the gesture starting now may align to: the coordinates of every
   * OTHER shape, plus the geometry the alignment is measured from — a moving set's
   * lead bounds (its centre is what snaps), or the corner/bendpoint being dragged.
   *
   * A move aligns centre-to-centre, which is diagram-js's rule for a moving shape; a
   * resize or a bendpoint drag also takes neighbours' EDGES, because flushing an edge
   * with the shape beside it is the whole point of those gestures.
   */
  private beginSnapping(g: GestureState, moving?: readonly SceneNode[]): void {
    this.snapContext = undefined;
    const scene = this.scene;
    if (!scene) return;

    if (g.intent === 'move' && moving && moving.length > 0) {
      const all = withDescendants(moving);
      const lead = moving[0];
      this.snapContext = {
        targets: collectSnapTargets(scene, new Set(all.map((node) => node.id)), 'mid'),
        bounds: { x: lead.x, y: lead.y, width: lead.width, height: lead.height },
      };
      return;
    }
    if (g.intent === 'resize' && g.handle) {
      const node = g.handle.node;
      const handle = g.handle.handle;
      this.snapContext = {
        targets: collectSnapTargets(scene, new Set([node.id]), 'bounds'),
        point: {
          x: handle.includes('w') ? node.x : handle.includes('e') ? node.x + node.width : node.x + node.width / 2,
          y: handle.includes('n') ? node.y : handle.includes('s') ? node.y + node.height : node.y + node.height / 2,
        },
      };
      return;
    }
    if (g.intent === 'waypoint' && g.waypoint) {
      const p = g.waypoint.edge.waypoints[g.waypoint.index];
      if (!p) return;
      this.snapContext = {
        targets: collectSnapTargets(scene, new Set<string>(), 'bounds'),
        point: { x: p.x, y: p.y },
      };
    }
  }

  /**
   * Pull the live gesture onto the nearest alignment and draw the guides for it —
   * the snap lines of parity spec §7, which appear when the dragged shape lines up
   * with a neighbour and vanish the moment it does not.
   *
   * Returns the point the gesture should actually be fed. With grid snapping on the
   * grid is the snap authority (`Drag` rounds the geometry) and this steps aside.
   */
  private snapGesture(g: GestureState, point: Point): Point {
    const ctx = this.snapContext;
    if (this.snapToGrid || !ctx || !this.drag?.isActive()) {
      if (!this.snapToGrid) this.hideSnapLines();
      return point;
    }
    const dx = point.x - g.downDiagram.x;
    const dy = point.y - g.downDiagram.y;

    if (ctx.bounds) {
      const snapped = snapMove(ctx.bounds, dx, dy, ctx.targets);
      this.showSnapLines(snapped.guideX, snapped.guideY);
      return { x: g.downDiagram.x + snapped.dx, y: g.downDiagram.y + snapped.dy };
    }
    if (ctx.point) {
      const moved = { x: ctx.point.x + dx, y: ctx.point.y + dy };
      const snapped = snapPoint(moved, ctx.targets);
      this.showSnapLines(snapped.guideX, snapped.guideY);
      return {
        x: point.x + (snapped.point.x - moved.x),
        y: point.y + (snapped.point.y - moved.y),
      };
    }
    this.hideSnapLines();
    return point;
  }

  /**
   * Show where a GRID-snapped gesture landed. Grid snapping is off by default
   * (`CanvasOptions.snapToGrid`) and the reference editor has no grid snap at all —
   * the guides a user actually sees there come from {@link Canvas.snapGesture}'s
   * alignment snapping, which needs no flag.
   */
  private updateGridSnapLines(g: GestureState): void {
    if (!this.snapToGrid || !this.drag?.isActive()) {
      this.hideSnapLines();
      return;
    }
    if (g.intent === 'move') {
      const lead = this.movableSelection()[0];
      if (lead) this.showSnapLines(lead.x, lead.y);
      return;
    }
    if (g.intent === 'resize' && g.handle) {
      const node = g.handle.node;
      this.showSnapLines(
        g.handle.handle.includes('w') ? node.x : node.x + node.width,
        g.handle.handle.includes('n') ? node.y : node.y + node.height,
      );
      return;
    }
    if (g.intent === 'waypoint' && g.waypoint) {
      const p = g.waypoint.edge.waypoints[g.waypoint.index];
      if (p) this.showSnapLines(p.x, p.y);
    }
  }

  /**
   * Draw the snap guides at diagram `x` (a vertical line) and/or `y` (a horizontal
   * one), each spanning the visible viewport. Passing neither hides them.
   */
  showSnapLines(x?: number, y?: number): void {
    if (x === undefined && y === undefined) {
      this.hideSnapLines();
      return;
    }
    const box = this.viewport.getViewbox();
    if (!this.snapLines) {
      this.snapLines = create('g', { class: 'sf-snap-lines' }) as SVGGElement;
      append(this.layers.getLayer('overlays'), this.snapLines);
    }
    while (this.snapLines.firstChild) this.snapLines.removeChild(this.snapLines.firstChild);
    if (x !== undefined) {
      append(this.snapLines, create('line', {
        class: 'sf-snap-line',
        x1: x, y1: box.y, x2: x, y2: box.y + box.height,
      }));
    }
    if (y !== undefined) {
      append(this.snapLines, create('line', {
        class: 'sf-snap-line',
        x1: box.x, y1: y, x2: box.x + box.width, y2: y,
      }));
    }
  }

  /** Take the snap guides down. */
  hideSnapLines(): void {
    remove(this.snapLines);
    this.snapLines = undefined;
  }

  /** Whether the pointer has travelled far enough for the gesture to count as a drag. */
  private movedPastThreshold(g: GestureState, ev: MouseEvent): boolean {
    if (g.dragging || g.marquee) return true;
    return Math.hypot(ev.clientX - g.downScreen.x, ev.clientY - g.downScreen.y)
      >= MARQUEE_THRESHOLD_PX;
  }

  private handlePointerUp(ev: MouseEvent): void {
    const g = this.gesture;
    // The drop point, snapped exactly as every live frame was: what gets COMMITTED
    // has to be what the user was looking at when they let go, not the raw pointer
    // — otherwise a gesture that visibly locked onto an alignment would jump off it
    // by a unit or two the instant it landed. Computed before `endGesture`, which
    // is what drops the snap context.
    const drop = g && this.scene ? this.snapGesture(g, this.eventPoint(ev)) : undefined;
    this.endGesture();
    if (!g || !this.scene || !drop) {
      this.clearMarquee();
      return;
    }

    if (g.dragging && g.intent === 'pan') {
      // A pan writes nothing and selects nothing; the viewBox already moved.
    } else if (g.dragging) {
      const pt = drop;
      if (g.intent === 'create') {
        const node = this.create.end(pt);
        if (node) this.placed(node);
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
      const to = drop;
      const rect = normalizeRect({
        x: from.x,
        y: from.y,
        width: to.x - from.x,
        height: to.y - from.y,
      });
      const nodes = nodesIntersecting(this.scene, rect);
      this.selection.select(nodes, g.shift);
    } else if ((g.intent === 'marquee' || g.intent === 'pan') && !g.shift) {
      // A plain click on empty space clears the selection.
      this.selection.clear();
    } else if (g.collapseTo && !this.movedPastThreshold(g, ev)) {
      // The gesture pressed on a member of a multi-selection and never became a drag:
      // it was a CLICK, so the selection collapses to that one element — diagram-js's
      // `SelectionBehavior` on `element.click` (`isSelected && multi && !add`).
      // Guarded on the threshold as well as on `dragging`, so a drag that a rule
      // refused (a label, an unmovable node) is still read as a drag, not a click.
      this.selection.select(g.collapseTo);
    }
    this.clearMarquee();
    // The lasso is a one-shot tool: it is armed from the palette, it lassoes once,
    // and the canvas goes back to panning — diagram-js's non-sticky `LassoTool`.
    this.setLassoArmed(false);
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
    // The caption itself first, then the shapes, then — for a click that missed
    // everything — the wider region an external label is centred in.
    const element = this.elementAt(pt) ?? this.labelEditing.labelTargetAt(pt);
    if (!element) return;

    this.bus.fire<ElementDblClickEvent>('element.dblclick', {
      element,
      originalEvent: ev,
      point: pt,
    });
    // Exactly ONE element is selected while the editor is open, so the thing being
    // edited wears the PRIMARY selection blue. `isSelected` alone is not enough: a
    // double click that started from a multi-selection would leave the set intact and
    // paint the editing element in the secondary multi-select blue instead.
    const selected = this.selection.get();
    if (selected.length !== 1 || selected[0]?.id !== element.id) {
      this.selection.select(element);
    }
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
   * Canvas-scoped keyboard shortcuts — the map of parity spec §9, minus the two
   * entries that open app chrome the canvas does not own (see below).
   *
   * | key | effect |
   * |---|---|
   * | `Delete` / `Backspace` | delete the selection |
   * | `Ctrl/Cmd`+`A` | select everything |
   * | `Ctrl/Cmd`+`C` / `X` | copy / cut (cut removes; there is no paste yet, and the reference has none either) |
   * | `←` `→` `↑` `↓` | nudge the selection 1 unit, 10 with `Shift` |
   * | `Ctrl/Cmd`+`=` / `-` / `0` | zoom in / out / reset |
   * | `e` | open the label editor on the selection |
   * | `a` | fire `keyboard.append` (the append-anything popup is app chrome, P6b) |
   *
   * Everything else is deliberately INERT, and that is as much a parity target as
   * the bindings: `h`/`l`/`s`/`c` (stock diagram-js tool keys — the palette that
   * registers them is not this one), `F2`, `Tab`, `Enter`, and bare `+`/`-`/`0` all
   * do nothing here, and `Ctrl+Y` is not a redo (the history owner binds
   * `Ctrl+Shift+Z` only). Undo/redo and `Ctrl+F` search belong to whoever owns the
   * history and the search UI — the app — so they are not bound here either.
   *
   * Nothing fires while an inline label editor (or any other text field) has the key:
   * there `Backspace` means "erase a character" and `e` means "type an e".
   */
  private handleShortcut(ev: KeyboardEvent): void {
    if (ev.defaultPrevented || this.labelEditing.isActive() || isTextEntry(ev.target)) return;
    if (ev.altKey) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const handled = mod ? this.modifierShortcut(ev) : this.plainShortcut(ev);
    if (handled) ev.preventDefault();
  }

  /** The unmodified half of the key map (Delete, nudges, `e`, `a`). */
  private plainShortcut(ev: KeyboardEvent): boolean {
    switch (ev.key) {
      case 'Delete':
      case 'Backspace':
        return this.deleteSelection().length > 0;
      case 'ArrowLeft':
        return this.nudgeSelection(-this.nudgeStep(ev), 0);
      case 'ArrowRight':
        return this.nudgeSelection(this.nudgeStep(ev), 0);
      case 'ArrowUp':
        return this.nudgeSelection(0, -this.nudgeStep(ev));
      case 'ArrowDown':
        return this.nudgeSelection(0, this.nudgeStep(ev));
      case 'e':
        return this.editSelection();
      case 'a': {
        // The append-anything popup itself is app chrome (design §4 `popup`), so the
        // key does the canvas half — name the selection — and lets the host open it.
        const elements = this.selection.get();
        if (elements.length === 0) return false;
        this.bus.fire('keyboard.append', { elements });
        return true;
      }
      default:
        return false;
    }
  }

  /** The `Ctrl`/`Cmd` half of the key map (select all, cut/copy, zoom). */
  private modifierShortcut(ev: KeyboardEvent): boolean {
    switch (ev.key) {
      case 'a':
      case 'A':
        return this.selectAll();
      case 'c':
      case 'C':
        return this.copySelection();
      case 'x':
      case 'X':
        return this.copySelection() && this.deleteSelection().length > 0;
      // `Ctrl+=` and `Ctrl+Shift+=` (which reports `+`) are both "zoom in".
      case '=':
      case '+':
        this.zoomIn();
        return true;
      case '-':
      case '_':
        this.zoomOut();
        return true;
      case '0':
        this.viewport.zoom(1);
        return true;
      default:
        return false;
    }
  }

  /** How far one arrow press moves the selection (parity spec §9: 1, or 10 with Shift). */
  private nudgeStep(ev: KeyboardEvent): number {
    return ev.shiftKey ? LARGE_NUDGE : SMALL_NUDGE;
  }

  /**
   * Move the selected shapes by a keyboard delta and commit it, through the very
   * same {@link Drag} a pointer move runs — so a nudge docks its edges, carries a
   * positioned external label along and writes `dc:Bounds` exactly as dragging does,
   * rather than being a second, subtly different way to move a shape. Returns whether
   * anything moved.
   */
  private nudgeSelection(dx: number, dy: number): boolean {
    const drag = this.drag;
    if (!drag || drag.isActive()) return false;
    const nodes = this.movableSelection();
    if (nodes.length === 0 || !drag.startMove(nodes, { x: 0, y: 0 })) return false;
    drag.end({ x: dx, y: dy });
    return true;
  }

  /** Open the inline label editor on a single selected element (the `e` key). */
  private editSelection(): boolean {
    const elements = this.selection.get();
    if (elements.length !== 1) return false;
    return this.labelEditing.activate(elements[0]);
  }

  /** Select every element in the scene (`Ctrl+A`). */
  private selectAll(): boolean {
    const scene = this.scene;
    if (!scene) return false;
    const all: SceneElement[] = [];
    for (const element of scene.elementsById.values()) {
      if (element.kind === 'node' || element.kind === 'edge') all.push(element);
    }
    if (all.length === 0) return false;
    this.selection.select(all);
    return true;
  }

  /**
   * Remember the selection as the clipboard (`Ctrl+C`, and the first half of
   * `Ctrl+X`). Pasting is deliberately absent: the reference editor has no working
   * paste either (parity spec §9 records `Ctrl+V` producing no element), so the
   * clipboard is kept — and readable through {@link Canvas.getClipboard} — without
   * inventing a behaviour the target does not have.
   */
  private copySelection(): boolean {
    const elements = this.selection.get();
    if (elements.length === 0) return false;
    this.clipboard = elements;
    return true;
  }

  /** The elements last copied or cut, in selection order (a copy). */
  getClipboard(): SceneElement[] {
    return this.clipboard.slice();
  }

  /** Zoom in one step about the viewport centre (`Ctrl+=`). */
  zoomIn(): number {
    return this.viewport.zoom(this.viewport.getViewbox().scale * ZOOM_STEP);
  }

  /** Zoom out one step about the viewport centre (`Ctrl+-`). */
  zoomOut(): number {
    return this.viewport.zoom(this.viewport.getViewbox().scale / ZOOM_STEP);
  }

  /** Escape abandons an in-flight drag without writing anything back. */
  private handleKeyDown(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' || !this.gesture) return;
    this.drag?.cancel();
    this.create.cancel();
    this.connect.cancel();
    this.endGesture();
    this.clearMarquee();
    this.setLassoArmed(false);
  }

  /** Drop the gesture state, its drag feedback, and its document-level listeners. */
  private endGesture(): void {
    this.gesture = undefined;
    this.endMovePreview();
    this.hideSnapLines();
    this.snapContext = undefined;
    this.panFrom = undefined;
    this.root.classList.remove('sf-drag-active');
    this.root.classList.remove('sf-panning');
    const doc = this.root.ownerDocument ?? ownerDocument();
    doc.removeEventListener('pointermove', this.onMove);
    doc.removeEventListener('pointerup', this.onUp);
    doc.removeEventListener('keydown', this.onKeyDown);
  }

  /**
   * The lasso rectangle. `sf-dragging-active-lasso` goes on the root for as long as
   * it is being dragged, which is what drops every enclosed element's outline to the
   * secondary blue — the same class, and the same effect, as in diagram-js.
   */
  private drawMarquee(a: Point, b: Point): void {
    const rect = normalizeRect({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
    if (!this.marqueeRect) {
      this.marqueeRect = create('rect', { class: 'sf-lasso-overlay' }) as SVGRectElement;
      append(this.layers.getLayer('overlays'), this.marqueeRect);
      this.root.classList.add('sf-dragging-active-lasso');
    }
    this.marqueeRect.setAttribute('x', String(rect.x));
    this.marqueeRect.setAttribute('y', String(rect.y));
    this.marqueeRect.setAttribute('width', String(rect.width));
    this.marqueeRect.setAttribute('height', String(rect.height));
  }

  private clearMarquee(): void {
    remove(this.marqueeRect);
    this.marqueeRect = undefined;
    this.root.classList.remove('sf-dragging-active-lasso');
    // An abandoned lasso (Escape, or a release that selects nothing) leaves no marks.
    this.selection.clearPreview();
  }

  /**
   * Track what the pointer is over, for the ONE hover state that renders: a
   * connection showing its bendpoints. A shape is deliberately left alone — see the
   * `pointermove` binding in the constructor. Skipped outright while a gesture is
   * live, so a drag never has handles blinking in and out under it.
   */
  private handleHover(ev: MouseEvent): void {
    if (!this.scene || this.gesture) return;
    // `elementAt`, not `hitTest`: over a connection's CAPTION the element under the
    // pointer is the label, which is a shape — so the bendpoints stay down, as they
    // do in bpmn-js where the label is its own element.
    const hit = this.elementAt(this.eventPoint(ev));
    this.selection.setHovered(hit && hit.kind === 'edge' ? hit : undefined);
  }

  /** Serialize the live canvas SVG to a string (design §4 `saveSVG`). */
  toSVG(): string {
    const doc = ownerDocument();
    // A copy, not the live root: an exported diagram is the drawing, never the
    // editor. The focus hook, the editor state classes, and everything the chrome is
    // currently painting come off — the handle/bendpoint/lasso layers wholesale, and
    // the per-element selection outlines (which live INSIDE the element graphics,
    // where a layer sweep would not reach them) one by one.
    const copy = this.root.cloneNode(true) as SVGSVGElement;
    copy.removeAttribute('tabindex');
    copy.classList.remove(
      'sf-multi-select',
      'sf-dragging-active-lasso',
      'sf-drag-active',
      'sf-new-parent',
    );
    for (const stray of Array.from(copy.querySelectorAll('[data-layer="selection"]'))) {
      stray.parentNode?.removeChild(stray);
    }
    const overlays = copy.querySelector('[data-layer="overlays"]');
    while (overlays?.firstChild) overlays.removeChild(overlays.firstChild);
    for (const stray of Array.from(copy.querySelectorAll(`.${OUTLINE_CLASS}`))) {
      stray.parentNode?.removeChild(stray);
    }
    const view = (doc.defaultView ?? (typeof window !== 'undefined' ? window : undefined)) as
      | (Window & typeof globalThis)
      | undefined;
    if (view && typeof view.XMLSerializer === 'function') {
      return new view.XMLSerializer().serializeToString(copy);
    }
    // Fallback for a DOM without XMLSerializer.
    return copy.outerHTML ?? '';
  }
}
