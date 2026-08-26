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
  Point,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';
import type { Writeback } from '@canvas/model/writeback.ts';
import { route, type RouteOptions } from '@canvas/routing/orthogonal.ts';
import { cropPoint } from '@canvas/routing/crop.ts';
import type { ConnectionSpec, Rules } from '@canvas/rules/rules.ts';
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
      this.drawPreview(this.connectPreviewPoints(state), !!spec);
      return;
    }

    const allowed = !!(hovered && this.reconnectVerdict(state.edge, state.end, hovered));
    state.candidate = allowed ? hovered : undefined;
    state.allowed = allowed;
    this.drawPreview(this.reconnectPreviewPoints(state), allowed);
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
    return this.reconnect(state.edge, state.end, state.candidate) ? state.edge : undefined;
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
   */
  connect(source: SceneNode, target: SceneNode): SceneEdge | undefined {
    const writeback = this.options.getWriteback();
    if (!writeback) return undefined;
    const spec = this.options.rules.canConnect(source, target);
    if (!spec) return undefined;
    return writeback.addConnection({
      type: spec.type,
      source,
      target,
      waypoints: route(source, target, this.options.routeOptions),
    });
  }

  /**
   * Move the `end` endpoint of `edge` onto `node`: rewrite `sourceRef`/`targetRef`
   * (and the endpoints' `outgoing`/`incoming`), then re-route. Returns whether the
   * rules allowed it.
   */
  reconnect(edge: SceneEdge, end: ConnectionEnd, node: SceneNode): boolean {
    const writeback = this.options.getWriteback();
    if (!writeback) return false;
    if (!this.reconnectVerdict(edge, end, node)) return false;

    const source = end === 'source' ? node : edge.source;
    const target = end === 'target' ? node : edge.target;
    const waypoints = source && target ? route(source, target, this.options.routeOptions) : undefined;
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

  /** The node under a point: the topmost shape, ignoring edges. */
  private nodeAt(point: Point): SceneNode | undefined {
    const hit = this.options.hitTest(point);
    return hit && hit.kind === 'node' ? hit : undefined;
  }

  /** Preview polyline for a new connection: routed when over a target, else a rubber band. */
  private connectPreviewPoints(state: ConnectState): Point[] {
    if (state.target) return route(state.source, state.target, this.options.routeOptions);
    return [cropPoint(state.source, state.point), state.point];
  }

  /** Preview polyline for a reconnect: the edge with the dragged endpoint moved. */
  private reconnectPreviewPoints(state: ReconnectState): Point[] {
    const { edge, end, candidate } = state;
    const source = end === 'source' ? candidate ?? edge.source : edge.source;
    const target = end === 'target' ? candidate ?? edge.target : edge.target;
    if (candidate && source && target) return route(source, target, this.options.routeOptions);
    const points = edge.waypoints.map((p) => ({ x: p.x, y: p.y }));
    points[end === 'source' ? 0 : points.length - 1] = { ...state.point };
    return points;
  }

  private drawPreview(points: readonly Point[], allowed: boolean): void {
    if (points.length < 2) return;
    const scale = this.scale();
    if (!this.preview) {
      this.preview = svgCreate('g', { class: 'sf-connect-preview' }) as SVGGElement;
      append(this.preview, svgCreate('polyline', { class: 'sf-connect-preview-line' }));
      append(this.options.layer, this.preview);
    }
    this.preview.setAttribute('data-allowed', String(allowed));
    const line = this.preview.firstElementChild as SVGPolylineElement | null;
    if (!line) return;
    attr(line, {
      points: points.map((p) => `${p.x},${p.y}`).join(' '),
      fill: 'none',
      stroke: allowed ? '#1a73e8' : '#d93025',
      'stroke-width': 1.5 / scale,
      'stroke-dasharray': `${4 / scale},${3 / scale}`,
    });
  }

  private clearPreview(): void {
    remove(this.preview);
    this.preview = undefined;
  }

  private scale(): number {
    const scale = this.options.getScale();
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }
}
