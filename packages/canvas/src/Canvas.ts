/**
 * `Canvas` — the top-level facade (design §3 `Canvas.ts`, §6 P1). Owns the scene,
 * the SVG root + layer stack, the viewport, and the renderer. For P1 it is
 * read-only: {@link Canvas.importDefinitions} builds a {@link Scene} from a
 * `bpmn:Definitions` moddle tree (with DI) and renders it; there is no interaction,
 * selection, or writeback yet (those arrive in P2/P3, design §6).
 *
 * The SVG DOM is created via {@link svg} helpers, which default to the global
 * `document` (present under the playwright/chromium test DOM) and can be swapped
 * with `setDocument` for a headless harness.
 */

import { EventBus } from '@canvas/events/bus.ts';
import { importDefinitions } from '@canvas/model/import.ts';
import type { ImportOptions } from '@canvas/model/import.ts';
import type { ModdleObject, Point, Scene, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import { hitTest, nodesIntersecting, normalizeRect } from '@canvas/interaction/hit.ts';
import type { HitOptions } from '@canvas/interaction/hit.ts';
import { Selection } from '@canvas/interaction/selection.ts';
import type { HandleHit, WaypointHit } from '@canvas/interaction/selection.ts';
import { Drag } from '@canvas/interaction/drag.ts';
import { LabelEditing } from '@canvas/interaction/labelEditing.ts';
import type { ElementDblClickEvent } from '@canvas/interaction/labelEditing.ts';
import { Writeback } from '@canvas/model/writeback.ts';
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
}

/** Screen-pixel drag threshold separating a click from a marquee or a drag. */
const MARQUEE_THRESHOLD_PX = 3;

/** What a pointer press intends to do once it passes the drag threshold. */
type GestureIntent = 'marquee' | 'move' | 'resize' | 'waypoint' | 'none';

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

/** Editable-SVG canvas with hit-testing, selection, marquee, and drag/resize (P2+P3). */
export class Canvas {
  private readonly container: HTMLElement;
  private readonly root: SVGSVGElement;
  private readonly layers: Layers;
  private readonly viewport: Viewport;
  private readonly renderer: Renderer;
  private readonly bus: EventBus;
  private readonly selection: Selection;
  private readonly labelEditing: LabelEditing;
  private readonly onWarning?: ImportOptions['onWarning'];
  private readonly gridSize?: number;
  private readonly minNodeSize?: number;
  private snapToGrid: boolean;
  private scene?: Scene;
  private writeback?: Writeback;
  private drag?: Drag;

  private gesture?: GestureState;
  private marqueeRect?: SVGRectElement;
  private readonly onMove = (ev: Event) => this.handlePointerMove(ev as MouseEvent);
  private readonly onUp = (ev: Event) => this.handlePointerUp(ev as MouseEvent);
  private readonly onKeyDown = (ev: Event) => this.handleKeyDown(ev as KeyboardEvent);

  constructor(options: CanvasOptions = {}) {
    const doc = ownerDocument();
    this.container = options.container ?? doc.createElement('div');
    this.onWarning = options.onWarning;
    this.snapToGrid = options.snapToGrid ?? false;
    this.gridSize = options.gridSize;
    this.minNodeSize = options.minNodeSize;

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

    this.root.addEventListener('pointerdown', (ev) => this.handlePointerDown(ev as MouseEvent));
    this.root.addEventListener('dblclick', (ev) => this.handleDoubleClick(ev as MouseEvent));
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
    this.writeback = new Writeback(this.scene, this.bus);
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
    const pt = this.eventPoint(ev);

    // Selection-overlay handles are checked first and never change the selection:
    // they sit on top of everything and belong to an already-selected element.
    const handle = this.selection.handleAt(pt);
    const waypoint = handle ? undefined : this.selection.waypointAt(pt);

    let intent: GestureIntent = 'marquee';
    if (handle) intent = 'resize';
    else if (waypoint) intent = 'waypoint';

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
      this.drag?.update(pt);
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
      this.drag?.update(pt);
    }
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
      this.drag?.end(this.eventPoint(ev));
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
    this.labelEditing.activate(element, { at: pt });
  }

  /** Escape abandons an in-flight drag without writing anything back. */
  private handleKeyDown(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' || !this.gesture) return;
    this.drag?.cancel();
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
