/**
 * The pointer loop: one `pointerdown` decides an intent (pan, marquee, move,
 * resize, waypoint, reconnect, create, connect), `pointermove` feeds it, and
 * `pointerup` commits. Also the wheel, touch pinch, double click, hover and the
 * canvas-scoped keyboard shortcuts.
 */

import type { Canvas } from '@canvas/Canvas.ts';
import type { GridAxes, Movable } from '@canvas/interaction/drag.ts';
import { nodesIntersecting, normalizeRect } from '@canvas/interaction/hit.ts';
import type { HandleHit, WaypointHit } from '@canvas/interaction/selection.ts';
import { RESIZING_MARKER } from '@canvas/interaction/selection.ts';
import { collectSnapTargets, snapMove, snapPoint, type SnapTargets } from '@canvas/interaction/snapping.ts';
import type { ConnectionEnd } from '@canvas/interaction/connect.ts';
import type { CreatePrototype } from '@canvas/interaction/create.ts';
import type { Bounds, Point, SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import { isExpandable } from '@canvas/model/tree.ts';
import { TOP_STRIP } from '@canvas/render/labels.ts';
import { append, create, ownerDocument, remove } from '@canvas/render/svg.ts';
import { distanceToSegment } from '@canvas/routing/edit.ts';

const DRAG_THRESHOLD_PX = 3;
const NUDGE = 1;
const LARGE_NUDGE = 10;
const ZOOM_STEP = 1.25;
const WHEEL_ZOOM = 0.002;
const EDGE_BODY_TOLERANCE = 5;

type Intent = 'pan' | 'marquee' | 'move' | 'resize' | 'waypoint' | 'reconnect' | 'create' | 'connect' | 'none';

interface Gesture {
  downScreen: Point;
  downDiagram: Point;
  shift: boolean;
  intent: Intent;
  marquee: boolean;
  dragging: boolean;
  /** A context-pad connect released without moving stays armed until the next click. */
  sticky?: boolean;
  handle?: HandleHit;
  waypoint?: WaypointHit;
  /** A press on one member of a multi-selection collapses to it if the gesture ends as a click. */
  collapseTo?: SceneElement;
}

interface SnapContext {
  targets: SnapTargets;
  bounds?: Bounds;
  point?: Point;
}

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function endpointOf(edge: SceneEdge, index: number): ConnectionEnd | undefined {
  if (index === 0) return 'source';
  if (index === edge.waypoints.length - 1) return 'target';
  return undefined;
}

/** The segment of `waypoints` under `point`, as the index of its first joint. */
function segmentAt(waypoints: readonly Point[], point: Point): number | undefined {
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    if (distanceToSegment(waypoints[i], waypoints[i + 1], point) <= EDGE_BODY_TOLERANCE) return i;
  }
  return undefined;
}

export class Gestures {
  private readonly canvas: Canvas;
  private gesture?: Gesture;
  private marqueeRect?: SVGRectElement;
  private snapLines?: SVGGElement;
  private snapContext?: SnapContext;
  private panFrom?: Point;
  private touches = new Map<number, Point>();
  private pinch?: { prevMid: Point; prevDist: number };
  private dropTargetIds: string[] = [];
  private resizingId?: string;

  private readonly onDown = (ev: Event) => this.handlePointerDown(ev as PointerEvent);
  private readonly onMove = (ev: Event) => this.handlePointerMove(ev as PointerEvent);
  private readonly onUp = (ev: Event) => this.handlePointerUp(ev as PointerEvent);
  private readonly onCancel = () => this.handlePointerCancel();
  private readonly onKeyDown = (ev: Event) => this.handleKeyDown(ev as KeyboardEvent);
  private readonly onShortcut = (ev: Event) => this.handleShortcut(ev as KeyboardEvent);
  private readonly onDblClick = (ev: Event) => this.handleDoubleClick(ev as MouseEvent);
  private readonly onHover = (ev: Event) => this.handleHover(ev as MouseEvent);
  private readonly onWheel = (ev: Event) => this.handleWheel(ev as WheelEvent);

  constructor(canvas: Canvas) {
    this.canvas = canvas;
    const root = canvas.getSvg();
    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('dblclick', this.onDblClick);
    root.addEventListener('pointermove', this.onHover);
    root.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.getContainer().addEventListener('keydown', this.onShortcut);
  }

