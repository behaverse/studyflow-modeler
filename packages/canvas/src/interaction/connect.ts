/**
 * Connect + reconnect gestures (design §3 `interaction/connect.ts`, §6 P4).
 *
 * Two gestures share one state machine, because they differ only in what the drop
 * writes:
 *
 * - **connect** — drag from a source shape to a target shape. The pair is gated by
 *   `rules.allowed('connection.create')`, which also *names the type to mint*
 *   (`rules/rules.ts` `ConnectionSpec`: sequence flow, message flow, association or
 *   a data association). On an allowed drop the flow's business object
 *   (`sourceRef`/`targetRef`, plus `outgoing`/`incoming` for a sequence flow) AND
 *   its `bpmndi:BPMNEdge` + `di:waypoint` list are minted through
 *   {@link Writeback.addConnection} (design §1 "add edge"), with waypoints from the
 *   orthogonal router, already cropped to both silhouettes (`routing/orthogonal.ts`).
 * - **reconnect** — drag an existing edge's first/last waypoint onto another shape.
 *   Gated by `rules.allowed('connection.reconnect')`, which additionally insists the
 *   connection stays connectable *as its own type*; the drop rewrites the refs and
 *   re-routes ({@link Writeback.reconnect}).
 *
 * Like `interaction/create.ts` this module owns no DOM listeners and mounts no
 * graphics: it is a start/update/end state machine plus a preview polyline, driven
 * by the canvas's single pointer loop.
 */

