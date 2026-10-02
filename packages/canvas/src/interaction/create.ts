/**
 * The palette create gesture: a detached prototype follows the pointer as a ghost,
 * the rules judge the container under it on every frame, and the drop hands what
 * it made, where, to the study to add.
 */

import { containerOf } from '@canvas/study/hit.ts';
import { boundsFor, type CreatePrototype, type NewElement } from '@canvas/study/prototype.ts';
import type { Bounds, Point, Scene, SceneElement, SceneNode } from '@canvas/study/scene.ts';
import { append, remove } from '@canvas/render/svg.ts';
import type { RuleElement, Rules } from '@canvas/study/rules.ts';

/** Dropping on a connection lands the shape in the connection's own container. */
export interface DropTarget {
  parent?: SceneNode;
  verdict: boolean | 'attach';
}

export interface CreateOptions {
  getScene: () => Scene;
  rules: Rules;
  hitTest: (point: Point) => SceneElement | undefined;
  layer: SVGGElement;
  /** Grid snap for the drop centre. */
  snap: (point: Point) => Point;
  /** The container a drop on empty background lands in (the drill-down scope). */
  getContainer: () => SceneNode | undefined;
  /** Add `what` centred on `center`, into `into` (the top level without it): the shape made, or nothing. */
  drop: (what: NewElement, center: Point, into: SceneNode | undefined) => SceneNode | undefined;
  drawGhost: (prototype: CreatePrototype, bounds: Bounds) => SVGElement | undefined;
  /** The element under the pointer and whether it would take the drop; `undefined` at the end. */
  markTarget: (target: SceneElement | undefined, allowed: boolean) => void;
}

interface CreateState {
  /** What the gesture makes, as the drop hands it on. */
  what: NewElement;
  /** Its shape before it exists, which the rules judge and the ghost draws. */
  prototype: CreatePrototype;
  center: Point;
  target: DropTarget;
}

export class Create {
  private readonly options: CreateOptions;
  private state?: CreateState;
  private preview?: SVGElement;

  constructor(options: CreateOptions) {
    this.options = options;
  }

  isActive(): boolean {
    return this.state !== undefined;
  }

  start(what: NewElement, prototype: CreatePrototype, center: Point): boolean {
    this.state = { what, prototype, center: { ...center }, target: { verdict: false } };
    this.update(center);
    return true;
  }

  update(point: Point): void {
    const state = this.state;
    if (!state) return;
    state.center = this.options.snap(point);
    const over = this.options.hitTest(state.center);
    state.target = this.resolveTargetOver(state.prototype, over);
    const allowed = state.target.verdict !== false;
    this.drawPreview(state.prototype, boundsFor(state.prototype, state.center));
    this.options.markTarget(over, allowed);
  }

  end(point: Point): SceneNode | undefined {
    const state = this.state;
    if (!state) return undefined;
    this.update(point);
    const { what, center, target } = state;
    this.state = undefined;
    this.clearPreview();
    if (target.verdict === false) return undefined;
    return this.options.drop(what, center, target.parent ?? this.options.getContainer());
  }

  cancel(): void {
    this.state = undefined;
    this.clearPreview();
  }

  private resolveTargetOver(prototype: CreatePrototype, over: SceneElement | undefined): DropTarget {
    const scene = this.options.getScene();
    const parent = containerOf(over);
    // Inside a drilled-into container, a drop on empty background belongs to it even while it is drawn collapsed.
    const scope = this.options.getContainer();
    const context: RuleElement = parent ?? (scope ? { ...scope, isExpanded: true } : scene.rootElement);
    const verdict = this.options.rules.canCreate(prototype, context, { root: scene.rootElement });
    if (verdict === 'attach') return parent ? { parent, verdict } : { verdict: false };
    return parent ? { parent, verdict: verdict !== false } : { verdict: verdict !== false };
  }

  private drawPreview(prototype: CreatePrototype, bounds: Bounds): void {
    remove(this.preview);
    this.preview = this.options.drawGhost(prototype, bounds);
    if (this.preview) append(this.options.layer, this.preview);
  }

  private clearPreview(): void {
    remove(this.preview);
    this.preview = undefined;
    this.options.markTarget(undefined, false);
  }
}
