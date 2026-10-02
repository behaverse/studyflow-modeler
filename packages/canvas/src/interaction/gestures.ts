/**
 * The pointer loop: one `pointerdown` decides an intent (pan, marquee, move,
 * resize, waypoint, reconnect, create, connect), `pointermove` feeds it, and
 * `pointerup` commits. Also the wheel, touch pinch, double click, hover, the
 * canvas-scoped keyboard shortcuts, and copy, cut and paste. The camera moves in
 * `pan.ts`, the rubber band is `marquee.ts`, and alignment `snapLines.ts`.
 */

import type { Canvas } from '@canvas/Canvas.ts';
import type { Drag, GridAxes, Movable } from '@canvas/study/drag.ts';
import type { HitOptions } from '@canvas/study/hit.ts';
import type { LabelEditing } from '@canvas/interaction/labelEditing.ts';
import { Marquee } from '@canvas/interaction/marquee.ts';
import { Pan } from '@canvas/interaction/pan.ts';
import type { HandleHit, Selection, WaypointHit } from '@canvas/interaction/selection.ts';
import { RESIZING_MARKER } from '@canvas/interaction/selection.ts';
import { SnapLines } from '@canvas/interaction/snapLines.ts';
import type { Connect, ConnectionEnd } from '@canvas/interaction/connect.ts';
import type { Create } from '@canvas/interaction/create.ts';
import type { CreatePrototype, NewElement } from '@canvas/study/prototype.ts';
import type { Rules } from '@canvas/study/rules.ts';
import type { Point, Scene, SceneEdge, SceneElement, SceneNode } from '@canvas/study/scene.ts';
import type { Viewport } from '@canvas/view/viewport.ts';
import { Keys } from '@canvas/interaction/keys.ts';
import { isExpandable } from '@core/document/outline.ts';
import { TOP_STRIP } from '@canvas/render/labels.ts';
import { distanceToSegment } from '@canvas/study/edit.ts';

const DRAG_THRESHOLD_PX = 3;
const EDGE_BODY_TOLERANCE = 5;
const CLIPBOARD_EVENTS = ['copy', 'cut', 'paste'] as const;

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

/** What the gestures need of the canvas beyond its public API: the tools they drive and the edits a key or a click makes. */
export interface GestureTools {
  create: Create;
  connect: Connect;
  /** The move, resize and waypoint drags; none before an import. */
  drag(): Drag | undefined;
  overlays: SVGGElement;
  /** The selected shapes and captions a move carries. */
  movableSelection(): Movable[];
  /** Where a create started without a pointer lands. */
  viewportCentre(): Point;
  /** A shape a create just landed: selected, and (for a task-like shape) named. */
  placed(node: SceneNode): void;
  /** Move one waypoint and commit it. */
  /** Commit an end dropped clear of every shape: the route the reconnect ghost drew. */
  moveEnd(edge: SceneEdge, end: 'source' | 'target', point: Point): void;
  /** Move the selection by `(dx, dy)` as one edit; `false` when nothing moved. */
  nudgeSelection(dx: number, dy: number): boolean;
  /** The container the view is drilled into, whose contents a marquee and snapping see. */
  scope(): SceneNode | undefined;
  /** Ask the host for the append menu on these selected ids (the `a` key). */
  appendMenu(ids: string[]): void;
  /** The selected elements and their chrome. */
  selection: Selection;
  /** The scene the view draws: another one after a load, an undo or a redo. */
  scene(): Scene;
  /** What may connect, contain or resize what. */
  rules: Rules;
  /** The camera: pan, zoom, and screen to diagram and back. */
  viewport: Viewport;
  /** A gesture began, or ended. */
  gesture(active: boolean): void;
  /** Whether a person may edit through this view: otherwise a press selects and pans, and no key edits. */
  editable(): boolean;
  /** The view's root, where presses land and its gesture classes go. */
  svg: SVGSVGElement;
  labelEditing: LabelEditing;
  /** What the view shows at a point, in diagram coordinates. */
  hitTest(point: Point, options?: HitOptions): SceneElement | undefined;
}

export class Gestures {
  private readonly canvas: Canvas;
  private readonly tools: GestureTools;
  private gesture?: Gesture;
  private readonly pan: Pan;
  private readonly marquee: Marquee;
  private readonly snapLines: SnapLines;
  private dropTargetIds: string[] = [];
  private resizingId?: string;

