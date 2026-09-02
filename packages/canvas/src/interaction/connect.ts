/**
 * Connect and reconnect: one state machine, a rubber band that turns into the
 * routed flow over an accepted target, a drop that mints or rewires the edge.
 */

import { freeMoveEnd, redockEnd } from '@canvas/routing/edit.ts';
import type { Mutator } from '@canvas/model/mutator.ts';
import type { Point, Scene, SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import { markerEndFor, markerStartFor, previewEdge } from '@canvas/render/renderer.ts';
import { append, create as svgCreate, remove } from '@canvas/render/svg.ts';
import { cropPoint } from '@canvas/routing/crop.ts';
import { routableEnd, routeFor, type RouteOptions } from '@canvas/routing/orthogonal.ts';
import { CONNECTION, type ConnectionSpec, type Rules } from '@canvas/rules/rules.ts';

export type ConnectionEnd = 'source' | 'target';

export interface ConnectOptions {
  getScene: () => Scene | undefined;
  getMutator: () => Mutator | undefined;
  rules: Rules;
  hitTest: (point: Point) => SceneElement | undefined;
  layer: SVGGElement;
  routeOptions?: () => RouteOptions;
  markTarget?: (target: SceneNode | undefined, allowed: boolean) => void;
  snap?: (point: Point) => Point;
}

interface ConnectState {
  kind: 'connect';
  source: SceneNode;
  target?: SceneNode;
  spec?: ConnectionSpec;
  point: Point;
}

interface ReconnectState {
  kind: 'reconnect';
  edge: SceneEdge;
  end: ConnectionEnd;
  candidate?: SceneNode;
  point: Point;
}

type Status = 'pending' | 'ok' | 'rejected';

export class Connect {
  private readonly options: ConnectOptions;
  private state?: ConnectState | ReconnectState;
  private preview?: SVGGElement;

  constructor(options: ConnectOptions) {
    this.options = options;
  }

  isActive(): boolean {
    return this.state !== undefined;
  }

  getKind(): 'connect' | 'reconnect' | undefined {
    return this.state?.kind;
  }

  start(source: SceneNode, point: Point): boolean {
    if (!this.options.getScene()) return false;
    this.state = { kind: 'connect', source, point: { ...point } };
    this.update(point);
    return true;
  }

  startReconnect(edge: SceneEdge, end: ConnectionEnd, point: Point): boolean {
    if (!this.options.getScene() || edge.waypoints.length < 2) return false;
    this.state = { kind: 'reconnect', edge, end, point: { ...point } };
    this.update(point);
    return true;
  }

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
      this.drawPreview(this.connectPreviewPoints(state), spec ? 'ok' : hovered ? 'rejected' : 'pending', spec ? spec.type : undefined);
      return;
    }
    const verdict = hovered ? this.reconnectVerdict(state.edge, state.end, hovered) : false;
    state.candidate = verdict ? hovered : undefined;
    this.options.markTarget?.(hovered, !!verdict);
    this.drawPreview(this.reconnectPreviewPoints(state), verdict ? 'ok' : hovered ? 'rejected' : 'pending', state.edge.type);
  }

  /** A connect returns the new edge, a reconnect the rewired one; a refused drop returns nothing. */
  end(point: Point): SceneEdge | undefined {
    const state = this.state;
    if (!state) return undefined;
    this.update(point);
    this.state = undefined;
    this.clearPreview();
    if (state.kind === 'connect') return state.target ? this.connect(state.source, state.target) : undefined;
    if (!state.candidate) return undefined;
    return this.reconnect(state.edge, state.end, state.candidate, this.snap(state.point)) ? state.edge : undefined;
  }

  cancel(): void {
    this.state = undefined;
    this.clearPreview();
  }

  /** Connect two elements without a gesture; `undefined` when the rules refuse. */
  connect(source: SceneNode | SceneEdge, target: SceneNode): SceneEdge | undefined {
    const mutator = this.options.getMutator();
    if (!mutator) return undefined;
    const spec = this.options.rules.canConnect(source, target);
    if (!spec) return undefined;
    return mutator.addConnection({
      type: spec.type,
      source,
      target,
      waypoints: routeFor(spec.type, routableEnd(source), target, this.options.routeOptions?.()),
    });
  }

  /**
   * Move `end` of `edge` onto `node`. `at` re-docks the end where it was dropped; a
   * bent route dropped back on the shape it already named keeps its bends.
   */
  reconnect(edge: SceneEdge, end: ConnectionEnd, node: SceneNode, at?: Point): boolean {
    const mutator = this.options.getMutator();
    if (!mutator || !this.reconnectVerdict(edge, end, node)) return false;
    const source = end === 'source' ? node : edge.source;
    const target = end === 'target' ? node : edge.target;
    let waypoints = at !== undefined && isRedock(edge, end, node)
      ? edge.waypoints.map((p) => ({ x: p.x, y: p.y }))
      : source && target ? routeFor(edge.type, source, target, this.options.routeOptions?.()) : undefined;
    if (waypoints && at) waypoints = redockEnd(waypoints, end, node, at, { source, target });
    mutator.reconnect(edge, end === 'source' ? { source: node } : { target: node }, waypoints);
    return true;
  }

  reconnectVerdict(edge: SceneEdge, end: ConnectionEnd, node: SceneNode): ConnectionSpec | false {
    return end === 'source'
      ? this.options.rules.canReconnect(edge, node, undefined)
      : this.options.rules.canReconnect(edge, undefined, node);
  }

  private snap(point: Point): Point {
    return this.options.snap ? this.options.snap(point) : point;
  }

  private nodeAt(point: Point): SceneNode | undefined {
    const hit = this.options.hitTest(point);
    if (hit?.kind === 'label') return hit.owner.kind === 'node' ? hit.owner : undefined;
    return hit && hit.kind === 'node' ? hit : undefined;
  }

  private connectPreviewPoints(state: ConnectState): Point[] {
    if (state.target) return routeFor(state.spec?.type, state.source, state.target, this.options.routeOptions?.());
    return [cropPoint(state.source, state.point), state.point];
  }

  private reconnectPreviewPoints(state: ReconnectState): Point[] {
    const { edge, end, candidate } = state;
    const source = end === 'source' ? candidate ?? edge.source : edge.source;
    const target = end === 'target' ? candidate ?? edge.target : edge.target;
    if (candidate) {
      const base = isRedock(edge, end, candidate)
        ? edge.waypoints
        : source && target ? routeFor(edge.type, source, target, this.options.routeOptions?.()) : undefined;
      if (base) return redockEnd(base, end, candidate, this.snap(state.point), { source, target });
    }
    return freeMoveEnd(edge.waypoints, end, this.snap(state.point));
  }

  private drawPreview(points: readonly Point[], status: Status, type?: string): void {
    remove(this.preview);
    this.preview = undefined;
    const line = previewEdge(points, 'sf-connect-preview-line', {
      dash: status === 'ok' ? null : '4,3',
      markerEnd: status === 'ok' ? markerEndFor(type ?? CONNECTION.sequenceFlow) : null,
      markerStart: status === 'ok' ? markerStartFor(type ?? CONNECTION.sequenceFlow) : null,
    });
    this.setRootStatus(status);
    if (!line) return;
    this.preview = svgCreate('g', { class: 'sf-preview sf-connect-preview', 'data-status': status }) as SVGGElement;
    append(this.preview, line);
    append(this.options.layer, this.preview);
  }

  private clearPreview(): void {
    remove(this.preview);
    this.preview = undefined;
    this.setRootStatus(undefined);
    this.options.markTarget?.(undefined, false);
  }

  /** The verdict on the root, where the stylesheet hangs the cursor. */
  private setRootStatus(status?: Status): void {
    const root = this.options.layer.ownerSVGElement;
    if (!root) return;
    if (status) root.setAttribute('data-connect-status', status);
    else root.removeAttribute('data-connect-status');
  }
}

function isRedock(edge: SceneEdge, end: ConnectionEnd, node: SceneNode): boolean {
  return edge.waypoints.length > 2 && (end === 'source' ? edge.source : edge.target) === node;
}
