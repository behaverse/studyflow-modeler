/**
 * The palette create gesture: a detached prototype follows the pointer as a ghost,
 * the rules judge the container under it on every frame, and the drop mints the
 * shape through the mutator.
 */

import type { Mutator } from '@canvas/model/mutator.ts';
import type { Bounds, ModdleObject, Point, Scene, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import { EXPANDED_SIZE, isExpandable } from '@canvas/model/tree.ts';
import { categoryOf, type NodeCategory } from '@canvas/render/shapes.ts';
import { append, remove } from '@canvas/render/svg.ts';
import type { RuleElement, Rules } from '@canvas/rules/rules.ts';

export interface ShapeDescriptor {
  type: string;
  extensionType?: string;
  attrs?: Record<string, unknown>;
  /** A business object the host built already; the drop files this one. */
  businessObject?: ModdleObject;
  width?: number;
  height?: number;
  isExpanded?: boolean;
}

/** A detached shape: judged by the rules before it exists, drawn by the preview. */
export interface CreatePrototype extends RuleElement {
  readonly kind: 'prototype';
  readonly type: string;
  businessObject?: ModdleObject;
  width: number;
  height: number;
  extensionType?: string;
  attrs?: Record<string, unknown>;
  isExpanded?: boolean;
}

export const DEFAULT_SIZES: Readonly<Record<NodeCategory, { width: number; height: number }>> = {
  event: { width: 36, height: 36 },
  task: { width: 100, height: 80 },
  gateway: { width: 50, height: 50 },
  data: { width: 36, height: 50 },
  choreography: { width: 100, height: 80 },
  group: { width: 300, height: 200 },
  annotation: { width: 100, height: 30 },
  participant: { width: 600, height: 250 },
  unknown: { width: 100, height: 80 },
};

export function defaultSizeFor(type: string, isExpanded?: boolean): { width: number; height: number } {
  if (isExpanded && isExpandable(type)) return { ...EXPANDED_SIZE };
  if (type === 'bpmn:Lane') return { width: 600, height: 120 };
  return { ...DEFAULT_SIZES[categoryOf(type)] };
}

export function createShape(descriptor: ShapeDescriptor | CreatePrototype): CreatePrototype {
  if ('kind' in descriptor && descriptor.kind === 'prototype') return descriptor;
  const spec = descriptor as ShapeDescriptor;
  const size = defaultSizeFor(spec.type, spec.isExpanded);
  const prototype: CreatePrototype = {
    kind: 'prototype',
    type: spec.type,
    width: spec.width ?? size.width,
    height: spec.height ?? size.height,
  };
  if (spec.businessObject) prototype.businessObject = spec.businessObject;
  if (spec.extensionType) prototype.extensionType = spec.extensionType;
  if (spec.attrs) prototype.attrs = { ...spec.attrs };
  if (spec.isExpanded !== undefined) prototype.isExpanded = spec.isExpanded;
  return prototype;
}

export function boundsFor(prototype: CreatePrototype, center: Point): Bounds {
  return { x: center.x - prototype.width / 2, y: center.y - prototype.height / 2, width: prototype.width, height: prototype.height };
}

/** Dropping on a connection lands the shape in the connection's own container. */
function containerOf(hit: SceneElement | undefined): SceneNode | undefined {
  if (!hit) return undefined;
  if (hit.kind === 'node') return hit;
  if (hit.kind === 'label') return containerOf(hit.owner);
  return hit.parent;
}

export interface DropTarget {
  parent?: SceneNode;
  verdict: boolean | 'attach';
}

export interface CreateOptions {
  getScene: () => Scene | undefined;
  getMutator: () => Mutator | undefined;
  rules: Rules;
  hitTest: (point: Point) => SceneElement | undefined;
  layer: SVGGElement;
  /** Grid snap for the drop centre. */
  snap?: (point: Point) => Point;
  /** The container a drop on empty background lands in (the drill-down scope). */
  getContainer?: () => SceneNode | undefined;
  drawGhost?: (prototype: CreatePrototype, bounds: Bounds) => SVGElement | undefined;
  /** The element under the pointer and whether it would take the drop; `undefined` at the end. */
  markTarget?: (target: SceneElement | undefined, allowed: boolean) => void;
}

interface CreateState {
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

  getPrototype(): CreatePrototype | undefined {
    return this.state?.prototype;
  }

  start(prototype: CreatePrototype, center: Point): boolean {
    if (!this.options.getScene()) return false;
    this.state = { prototype, center: { ...center }, target: { verdict: false } };
    this.update(center);
    return true;
  }

  update(point: Point): void {
    const state = this.state;
    if (!state) return;
    state.center = this.options.snap ? this.options.snap(point) : { ...point };
    const over = this.options.hitTest(state.center);
    state.target = this.resolveTargetOver(state.prototype, over);
    const allowed = state.target.verdict !== false;
    this.drawPreview(state.prototype, boundsFor(state.prototype, state.center));
    this.options.markTarget?.(over, allowed);
  }

  end(point: Point): SceneNode | undefined {
    const state = this.state;
    if (!state) return undefined;
    this.update(point);
    const { prototype, center, target } = state;
    this.state = undefined;
    this.clearPreview();
    if (target.verdict === false) return undefined;
    return this.commit(prototype, center, target);
  }

  cancel(): void {
    this.state = undefined;
    this.clearPreview();
  }

  /** Place `prototype` exactly at `center` (a caller's coordinate is never grid-snapped). */
  createAt(prototype: CreatePrototype, center: Point): SceneNode | undefined {
    const target = this.resolveTarget(prototype, center);
    if (target.verdict === false) return undefined;
    return this.commit(prototype, center, target);
  }

  resolveTarget(prototype: CreatePrototype, center: Point): DropTarget {
    return this.resolveTargetOver(prototype, this.options.hitTest(center));
  }

  private resolveTargetOver(prototype: CreatePrototype, over: SceneElement | undefined): DropTarget {
    const scene = this.options.getScene();
    if (!scene) return { verdict: false };
    const parent = containerOf(over);
    // Inside a drilled-into container, a drop on empty background belongs to it even while it is drawn collapsed.
    const scope = this.options.getContainer?.();
    const context: RuleElement = parent ?? (scope ? { ...scope, isExpanded: true } : scene.rootElement);
    const verdict = this.options.rules.canCreate(prototype, context, { root: scene.rootElement });
    if (verdict === 'attach') return parent ? { parent, verdict } : { verdict: false };
    return parent ? { parent, verdict: verdict !== false } : { verdict: verdict !== false };
  }

  private commit(prototype: CreatePrototype, center: Point, target: DropTarget): SceneNode | undefined {
    const mutator = this.options.getMutator();
    if (!mutator) return undefined;
    const attach = target.verdict === 'attach' ? target.parent : undefined;
    const container = target.parent ?? this.options.getContainer?.();
    const node = mutator.addShape({
      type: prototype.type,
      bounds: boundsFor(prototype, center),
      ...(prototype.businessObject ? { businessObject: prototype.businessObject } : {}),
      ...(prototype.attrs ? { attrs: prototype.attrs } : {}),
      ...(prototype.extensionType ? { extensionType: prototype.extensionType } : {}),
      ...(prototype.isExpanded !== undefined ? { isExpanded: prototype.isExpanded } : {}),
      ...(attach ? { attachTo: attach } : { ...(container ? { parent: container } : {}) }),
    });
    // A pre-built business object is filed once; the next drop mints a fresh one.
    if (prototype.businessObject) prototype.businessObject = undefined;
    return node;
  }

  private drawPreview(prototype: CreatePrototype, bounds: Bounds): void {
    remove(this.preview);
    this.preview = this.options.drawGhost?.(prototype, bounds);
    if (this.preview) append(this.options.layer, this.preview);
  }

  private clearPreview(): void {
    remove(this.preview);
    this.preview = undefined;
    this.options.markTarget?.(undefined, false);
  }
}