import type {
  Plane,
  Point,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';
import type { Writeback } from '@canvas/model/writeback.ts';
import { routableEnd, routeFor, type RouteOptions } from '@canvas/routing/orthogonal.ts';
import { cropPoint } from '@canvas/routing/crop.ts';
import { CONNECTION, type ConnectionSpec, type Rules } from '@canvas/rules/rules.ts';
import { markerEndFor, markerStartFor } from '@canvas/render/renderer.ts';
import { previewEdgeAttrs } from '@canvas/render/preview.ts';
import { freeMoveEnd, redockEnd } from '@canvas/interaction/segments.ts';
import { append, attr, create as svgCreate, remove } from '@canvas/render/svg.ts';

/** Which end of an existing connection a reconnect gesture is dragging. */
export type ConnectionEnd = 'source' | 'target';

/** Construction dependencies for {@link Connect}. */
export interface ConnectOptions {
  /** The live scene (the gesture is inert before an import). */
  getScene: () => Scene | undefined;
  /** The writeback the drop commits through. */
  getWriteback: () => Writeback | undefined;
  /** The rule engine gating the connection. */
  rules: Rules;
  /** Topmost element under a diagram point (`Canvas.hitTest`). */
  hitTest: (point: Point) => SceneElement | undefined;
  /** SVG layer the live preview is drawn into (the overlay layer). */
  layer: SVGGElement;
  /** Screen pixels per diagram unit, so the preview stroke stays constant on screen. */
  getScale: () => number;
  /** Router tuning forwarded to `routing/orthogonal.ts` `route`. */
  routeOptions?: RouteOptions;
  /**
   * The plane a new `bpmndi:BPMNEdge` is filed in — the one on screen, which is the
   * root plane until a drill-down moves the cursor (`view/plane.ts`). `undefined`
   * leaves it to {@link Writeback}, which defaults to the root plane.
   */
  getPlane?: () => Plane | undefined;
  /**
   * Tint the shape under the pointer: `allowed` when the drop would mint (or
   * re-dock) a flow there, refused otherwise, and `undefined` for "nothing is
   * hovered". Addendum 4 §2 — `edge-videos/edgemake/frame_02` fills the target
   * light-gray for as long as the drag hangs over it, which is the only thing that
   * tells the user the drop will take before they let go.
   */
  markTarget?: (target: SceneNode | undefined, allowed: boolean) => void;
  /**
   * Grid-snap a diagram point (`Canvas.snapPoint`, and a no-op while snapping is
   * off). Applied to the DROP of a reconnect, which is what decides where along a
   * shape's side the edge lands — every other waypoint gesture snaps
   * (`interaction/drag.ts`), and this one used to take the raw pointer.
   */
  snap?: (point: Point) => Point;
}

interface ConnectState {
  kind: 'connect';
  source: SceneNode;
  /** Hovered target, when the pointer is over one. */
  target?: SceneNode;
  /** The connection the rules would mint for `source → target`. */
  spec?: ConnectionSpec;
  point: Point;
}

interface ReconnectState {
  kind: 'reconnect';
  edge: SceneEdge;
  end: ConnectionEnd;
  /** Hovered candidate endpoint. */
  candidate?: SceneNode;
  allowed: boolean;
  point: Point;
}

type State = ConnectState | ReconnectState;

/** Runs one connect / reconnect gesture and commits it through {@link Writeback}. */
export class Connect {
  private readonly options: ConnectOptions;
  private state?: State;
  private preview?: SVGGElement;

  constructor(options: ConnectOptions) {
    this.options = options;
  }

  /** Whether a gesture is in flight. */
  isActive(): boolean {
    return this.state !== undefined;
  }

  /** The kind of gesture in flight, if any. */
  getKind(): 'connect' | 'reconnect' | undefined {
    return this.state?.kind;
  }

  /** Begin dragging a new connection out of `source`, pointer at `point`. */
  start(source: SceneNode, point: Point): boolean {
    if (!this.options.getScene()) return false;
    this.state = { kind: 'connect', source, point: { ...point } };
    this.update(point);
    return true;
  }

  /**
   * Begin dragging the `end` endpoint of `edge`. Returns `false` when the edge has
   * no waypoints to drag (a dangling import).
   */
  startReconnect(edge: SceneEdge, end: ConnectionEnd, point: Point): boolean {
    if (!this.options.getScene() || edge.waypoints.length < 2) return false;
    this.state = { kind: 'reconnect', edge, end, allowed: false, point: { ...point } };
    this.update(point);
    return true;
  }

  /** Track the pointer: re-ask the rules for the hovered shape and redraw the preview. */
  update(point: Point): void {
    const state = this.state;
    if (!state) return;
    state.point = { ...point };
    const hovered = this.nodeAt(point);

    if (state.kind === 'connect') {
      const spec = hovered ? this.options.rules.canConnect(state.source, hovered) : false;
      state.target = spec ? hovered : undefined;
      state.spec = spec || undefined;
      this.options.markTarget?.(hovered, !!spec);
      this.drawPreview(
        this.connectPreviewPoints(state),
        spec ? 'ok' : hovered ? 'rejected' : 'pending',
        spec ? spec.type : undefined,
      );
      return;
    }

    const verdict = hovered ? this.reconnectVerdict(state.edge, state.end, hovered) : false;
    state.candidate = verdict ? hovered : undefined;
    state.allowed = !!verdict;
    this.options.markTarget?.(hovered, !!verdict);
    this.drawPreview(
      this.reconnectPreviewPoints(state),
      verdict ? 'ok' : hovered ? 'rejected' : 'pending',
      state.edge.type,
    );
  }

  /**
   * Drop at `point`. A connect gesture returns the newly created {@link SceneEdge};
   * a reconnect returns the edge it rewired; a rejected drop writes nothing and
   * returns `undefined`. The gesture ends either way.
   */
  end(point: Point): SceneEdge | undefined {
    const state = this.state;
    if (!state) return undefined;
    this.update(point);
    this.state = undefined;
    this.clearPreview();

    if (state.kind === 'connect') {
      return state.target ? this.connect(state.source, state.target) : undefined;
    }
    if (!state.candidate) return undefined;
    // The drop POINT is carried through: a reconnect docks on the side of the target
    // the user let go over, not on the side the router would have picked.
    return this.reconnect(state.edge, state.end, state.candidate, this.snap(state.point))
      ? state.edge
      : undefined;
  }

  /** Abandon the gesture. Nothing was written. */
  cancel(): void {
    this.state = undefined;
    this.clearPreview();
  }

  /**
   * Create a connection from `source` to `target` without a pointer gesture (the
   * context-pad / append path, and what tests drive). Returns `undefined` when the
   * rules refuse the pair.
   *
   * `source` may be a CONNECTION, for the one pair BPMN allows there and ux-spec §4
   * offers: the association reaching a text annotation appended from a selected
   * sequence flow. It routes from the middle of that flow ({@link routableEnd}).
   */
  connect(source: SceneNode | SceneEdge, target: SceneNode): SceneEdge | undefined {
    const writeback = this.options.getWriteback();
    if (!writeback) return undefined;
    const spec = this.options.rules.canConnect(source, target);
    if (!spec) return undefined;
    const plane = this.options.getPlane?.();
    return writeback.addConnection({
      type: spec.type,
      source,
      target,
      waypoints: routeFor(spec.type, routableEnd(source), target, this.options.routeOptions),
      ...(plane ? { plane } : {}),
    });
  }

  /**
   * Move the `end` endpoint of `edge` onto `node`: rewrite `sourceRef`/`targetRef`
   * (and the endpoints' `outgoing`/`incoming`), then re-route. Returns whether the
   * rules allowed it.
   *
   * `at` — where the endpoint was actually dropped — re-docks the moved end to the
   * NEAREST SIDE of `node` and crops it to the outline (parity spec §1/§4), instead
   * of leaving it wherever the centre-anchored router happened to put it. Omitting
   * it (the programmatic path, `Canvas.reconnectElement`) keeps the plain re-route.
   *
   * A route the author BENT and dropped back on the shape it ALREADY named is
   * re-docked rather than re-cut ({@link isRedock}): that drop changed where the edge
   * arrives, not what it connects, and the interior joints are the user's. Landing on
   * a DIFFERENT shape is a re-wire — the old bends described the old relationship —
   * so it routes from scratch, as it always did.
   */
  reconnect(edge: SceneEdge, end: ConnectionEnd, node: SceneNode, at?: Point): boolean {
    const writeback = this.options.getWriteback();
    if (!writeback) return false;
    if (!this.reconnectVerdict(edge, end, node)) return false;

    const source = end === 'source' ? node : edge.source;
    const target = end === 'target' ? node : edge.target;
    let waypoints = at !== undefined && isRedock(edge, end, node)
      ? edge.waypoints.map((p) => ({ x: p.x, y: p.y }))
      : source && target
        ? routeFor(edge.type, source, target, this.options.routeOptions)
        : undefined;
    if (waypoints && at) {
      waypoints = redockEnd(waypoints, end, node, at, {
        ...(source ? { source } : {}),
        ...(target ? { target } : {}),
      });
    }
    writeback.reconnect(edge, end === 'source' ? { source: node } : { target: node }, waypoints);
    return true;
  }

  /** The rules' verdict on moving `edge`'s `end` endpoint to `node`. */
  reconnectVerdict(edge: SceneEdge, end: ConnectionEnd, node: SceneNode): ConnectionSpec | false {
    const verdict = this.options.rules.allowed(
      end === 'source' ? 'connection.reconnectStart' : 'connection.reconnectEnd',
      end === 'source'
        ? { connection: edge, source: node }
        : { connection: edge, target: node },
    );
    return typeof verdict === 'object' ? verdict : false;
  }

  // --- internals ------------------------------------------------------------

  /** Grid-snap a point, when the host gave this gesture a snapper. */
  private snap(point: Point): Point {
    return this.options.snap ? this.options.snap(point) : point;
  }

  /** The node under a point: the topmost shape, ignoring edges. */
  private nodeAt(point: Point): SceneNode | undefined {
    const hit = this.options.hitTest(point);
    return hit && hit.kind === 'node' ? hit : undefined;
  }

  /** Preview polyline for a new connection: routed when over a target, else a rubber band. */
  private connectPreviewPoints(state: ConnectState): Point[] {
    if (state.target) {
      return routeFor(state.spec?.type, state.source, state.target, this.options.routeOptions);
    }
    return [cropPoint(state.source, state.point), state.point];
  }

  /**
   * Preview polyline for a reconnect: the edge with the dragged endpoint moved.
   *
   * Over no candidate the drop would be the free endpoint move, so the preview is
   * exactly what that move would commit — {@link freeMoveEnd}, elbow and all —
   * rather than a diagonal rubber band that would snap square on release.
   */
  private reconnectPreviewPoints(state: ReconnectState): Point[] {
    const { edge, end, candidate } = state;
    const source = end === 'source' ? candidate ?? edge.source : edge.source;
    const target = end === 'target' ? candidate ?? edge.target : edge.target;
    if (candidate) {
      // EXACTLY what the drop would commit, both halves of it: the path it starts
      // from (the author's, re-docked; or a fresh route, re-wired) and the same
      // snapped drop point. A ghost computed any other way is a promise the release
      // does not keep.
      const base = isRedock(edge, end, candidate)
        ? edge.waypoints
        : source && target
          ? routeFor(edge.type, source, target, this.options.routeOptions)
          : undefined;
      if (base) {
        return redockEnd(base, end, candidate, this.snap(state.point), {
          ...(source ? { source } : {}),
          ...(target ? { target } : {}),
        });
      }
    }
    return freeMoveEnd(edge.waypoints, end, this.snap(state.point));
  }

  /**
   * Paint the live preview. Three states, which is what the reference recording
   * shows (`edge-videos/v2/frame_02` vs `frame_05`, addendum 4 §2):
   *
   * - `pending` — over empty space: a BLUE dashed rubber band, no arrowhead. The
   *   gesture is fine, it just has nowhere to land yet.
   * - `ok` — over a shape the rules accept: the routed path, SOLID blue with the
   *   arrowhead of the flow that would be minted — the edge, previewed.
   * - `rejected` — over a shape the rules refuse: red, and still dashed.
   *
   * `type` is the connection type the drop would produce, and only decides which
   * arrowhead marker the `ok` state wears — none at all for the one flow BPMN draws
   * without one ({@link markerEndFor}).
   *
   * The COLOURS are not set here: the status is published on the wrapper and
   * `view/theme.ts` paints from it, so the preview blue is the same
   * `--sf-element-dragger-color` token as every other piece of drag chrome (parity
   * spec §5 — rgb(0,149,255)) rather than a second hard-coded blue.
   */
  private drawPreview(
    points: readonly Point[],
    status: 'pending' | 'ok' | 'rejected',
    type?: string,
  ): void {
    const scale = this.scale();
    // Rounded bends and a verbatim waypoint list, exactly as the committed edge —
    // and as the context pad's hover ghost (`render/preview.ts`). `undefined` when
    // the route is not yet a line, which is nothing to paint.
    const geometry = previewEdgeAttrs(points, {
      fill: 'none',
      width: 1.5 / scale,
      dash: status === 'ok' ? null : `${4 / scale},${3 / scale}`,
      markerEnd: status === 'ok' ? markerEndFor(type ?? CONNECTION.sequenceFlow) : null,
      markerStart: status === 'ok' ? markerStartFor(type ?? CONNECTION.sequenceFlow) : null,
    });
    if (!geometry) return;
    if (!this.preview) {
      this.preview = svgCreate('g', { class: 'sf-connect-preview' }) as SVGGElement;
      append(this.preview, svgCreate('path', { class: 'sf-connect-preview-line' }));
      append(this.options.layer, this.preview);
    }
    this.preview.setAttribute('data-allowed', String(status === 'ok'));
    this.preview.setAttribute('data-status', status);
    // The no-drop cursor of the reference (`edge-videos/v2/frame_02`) is a state of
    // the whole canvas, not of the ghost line: it has to show wherever the pointer
    // is, including over the shape that is refusing the drop.
    this.setRootStatus(status);
    const line = this.preview.firstElementChild as SVGPathElement | null;
    if (line) attr(line, geometry);
  }

  private clearPreview(): void {
    remove(this.preview);
    this.preview = undefined;
    this.setRootStatus(undefined);
    // The tint goes with the ghost: a gesture that ended over a shape must not leave
    // it filled as though a drop were still pending there.
    this.options.markTarget?.(undefined, false);
  }

  /**
   * Publish the gesture's verdict on the canvas root (`data-connect-status`), which
   * is where `view/theme.ts` hangs the ∅ cursor: a drop that would be refused — and
   * a drag that has nowhere to land yet — says so under the pointer.
   */
  private setRootStatus(status?: 'pending' | 'ok' | 'rejected'): void {
    const root = this.options.layer.ownerSVGElement;
    if (!root) return;
    if (status) root.setAttribute('data-connect-status', status);
    else root.removeAttribute('data-connect-status');
  }

  private scale(): number {
    const scale = this.options.getScale();
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }
}

/**
 * Whether moving `edge`'s `end` onto `node` is a RE-DOCK rather than a re-wire: the
 * endpoint lands back on the shape it already names, and the route has interior
 * joints somebody placed. Both halves matter — a two-point route holds no decision to
 * preserve, and a drop on another shape is a new relationship.
 */
function isRedock(edge: SceneEdge, end: ConnectionEnd, node: SceneNode): boolean {
  return edge.waypoints.length > 2 && (end === 'source' ? edge.source : edge.target) === node;
}