  private readonly onDown = (ev: Event) => this.handlePointerDown(ev as PointerEvent);
  private readonly onMove = (ev: Event) => this.handlePointerMove(ev as PointerEvent);
  private readonly onUp = (ev: Event) => this.handlePointerUp(ev as PointerEvent);
  private readonly onCancel = () => this.handlePointerCancel();
  private readonly onKeyDown = (ev: Event) => this.handleKeyDown(ev as KeyboardEvent);
  private readonly onShortcut = (ev: Event) => this.keys.shortcut(ev as KeyboardEvent);
  private readonly onDblClick = (ev: Event) => this.handleDoubleClick(ev as MouseEvent);
  private readonly onHover = (ev: Event) => this.handleHover(ev as MouseEvent);
  private readonly onLeave = () => { this.pointer = undefined; };
  private readonly onClipboard = (ev: Event) => this.keys.clipboard(ev as ClipboardEvent, this.pointer);
  /** Where the pointer last was over the view, on screen: where a paste lands. */
  private pointer?: Point;
  private readonly onWheel = (ev: Event) => this.handleWheel(ev as WheelEvent);

  private readonly keys: Keys;

  constructor(canvas: Canvas, tools: GestureTools) {
    this.canvas = canvas;
    this.tools = tools;
    this.keys = new Keys(canvas, tools);
    this.pan = new Pan(tools.svg, tools.viewport, () => canvas.getContainer());
    this.marquee = new Marquee(tools.overlays, tools.selection);
    this.snapLines = new SnapLines(tools.overlays, tools.viewport);
    const root = this.tools.svg;
    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('dblclick', this.onDblClick);
    root.addEventListener('pointermove', this.onHover);
    root.addEventListener('pointerleave', this.onLeave);
    root.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.getContainer().addEventListener('keydown', this.onShortcut);
    for (const type of CLIPBOARD_EVENTS) canvas.getContainer().addEventListener(type, this.onClipboard);
  }

  destroy(): void {
    this.cancel();
    const root = this.tools.svg;
    root.removeEventListener('pointerdown', this.onDown);
    root.removeEventListener('dblclick', this.onDblClick);
    root.removeEventListener('pointermove', this.onHover);
    root.removeEventListener('pointerleave', this.onLeave);
    root.removeEventListener('wheel', this.onWheel);
    this.canvas.getContainer().removeEventListener('keydown', this.onShortcut);
    for (const type of CLIPBOARD_EVENTS) this.canvas.getContainer().removeEventListener(type, this.onClipboard);
  }

  isActive(): boolean {
    return !!this.gesture;
  }

  /** A palette create may begin outside the canvas, so it installs the document listeners itself. */
  startCreate(event: MouseEvent | undefined, what: NewElement, prototype: CreatePrototype): boolean {
    const point = event ? this.eventPoint(event) : this.tools.viewportCentre();
    if (!this.tools.create.start(what, prototype, point)) return false;
    this.tools.svg.classList.add('sf-drag-active');
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
    if (!this.tools.connect.start(source, point)) return false;
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
    this.tools.drag()?.cancel();
    this.tools.create.cancel();
    this.tools.connect.cancel();
    this.endGesture();
    this.marquee.clear();
  }

  private eventPoint(ev: MouseEvent): Point {
    return this.tools.viewport.toDiagram({ x: ev.clientX, y: ev.clientY });
  }

  private listen(): void {
    const doc = this.tools.svg.ownerDocument;
    doc.addEventListener('pointermove', this.onMove);
    doc.addEventListener('pointerup', this.onUp);
    doc.addEventListener('pointercancel', this.onCancel);
    doc.addEventListener('keydown', this.onKeyDown);
  }

  private markGesture(intent: Intent | undefined): void {
    this.tools.gesture(intent !== undefined);
  }

  // --- pointer down -------------------------------------------------------------