  destroy(): void {
    this.cancel();
    const root = this.canvas.getSvg();
    root.removeEventListener('pointerdown', this.onDown);
    root.removeEventListener('dblclick', this.onDblClick);
    root.removeEventListener('pointermove', this.onHover);
    root.removeEventListener('wheel', this.onWheel);
    this.canvas.getContainer().removeEventListener('keydown', this.onShortcut);
  }

  isActive(): boolean {
    return !!this.gesture;
  }

  /** A palette create may begin outside the canvas, so it installs the document listeners itself. */
  startCreate(event: MouseEvent | undefined, prototype: CreatePrototype): boolean {
    const point = event ? this.eventPoint(event) : this.canvas.viewportCentre();
    if (!this.canvas.create.start(prototype, point)) return false;
    this.canvas.getSvg().classList.add('sf-drag-active');
    this.markGesture('create');
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

  startConnect(source: SceneNode, event?: MouseEvent): boolean {
    const point = event ? this.eventPoint(event) : { x: source.x + source.width, y: source.y + source.height / 2 };
    if (!this.canvas.connect.start(source, point)) return false;
    this.markGesture('connect');
    this.gesture = {
      downScreen: event ? { x: event.clientX, y: event.clientY } : { x: 0, y: 0 },
      downDiagram: point,
      shift: false,
      intent: 'connect',
      marquee: false,
      dragging: true,
      sticky: true,
    };
    this.listen();
    return true;
  }

  /** Abandon whatever is in flight, writing nothing. */
  cancel(): void {
    this.canvas.getDrag()?.cancel();
    this.canvas.create.cancel();
    this.canvas.connect.cancel();
    this.endGesture();
    this.clearMarquee();
  }

  private eventPoint(ev: MouseEvent): Point {
    return this.canvas.getViewport().toDiagram({ x: ev.clientX, y: ev.clientY });
  }

  private listen(): void {
    const doc = this.canvas.getSvg().ownerDocument ?? ownerDocument();
    doc.addEventListener('pointermove', this.onMove);
    doc.addEventListener('pointerup', this.onUp);
    doc.addEventListener('pointercancel', this.onCancel);
    doc.addEventListener('keydown', this.onKeyDown);
  }

  private markGesture(intent: Intent | undefined): void {
    const root = this.canvas.getSvg();
    if (intent) root.setAttribute('data-gesture', intent);
    else root.removeAttribute('data-gesture');
  }

  // --- pointer down -------------------------------------------------------------

  private handlePointerDown(ev: PointerEvent): void {
    const canvas = this.canvas;
    const scene = canvas.getScene();
    if (!scene) return;
    if (typeof ev.button === 'number' && ev.button !== 0) return;
    if (ev.pointerType === 'touch') {
      if (this.touches.size >= 2) return;
      this.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.touches.size === 2) {
        this.startPinch();
        return;
      }
    }
    const g = this.gesture;
    // An armed create or connect: this press is where it lands.
    if (g && (g.intent === 'create' || g.intent === 'connect')) {
      const drop = this.eventPoint(ev);
      g.downScreen = { x: ev.clientX, y: ev.clientY };
      g.downDiagram = drop;
      if (g.intent === 'create') canvas.create.update(drop);
      else canvas.connect.update(drop);
      return;
    }
    canvas.focus();
    canvas.clearAppendPreview();
    const selection = canvas.getSelection();
    selection.setHovered(undefined);
    const pt = this.eventPoint(ev);

    const handle = selection.handleAt(pt);
    let waypoint = handle ? undefined : selection.waypointAt(pt);
    let intent: Intent = ev.shiftKey ? 'marquee' : 'pan';
    let collapseTo: SceneElement | undefined;
    if (handle) intent = 'resize';
    else if (waypoint) intent = endpointOf(waypoint.edge, waypoint.index) ? 'reconnect' : 'waypoint';
    else {
      const hit = canvas.hitTest(pt);
      if (hit) {
        if (ev.shiftKey) selection.toggle(hit);
        else if (!selection.isSelected(hit)) selection.select(hit);
        if (!ev.shiftKey && selection.isSelected(hit) && selection.get().length > 1) collapseTo = hit;
        intent = selection.isSelected(hit) ? 'move' : 'none';
        // A press on a selected connection's body drags a new joint out of it.
        if (hit.kind === 'edge' && selection.isSelected(hit) && selection.get().length === 1) {
          const index = segmentAt(hit.waypoints, pt);
          if (index !== undefined) {
            waypoint = { edge: hit, index: index + 1, insert: true };
            intent = 'waypoint';
          }
        }
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

  private startPinch(): void {
    this.cancel();
    const [a, b] = [...this.touches.values()];
    this.pinch = { prevMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, prevDist: Math.hypot(b.x - a.x, b.y - a.y) };
    this.listen();
  }

  private updatePinch(): void {
    const p = this.pinch;
    if (!p || this.touches.size < 2) return;
    const [a, b] = [...this.touches.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const viewport = this.canvas.getViewport();
    if (p.prevDist > 0 && dist > 0) {
      const center = viewport.toDiagram(mid);
      viewport.zoom(viewport.getViewbox().scale * (dist / p.prevDist), center);
    }
    this.panBy(mid.x - p.prevMid.x, mid.y - p.prevMid.y);
    this.pinch = { prevMid: mid, prevDist: dist };
  }

  // --- pointer move -------------------------------------------------------------

  private handlePointerMove(ev: PointerEvent): void {
    if (ev.pointerType === 'touch' && this.touches.has(ev.pointerId)) {
      this.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    }
    if (this.pinch) {
      this.updatePinch();
      return;
    }
    const g = this.gesture;
    if (!g) return;
    if (g.intent === 'pan') {
      this.updatePan(g, ev);
      return;
    }
    const pt = this.eventPoint(ev);
    if (g.dragging) {
      this.updateGesture(g, pt);
      return;
    }
    if (!g.marquee && Math.hypot(ev.clientX - g.downScreen.x, ev.clientY - g.downScreen.y) < DRAG_THRESHOLD_PX) return;
    if (g.intent === 'marquee') {
      g.marquee = true;
      this.drawMarquee(g.downDiagram, pt);
      const scene = this.canvas.getScene();
      if (scene) {
        const rect = normalizeRect({ x: g.downDiagram.x, y: g.downDiagram.y, width: pt.x - g.downDiagram.x, height: pt.y - g.downDiagram.y });
        const enclosed = nodesIntersecting(scene, rect);
        const selection = this.canvas.getSelection();
        selection.previewSelection(g.shift ? [...selection.get(), ...enclosed] : enclosed);
      }
      return;
    }
    if (this.startDrag(g)) {
      g.dragging = true;
      this.markGesture(g.intent);
      this.updateGesture(g, pt);
    }
  }

  private updateGesture(g: Gesture, point: Point): void {
    const canvas = this.canvas;
    if (g.intent === 'create') canvas.create.update(point);
    else if (g.intent === 'connect' || g.intent === 'reconnect') canvas.connect.update(point);
    else {
      const snapped = this.snapGesture(g, point);
      canvas.getDrag()?.update(snapped.point, snapped.grid);
      if (g.intent === 'move') this.trackMoveDropTarget(point);
    }
  }

  private updatePan(g: Gesture, ev: MouseEvent): void {
    if (!g.dragging) {
      if (Math.hypot(ev.clientX - g.downScreen.x, ev.clientY - g.downScreen.y) < DRAG_THRESHOLD_PX) return;
      g.dragging = true;
      this.panFrom = { ...g.downScreen };
      this.canvas.getSvg().classList.add('sf-panning');
    }
    const from = this.panFrom ?? g.downScreen;
    this.panBy(ev.clientX - from.x, ev.clientY - from.y);
    this.panFrom = { x: ev.clientX, y: ev.clientY };
  }

  private panBy(dxScreen: number, dyScreen: number): void {
    const viewport = this.canvas.getViewport();
    const box = viewport.getViewbox();
    const rect = this.canvas.getContainer().getBoundingClientRect();
    viewport.pan(dxScreen * (box.width / (rect.width || box.width)), dyScreen * (box.height / (rect.height || box.height)));
  }

  private startDrag(g: Gesture): boolean {
    const started = this.beginDrag(g);
    if (started) this.canvas.getSvg().classList.add('sf-drag-active');
    return started;
  }

  private beginDrag(g: Gesture): boolean {
    const canvas = this.canvas;
    const drag = canvas.getDrag();
    if (!drag) return false;
    const selection = canvas.getSelection();
    if (g.intent === 'resize' && g.handle) {
      const target = g.handle.target;
      if (target.kind === 'node' && !canvas.getRules().canResize(target)) return false;
      if (!drag.startResize(target, g.handle.handle, g.downDiagram)) return false;
      this.beginSnapping(g);
      selection.addMarker(target.id, RESIZING_MARKER);
      this.resizingId = target.id;
      return true;
    }
    if (g.intent === 'waypoint' && g.waypoint) {
      const { edge, index, insert } = g.waypoint;
      if (!drag.startWaypoint(edge, index, g.downDiagram, insert)) return false;
      this.beginSnapping(g);
      return true;
    }
    if (g.intent === 'reconnect' && g.waypoint) {
      const end = endpointOf(g.waypoint.edge, g.waypoint.index);
      return !!end && canvas.connect.startReconnect(g.waypoint.edge, end, g.downDiagram);
    }
    if (g.intent === 'move') {
      const movable = canvas.movableSelection();
      if (!drag.startMove(movable, g.downDiagram)) return false;
      this.beginSnapping(g, movable);
      return true;
    }
    return false;
  }

  // --- drop targets (a move into or out of a container) ---------------------------

  private trackMoveDropTarget(point: Point): void {
    const target = this.canvas.moveDropTarget(point);
    if (!target) return;
    const show = !target.allowed || this.canvas.reparentable(target.parent).length > 0;
    this.markDropTarget(show ? target.over : undefined, show && target.allowed);
  }

  /** Tint the element a gesture hovers: accepting or refusing the drop. */
  markDropTarget(target: SceneElement | undefined, allowed: boolean): void {
    const selection = this.canvas.getSelection();
    for (const id of this.dropTargetIds) {
      selection.removeMarker(id, 'sf-drop-ok');
      selection.removeMarker(id, 'sf-drop-not-ok');
    }
    this.dropTargetIds = [];
    if (!target) return;
    selection.addMarker(target.id, allowed ? 'sf-drop-ok' : 'sf-drop-not-ok');
    this.dropTargetIds = [target.id];
  }

  // --- alignment snapping ----------------------------------------------------------

  private beginSnapping(g: Gesture, moving?: readonly Movable[]): void {
    this.snapContext = undefined;
    const scene = this.canvas.getScene();
    if (!scene) return;
    if (g.intent === 'move' && moving && moving.length > 0) {
      const lead = moving[0];
      const ids = new Set(moving.map((el) => el.id));
      this.snapContext = {
        targets: collectSnapTargets(scene, ids, 'mid'),
        bounds: { x: lead.x, y: lead.y, width: lead.width, height: lead.height },
      };
      return;
    }
    if (g.intent === 'resize' && g.handle) {
      const target = g.handle.target;
      const handle = g.handle.handle;
      this.snapContext = {
        targets: collectSnapTargets(scene, new Set([target.id]), 'bounds'),
        point: {
          x: handle.includes('w') ? target.x : target.x + target.width,
          y: handle.includes('n') ? target.y : target.y + target.height,
        },
      };
      return;
    }
    if (g.intent === 'waypoint' && g.waypoint) {
      const p = g.waypoint.insert ? g.downDiagram : g.waypoint.edge.waypoints[g.waypoint.index];
      if (!p) return;
      this.snapContext = { targets: collectSnapTargets(scene, new Set<string>(), 'bounds'), point: { x: p.x, y: p.y } };
    }
  }

  /** Alignment first (with guides), then whatever axis it left alone is the grid's. */
  private snapGesture(g: Gesture, point: Point): { point: Point; grid: GridAxes } {
    const ctx = this.snapContext;
    if (!ctx || !this.canvas.getDrag()?.isActive()) {
      this.hideSnapLines();
      return { point, grid: { x: true, y: true } };
    }
    const dx = point.x - g.downDiagram.x;
    const dy = point.y - g.downDiagram.y;
    if (ctx.bounds) {
      const snapped = snapMove(ctx.bounds, dx, dy, ctx.targets);
      this.showSnapLines(snapped.guideX, snapped.guideY);
      return {
        point: { x: g.downDiagram.x + snapped.dx, y: g.downDiagram.y + snapped.dy },
        grid: { x: snapped.guideX === undefined, y: snapped.guideY === undefined },
      };
    }
    if (ctx.point) {
      const moved = { x: ctx.point.x + dx, y: ctx.point.y + dy };
      const snapped = snapPoint(moved, ctx.targets);
      this.showSnapLines(snapped.guideX, snapped.guideY);
      return {
        point: { x: point.x + (snapped.point.x - moved.x), y: point.y + (snapped.point.y - moved.y) },
        grid: { x: snapped.guideX === undefined, y: snapped.guideY === undefined },
      };
    }
    this.hideSnapLines();
    return { point, grid: { x: true, y: true } };
  }

  private showSnapLines(x?: number, y?: number): void {
    if (x === undefined && y === undefined) {
      this.hideSnapLines();
      return;
    }
    const box = this.canvas.getViewport().getViewbox();
    if (!this.snapLines) {
      this.snapLines = create('g', { class: 'sf-snap-lines' }) as SVGGElement;
      append(this.canvas.getOverlays(), this.snapLines);
    }
    while (this.snapLines.firstChild) this.snapLines.removeChild(this.snapLines.firstChild);
    if (x !== undefined) append(this.snapLines, create('line', { class: 'sf-snap-line', x1: x, y1: box.y, x2: x, y2: box.y + box.height }));
    if (y !== undefined) append(this.snapLines, create('line', { class: 'sf-snap-line', x1: box.x, y1: y, x2: box.x + box.width, y2: y }));
  }

  private hideSnapLines(): void {
    remove(this.snapLines);
    this.snapLines = undefined;
  }

  // --- pointer up ------------------------------------------------------------------

  private handlePointerUp(ev: PointerEvent): void {
    if (ev.pointerType === 'touch') this.touches.delete(ev.pointerId);
    if (this.pinch) {
      if (this.touches.size === 0) {
        this.pinch = undefined;
        this.endGesture();
      }
      return;
    }
    const canvas = this.canvas;
    const g = this.gesture;
    if (g?.intent === 'connect' && g.sticky) {
      g.sticky = false;
      if (Math.hypot(ev.clientX - g.downScreen.x, ev.clientY - g.downScreen.y) < DRAG_THRESHOLD_PX) return;
    }
    const scene = canvas.getScene();
    const snapped = g && scene ? this.snapGesture(g, this.eventPoint(ev)) : undefined;
    this.endGesture();
    if (!g || !scene || !snapped) {
      this.clearMarquee();
      return;
    }
    const pt = snapped.point;
    const selection = canvas.getSelection();
    if (g.dragging && g.intent === 'pan') {
      // The viewbox already moved.
    } else if (g.dragging) {
      if (g.intent === 'create') {
        const node = canvas.create.end(pt);
        if (node) canvas.placed(node);
      } else if (g.intent === 'connect' || g.intent === 'reconnect') {
        const kind = canvas.connect.getKind();
        const edge = canvas.connect.end(pt);
        if (edge) {
          if (kind === 'connect') canvas.mount(edge);
          else canvas.redrawElements([edge]);
          selection.select(edge);
        } else if (kind === 'reconnect' && g.waypoint) {
          // Dropped clear of every shape: a free endpoint move. Dropped on a refused shape: nothing.
          const over = canvas.hitTest(pt);
          if (!over || over.kind === 'edge') canvas.moveWaypoint(g.waypoint.edge, g.waypoint.index, pt);
        }
      } else {
        const drag = canvas.getDrag();
        const target = drag?.getKind() === 'move' ? canvas.moveDropTarget(pt) : undefined;
        if (target && !target.allowed) drag?.cancel();
        else {
          drag?.end(pt, snapped.grid);
          if (target?.allowed) canvas.reparentDropped(target.parent);
        }
      }
    } else if (g.marquee) {
      const rect = normalizeRect({ x: g.downDiagram.x, y: g.downDiagram.y, width: pt.x - g.downDiagram.x, height: pt.y - g.downDiagram.y });
      selection.select(nodesIntersecting(scene, rect), g.shift);
    } else if ((g.intent === 'marquee' || g.intent === 'pan') && !g.shift) {
      selection.clear();
    } else if (g.collapseTo && Math.hypot(ev.clientX - g.downScreen.x, ev.clientY - g.downScreen.y) < DRAG_THRESHOLD_PX) {
      selection.select(g.collapseTo);
    }
    this.clearMarquee();
  }

  private endGesture(): void {
    this.gesture = undefined;
    this.pinch = undefined;
    const selection = this.canvas.getSelection();
    if (this.resizingId) {
      selection.removeMarker(this.resizingId, RESIZING_MARKER);
      this.resizingId = undefined;
    }
    this.markDropTarget(undefined, false);
    this.hideSnapLines();
    this.snapContext = undefined;
    this.panFrom = undefined;
    this.markGesture(undefined);
    const root = this.canvas.getSvg();
    root.classList.remove('sf-drag-active', 'sf-panning');
    const doc = root.ownerDocument ?? ownerDocument();
    doc.removeEventListener('pointermove', this.onMove);
    doc.removeEventListener('pointerup', this.onUp);
    doc.removeEventListener('pointercancel', this.onCancel);
    doc.removeEventListener('keydown', this.onKeyDown);
  }

  private handlePointerCancel(): void {
    this.touches.clear();
    this.cancel();
  }

  private handleKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && this.gesture) this.cancel();
  }

  private drawMarquee(a: Point, b: Point): void {
    const rect = normalizeRect({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
    if (!this.marqueeRect) {
      this.marqueeRect = append(this.canvas.getOverlays(), create('rect', { class: 'sf-marquee' })) as SVGRectElement;
    }
    for (const [name, value] of Object.entries(rect)) this.marqueeRect.setAttribute(name, String(value));
  }

  private clearMarquee(): void {
    remove(this.marqueeRect);
    this.marqueeRect = undefined;
    this.canvas.getSelection().clearPreview();
  }

  // --- double click, hover, wheel ----------------------------------------------------

  /** Rename, or toggle an expandable container unless the press is on its caption strip. */
  private handleDoubleClick(ev: MouseEvent): void {
    const canvas = this.canvas;
    if (!canvas.getScene()) return;
    const pt = this.eventPoint(ev);
    const element = canvas.hitTest(pt);
    if (!element) return;
    canvas.getEventBus().fire('ElementDblClick', { element, originalEvent: ev, point: pt });
    const selected = canvas.getSelection().get();
    if (selected.length !== 1 || selected[0]?.id !== element.id) canvas.getSelection().select(element);
    if (element.kind === 'node' && isExpandable(element.type)) {
      const onCaption = element.isExpanded === true && pt.y - element.y <= TOP_STRIP;
      if (!onCaption) {
        canvas.toggleExpanded(element);
        return;
      }
    }
    canvas.getLabelEditing().activate(element, { at: pt });
  }

  private handleHover(ev: MouseEvent): void {
    const canvas = this.canvas;
    if (!canvas.getScene() || this.gesture || this.pinch) return;
    const hit = canvas.hitTest(this.eventPoint(ev));
    canvas.getSelection().setHovered(hit && hit.kind === 'edge' ? hit : undefined);
  }

  /** Wheel pans; `Ctrl`/`Cmd`+wheel zooms about the cursor. */
  private handleWheel(ev: WheelEvent): void {
    if (!this.canvas.getScene()) return;
    ev.preventDefault?.();
    const lines = ev.deltaMode !== 0 ? 16 : 1;
    const deltaX = (ev.deltaX ?? 0) * lines;
    const deltaY = (ev.deltaY ?? 0) * lines;
    if (ev.ctrlKey || ev.metaKey) {
      const viewport = this.canvas.getViewport();
      viewport.zoom(viewport.getViewbox().scale * Math.exp(-deltaY * WHEEL_ZOOM), this.eventPoint(ev));
      return;
    }
    if (ev.shiftKey) this.panBy(-deltaY, 0);
    else this.panBy(-deltaX, -deltaY);
  }

  // --- keyboard ----------------------------------------------------------------------

  private handleShortcut(ev: KeyboardEvent): void {
    const canvas = this.canvas;
    if (ev.defaultPrevented || canvas.getLabelEditing().isActive() || isTextEntry(ev.target) || ev.altKey) return;
    const mod = ev.ctrlKey || ev.metaKey;
    let handled = false;
    if (mod) {
      switch (ev.key) {
        case 'a': case 'A': handled = canvas.selectAll(); break;
        case '=': case '+': canvas.zoomIn(); handled = true; break;
        case '-': case '_': canvas.zoomOut(); handled = true; break;
        case '0': canvas.getViewport().zoom(1); handled = true; break;
        default: break;
      }
    } else {
      const step = ev.shiftKey ? LARGE_NUDGE : NUDGE;
      switch (ev.key) {
        case 'Delete': case 'Backspace': handled = canvas.deleteSelection().length > 0; break;
        case 'ArrowLeft': handled = canvas.nudgeSelection(-step, 0); break;
        case 'ArrowRight': handled = canvas.nudgeSelection(step, 0); break;
        case 'ArrowUp': handled = canvas.nudgeSelection(0, -step); break;
        case 'ArrowDown': handled = canvas.nudgeSelection(0, step); break;
        case 'e': handled = canvas.editLabel(); break;
        case 'a': {
          const elements = canvas.getSelection().get();
          if (elements.length === 0) break;
          void canvas.getEventBus().send({ type: 'OpenAppendMenu', elements }).catch(() => undefined);
          handled = true;
          break;
        }
        default: break;
      }
    }
    if (handled) ev.preventDefault();
  }
}

export { ZOOM_STEP };