  private handlePointerDown(ev: PointerEvent): void {
    const canvas = this.canvas;
    const scene = this.tools.scene();
    if (!scene) return;
    if (typeof ev.button === 'number' && ev.button !== 0) return;
    if (ev.pointerType === 'touch') {
      const touch = this.pan.touchDown(ev);
      if (touch === 'ignored') return;
      if (touch === 'pinch') {
        this.cancel();
        this.pan.startPinch();
        this.listen();
        return;
      }
    }
    const g = this.gesture;
    // An armed create or connect: this press is where it lands.
    if (g && (g.intent === 'create' || g.intent === 'connect')) {
      const drop = this.eventPoint(ev);
      g.downScreen = { x: ev.clientX, y: ev.clientY };
      g.downDiagram = drop;
      if (g.intent === 'create') this.tools.create.update(drop);
      else this.tools.connect.update(drop);
      return;
    }
    canvas.focus();
    canvas.clearAppendPreview();
    const selection = this.tools.selection;
    const pt = this.eventPoint(ev);

    const editable = this.tools.editable();
    const handle = editable ? selection.handleAt(pt) : undefined;
    // A hovered connection shows its bendpoints too, so they are looked for before the hover goes; grabbing one selects it.
    let waypoint = handle || !editable ? undefined : selection.waypointAt(pt);
    selection.setHovered(undefined);
    if (waypoint && !selection.isSelected(waypoint.edge)) selection.select(waypoint.edge);
    let intent: Intent = ev.shiftKey ? 'marquee' : 'pan';
    let collapseTo: SceneElement | undefined;
    if (handle) intent = 'resize';
    else if (waypoint) intent = endpointOf(waypoint.edge, waypoint.index) ? 'reconnect' : 'waypoint';
    else {
      const hit = this.tools.hitTest(pt);
      if (hit) {
        if (ev.shiftKey) selection.toggle(hit);
        else if (!selection.isSelected(hit)) selection.select(hit);
        if (!ev.shiftKey && selection.isSelected(hit) && selection.get().length > 1) collapseTo = hit;
        intent = editable && selection.isSelected(hit) ? 'move' : 'none';
        // A press on a selected connection's body drags a new joint out of it.
        if (editable && hit.kind === 'edge' && selection.isSelected(hit) && selection.get().length === 1) {
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

  // --- pointer move -------------------------------------------------------------

  private handlePointerMove(ev: PointerEvent): void {
    if (this.pan.touchMove(ev)) return;
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
      this.marquee.draw(g.downDiagram, pt, this.tools.scene(), this.tools.scope(), g.shift);
      return;
    }
    if (this.startDrag(g)) {
      g.dragging = true;
      this.markGesture(g.intent);
      this.updateGesture(g, pt);
    }
  }

  private updateGesture(g: Gesture, point: Point): void {
    if (g.intent === 'create') this.tools.create.update(point);
    else if (g.intent === 'connect' || g.intent === 'reconnect') this.tools.connect.update(point);
    else {
      const snapped = this.snapGesture(g, point);
      this.tools.drag()?.update(snapped.point, snapped.grid);
      if (g.intent === 'move') this.trackMoveDropTarget(point);
    }
  }

  private updatePan(g: Gesture, ev: MouseEvent): void {
    if (!g.dragging) {
      if (Math.hypot(ev.clientX - g.downScreen.x, ev.clientY - g.downScreen.y) < DRAG_THRESHOLD_PX) return;
      g.dragging = true;
      this.pan.start(g.downScreen);
    }
    this.pan.to({ x: ev.clientX, y: ev.clientY });
  }

  private startDrag(g: Gesture): boolean {
    const started = this.beginDrag(g);
    if (started) this.tools.svg.classList.add('sf-drag-active');
    return started;
  }

  private beginDrag(g: Gesture): boolean {
    const drag = this.tools.drag();
    if (!drag) return false;
    const selection = this.tools.selection;
    if (g.intent === 'resize' && g.handle) {
      const target = g.handle.target;
      if (target.kind === 'node' && !this.tools.rules.canResize(target)) return false;
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
      return !!end && this.tools.connect.startReconnect(g.waypoint.edge, end, g.downDiagram);
    }
    if (g.intent === 'move') {
      const movable = this.tools.movableSelection();
      if (!drag.startMove(movable, g.downDiagram)) return false;
      this.beginSnapping(g, movable);
      return true;
    }
    return false;
  }

  // --- drop targets (a move into or out of a container) ---------------------------

  private trackMoveDropTarget(point: Point): void {
    const drop = this.tools.drag()?.dropAt(point);
    if (!drop) return;
    const show = !drop.allowed || drop.rehomed.length > 0;
    this.markDropTarget(show ? drop.over : undefined, show && drop.allowed);
  }

  /** Tint the element a gesture hovers: accepting or refusing the drop. */
  markDropTarget(target: SceneElement | undefined, allowed: boolean): void {
    const selection = this.tools.selection;
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
    this.snapLines.end();
    const scene = this.tools.scene();
    if (!scene) return;
    const scope = this.tools.scope();
    if (g.intent === 'move' && moving) this.snapLines.beginMove(scene, scope, moving);
    else if (g.intent === 'resize' && g.handle) {
      const { target, handle } = g.handle;
      this.snapLines.beginPoint(scene, scope, {
        x: handle.includes('w') ? target.x : target.x + target.width,
        y: handle.includes('n') ? target.y : target.y + target.height,
      }, new Set([target.id]));
    } else if (g.intent === 'waypoint' && g.waypoint) {
      const p = g.waypoint.insert ? g.downDiagram : g.waypoint.edge.waypoints[g.waypoint.index];
      if (p) this.snapLines.beginPoint(scene, scope, p);
    }
  }

  /** Alignment first (with guides), then whatever axis it left alone is the grid's. */
  private snapGesture(g: Gesture, point: Point): { point: Point; grid: GridAxes } {
    return this.tools.drag()?.isActive() ? this.snapLines.snap(g.downDiagram, point) : this.snapLines.unsnapped(point);
  }

  // --- pointer up ------------------------------------------------------------------

  private handlePointerUp(ev: PointerEvent): void {
    const touch = this.pan.touchUp(ev);
    if (touch) {
      if (touch === 'pinched') this.endGesture();
      return;
    }
    const g = this.gesture;
    if (g?.intent === 'connect' && g.sticky) {
      g.sticky = false;
      if (Math.hypot(ev.clientX - g.downScreen.x, ev.clientY - g.downScreen.y) < DRAG_THRESHOLD_PX) return;
    }
    const scene = this.tools.scene();
    const snapped = g && scene ? this.snapGesture(g, this.eventPoint(ev)) : undefined;
    this.endGesture();
    if (!g || !scene || !snapped) {
      this.marquee.clear();
      return;
    }
    const pt = snapped.point;
    const selection = this.tools.selection;
    if (g.dragging && g.intent === 'pan') {
      // The viewbox already moved.
    } else if (g.dragging) {
      if (g.intent === 'create') {
        const node = this.tools.create.end(pt);
        if (node) this.tools.placed(node);
      } else if (g.intent === 'connect' || g.intent === 'reconnect') {
        const kind = this.tools.connect.getKind();
        const edge = this.tools.connect.end(pt);
        if (edge) selection.select(edge);
        else if (kind === 'reconnect' && g.waypoint) {
          // Dropped clear of every shape: a free endpoint move. Dropped on a refused shape: nothing.
          const over = this.tools.hitTest(pt);
          const end = endpointOf(g.waypoint.edge, g.waypoint.index);
          if (end && (!over || over.kind === 'edge')) this.tools.moveEnd(g.waypoint.edge, end, pt);
        }
      } else {
        const drag = this.tools.drag();
        if (drag?.getKind() === 'move') drag.drop(pt, snapped.grid);
        else drag?.end(pt, snapped.grid);
      }
    } else if (g.marquee) {
      this.marquee.select(g.downDiagram, pt, scene, this.tools.scope(), g.shift);
    } else if ((g.intent === 'marquee' || g.intent === 'pan') && !g.shift) {
      selection.clear();
    } else if (g.collapseTo && Math.hypot(ev.clientX - g.downScreen.x, ev.clientY - g.downScreen.y) < DRAG_THRESHOLD_PX) {
      selection.select(g.collapseTo);
    }
    this.marquee.clear();
  }

  private endGesture(): void {
    this.gesture = undefined;
    this.pan.end();
    const selection = this.tools.selection;
    if (this.resizingId) {
      selection.removeMarker(this.resizingId, RESIZING_MARKER);
      this.resizingId = undefined;
    }
    this.markDropTarget(undefined, false);
    this.snapLines.end();
    this.markGesture(undefined);
    const root = this.tools.svg;
    root.classList.remove('sf-drag-active');
    const doc = root.ownerDocument;
    doc.removeEventListener('pointermove', this.onMove);
    doc.removeEventListener('pointerup', this.onUp);
    doc.removeEventListener('pointercancel', this.onCancel);
    doc.removeEventListener('keydown', this.onKeyDown);
  }

  private handlePointerCancel(): void {
    this.pan.touchCancel();
    this.cancel();
  }

  private handleKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && this.gesture) this.cancel();
  }

  // --- double click, hover, wheel ----------------------------------------------------

  /** Rename, or toggle an expandable container unless the press is on its caption strip. */
  private handleDoubleClick(ev: MouseEvent): void {
    const canvas = this.canvas;
    if (!this.tools.scene()) return;
    const pt = this.eventPoint(ev);
    const element = this.tools.hitTest(pt);
    if (!element) return;
    const selected = this.tools.selection.get();
    if (selected.length !== 1 || selected[0]?.id !== element.id) this.tools.selection.select(element);
    if (!this.tools.editable()) return;
    if (element.kind === 'node' && isExpandable(element.type)) {
      const onCaption = element.isExpanded === true && pt.y - element.y <= TOP_STRIP;
      if (!onCaption) {
        if (element.isExpanded === false) canvas.study.expand({ id: element.id });
        else canvas.study.collapse({ id: element.id });
        return;
      }
    }
    this.tools.labelEditing.activate(element, { at: pt });
  }

  private handleHover(ev: MouseEvent): void {
    this.pointer = { x: ev.clientX, y: ev.clientY };
    if (!this.tools.scene() || this.gesture || this.pan.pinching) return;
    const hit = this.tools.hitTest(this.eventPoint(ev));
    this.tools.selection.setHovered(hit && hit.kind === 'edge' ? hit : undefined);
  }

  private handleWheel(ev: WheelEvent): void {
    if (!this.tools.scene()) return;
    ev.preventDefault?.();
    this.pan.wheel(ev, this.eventPoint(ev));
  }
}
