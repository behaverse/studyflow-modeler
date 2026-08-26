/**
 * Palette-driven create gesture (design §3 `interaction/create.ts`, §6 P4) —
 * the replacement for diagram-js's `create` + `dragging` services.
 *
 * Three beats, mirroring `interaction/drag.ts` so the canvas can drive both from
 * one pointer loop:
 *
 * 1. {@link createShape} turns a palette descriptor into a **detached prototype** —
 *    a type, a footprint, and (optionally) a business object the app already built
 *    (`packages/modeler/src/shape/buildBusinessObject.ts`). It has no scene
 *    identity, which is exactly what `rules.allowed('shape.create')` is built to
 *    judge (`rules/rules.ts` `RuleElement`).
 * 2. {@link Create.start} / {@link Create.update} track the pointer with a live
 *    preview drawn into the overlay layer, re-asking the rules on every frame so
 *    the preview shows whether the drop would be accepted.
 * 3. {@link Create.end} commits: on an allowed drop it mints the business object
 *    into the target container AND the `bpmndi:BPMNShape` + `dc:Bounds` into the
 *    plane through {@link Writeback.addShape}, so `bpmn-moddle` re-serializes both
 *    halves (design §1 "add shape"). A rejected drop writes nothing at all.
 *
 * Only the SCENE and the preview overlay are touched before the drop, so an
 * abandoned gesture ({@link Create.cancel}, Escape) leaves the document untouched.
 * Mounting the new graphics and selecting the node is the canvas's job — this
 * module stays model-and-preview only.
 */

import { EXPANDED_SUBPROCESS_SIZE, isExpandable } from '@canvas/model/expand.ts';
import type {
  Bounds,
  ModdleObject,
  Point,
  Scene,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';
import type { Writeback } from '@canvas/model/writeback.ts';
import { categoryOf, type NodeCategory } from '@canvas/render/renderer.ts';
import type { RuleElement, Rules } from '@canvas/rules/rules.ts';
import { append, attr, create as svgCreate, remove } from '@canvas/render/svg.ts';

/** What a palette hands the canvas: a BPMN type plus optional studyflow trimmings. */
export interface ShapeDescriptor {
  /** BPMN type to mint (`'bpmn:Task'`). */
  type: string;
  /** Studyflow extension type (`'cognitive:Instruction'`) written into `extensionElements`. */
  extensionType?: string;
  /** Business-object attributes (`{ name: 'Read me' }`). */
  attrs?: Record<string, unknown>;
  /** A business object the app built already; the drop files this one rather than minting. */
  businessObject?: ModdleObject;
  /** Footprint overrides; defaults come from {@link defaultSizeFor}. */
  width?: number;
  height?: number;
  /** `BPMNShape.isExpanded` for a sub-process dropped expanded. */
  isExpanded?: boolean;
}

/**
 * A detached shape the create gesture carries. Structurally a {@link RuleElement}
 * (so `rules.canCreate` can judge it before it exists) plus the footprint the
 * preview draws.
 */
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

/** Default footprints per drawer category (design §2 geometry). */
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

/**
 * Footprint of an expanded sub-process — it has to hold something. Defined in
 * `model/expand.ts` (which the expand/collapse toggle grows a shape back to) and
 * re-exported here so a palette drop and a toggle agree on one number.
 */
export { EXPANDED_SUBPROCESS_SIZE };

/** The default footprint for a BPMN type, honouring the expanded-sub-process case. */
export function defaultSizeFor(type: string, isExpanded?: boolean): { width: number; height: number } {
  if (isExpanded && isExpandable(type)) {
    return { ...EXPANDED_SUBPROCESS_SIZE };
  }
  if (type === 'bpmn:Lane') return { width: 600, height: 120 };
  return { ...DEFAULT_SIZES[categoryOf(type)] };
}

/**
 * Turn a palette descriptor into a detached {@link CreatePrototype}. This is the
 * `gestures.createShape` of the editor facade (`packages/modeler/src/editor/port.ts`):
 * the app calls it, then hands the result to {@link Create.start} /
 * `Canvas.startCreate`.
 */
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

/** The bounds a prototype dropped with its centre at `center` would occupy. */
export function boundsFor(prototype: CreatePrototype, center: Point): Bounds {
  return {
    x: center.x - prototype.width / 2,
    y: center.y - prototype.height / 2,
    width: prototype.width,
    height: prototype.height,
  };
}

/**
 * The container a hit drops INTO: the shape itself, or — for a connection — the
 * container that connection lives in, which is how dropping onto a sequence flow
 * lands the new shape in the flow's own parent (parity spec §7: an insert-on-flow
 * drop is allowed, and marks the connection rather than a container).
 */
function containerOf(hit: SceneElement | undefined): SceneNode | undefined {
  if (!hit) return undefined;
  return hit.kind === 'node' ? hit : hit.parent;
}

/** What a candidate drop point resolves to. */
export interface DropTarget {
  /** The container the shape would land in; `undefined` = the plane root. */
  parent?: SceneNode;
  /** The rules verdict: `false` rejects, `'attach'` means "as a boundary event on {@link DropTarget.parent}". */
  verdict: boolean | 'attach';
}

/** Construction dependencies for {@link Create}. */
export interface CreateOptions {
  /** The live scene (the gesture is inert before an import). */
  getScene: () => Scene | undefined;
  /** The writeback the drop commits through. */
  getWriteback: () => Writeback | undefined;
  /** The rule engine gating the drop. */
  rules: Rules;
  /** Topmost element under a diagram point (`Canvas.hitTest`). */
  hitTest: (point: Point) => SceneElement | undefined;
  /** SVG layer the live preview is drawn into (the overlay layer). */
  layer: SVGGElement;
  /** Screen pixels per diagram unit, so the preview stroke stays constant on screen. */
  getScale: () => number;
  /** Optional coordinate snap (grid), applied to the drop centre. */
  snap?: (point: Point) => Point;
  /**
   * Draw the ghost that follows the cursor — the shape itself, rendered as a blue
   * outline (parity spec §7 "Creating from the app palette"). The canvas injects its
   * renderer here; without it the gesture falls back to a plain dashed footprint,
   * which is all a bare `Create` outside a canvas can draw.
   */
  drawGhost?: (prototype: CreatePrototype, bounds: Bounds) => SVGElement | undefined;
  /**
   * Report the element the pointer is over and whether it would take the drop, so
   * the canvas can tint it (`new-parent` / `drop-not-ok`). `undefined` means empty
   * canvas — the plane root itself is the target. Called on every frame, and once
   * with `undefined` when the gesture ends, so the marks are exactly as long-lived
   * as the gesture.
   */
  markTarget?: (target: SceneElement | undefined, allowed: boolean) => void;
}

interface CreateState {
  prototype: CreatePrototype;
  center: Point;
  target: DropTarget;
}

/** Runs one palette create gesture and commits it through {@link Writeback}. */
export class Create {
  private readonly options: CreateOptions;
  private state?: CreateState;
  private preview?: SVGGElement;

  constructor(options: CreateOptions) {
    this.options = options;
  }

  /** Whether a create gesture is in flight. */
  isActive(): boolean {
    return this.state !== undefined;
  }

  /** The prototype currently being placed, if any. */
  getPrototype(): CreatePrototype | undefined {
    return this.state?.prototype;
  }

  /**
   * Begin placing `prototype`, with the pointer at diagram point `center`. Returns
   * `false` when there is no scene to drop into.
   */
  start(prototype: CreatePrototype, center: Point): boolean {
    if (!this.options.getScene()) return false;
    this.state = { prototype, center: { ...center }, target: { verdict: false } };
    this.update(center);
    return true;
  }

  /** Track the pointer: move the preview and re-ask the rules. */
  update(point: Point): void {
    const state = this.state;
    if (!state) return;
    state.center = this.options.snap ? this.options.snap(point) : { ...point };
    // One hit test drives both halves: the rules are asked about the CONTAINER the
    // drop would land in, while the tint goes on whatever is actually under the
    // pointer — which for an insert-on-flow drop is the connection itself.
    const over = this.options.hitTest(state.center);
    state.target = this.resolveTargetOver(state.prototype, over);
    const allowed = state.target.verdict !== false;
    this.drawPreview(state.prototype, boundsFor(state.prototype, state.center), allowed);
    this.options.markTarget?.(over, allowed);
  }

  /**
   * Drop at `point`. On an allowed target this mints the business object + DI pair
   * and returns the new {@link SceneNode}; on a rejected one it writes nothing and
   * returns `undefined`. Either way the gesture ends and the preview is removed.
   */
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

  /** Abandon the gesture. Nothing was written, so there is nothing to undo. */
  cancel(): void {
    this.state = undefined;
    this.clearPreview();
  }

  /**
   * Place `prototype` centred on `center` without a pointer gesture — the
   * click-to-place path, and what tests drive. Returns `undefined` when the rules
   * reject the drop.
   */
  createAt(prototype: CreatePrototype, center: Point): SceneNode | undefined {
    const at = this.options.snap ? this.options.snap(center) : center;
    const target = this.resolveTarget(prototype, at);
    if (target.verdict === false) return undefined;
    return this.commit(prototype, at, target);
  }

  /**
   * The container a drop at `center` would land in and the rules' verdict on it —
   * exposed so a caller (or a test) can ask "would this be allowed?" without
   * running the gesture.
   */
  resolveTarget(prototype: CreatePrototype, center: Point): DropTarget {
    return this.resolveTargetOver(prototype, this.options.hitTest(center));
  }

  /** {@link Create.resolveTarget} for an already-resolved hit (one hit test per frame). */
  private resolveTargetOver(prototype: CreatePrototype, over: SceneElement | undefined): DropTarget {
    const scene = this.options.getScene();
    if (!scene) return { verdict: false };
    const parent = containerOf(over);
    const context: RuleElement = parent ?? scene.rootPlane;
    // `root` lets the rules tell "the plane this diagram IS" from any other flow
    // container of the same type — the one thing a pool drop turns on (§3A).
    const verdict = this.options.rules.allowed('shape.create', {
      shape: prototype,
      parent: context,
      root: scene.rootPlane,
    });
    if (verdict === 'attach') return parent ? { parent, verdict } : { verdict: false };
    return parent ? { parent, verdict: verdict !== false } : { verdict: verdict !== false };
  }

  // --- internals ------------------------------------------------------------

  /** Mint the BO + DI pair and index the node in the scene. */
  private commit(prototype: CreatePrototype, center: Point, target: DropTarget): SceneNode | undefined {
    const writeback = this.options.getWriteback();
    if (!writeback) return undefined;
    const attach = target.verdict === 'attach' ? target.parent : undefined;
    const node = writeback.addShape({
      type: prototype.type,
      bounds: boundsFor(prototype, center),
      ...(prototype.businessObject ? { businessObject: prototype.businessObject } : {}),
      ...(prototype.attrs ? { attrs: prototype.attrs } : {}),
      ...(prototype.extensionType ? { extensionType: prototype.extensionType } : {}),
      ...(prototype.isExpanded !== undefined ? { isExpanded: prototype.isExpanded } : {}),
      ...(attach ? { attachTo: attach } : { ...(target.parent ? { parent: target.parent } : {}) }),
    });
    // A prototype carrying a pre-built business object must not file that same
    // object twice; the next drop of the same palette entry mints a fresh one.
    if (prototype.businessObject) prototype.businessObject = undefined;
    return node;
  }

  /**
   * The ghost. With a renderer injected ({@link CreateOptions.drawGhost}) it is the
   * real shape wearing `sf-dragger` — blue outline, no fills, label included, the
   * same ghost a move drag leaves under the cursor — and it stays blue whether or not
   * the drop is allowed, because the *target* is what turns red (parity spec §7).
   * `data-allowed` records the verdict either way.
   */
  private drawPreview(prototype: CreatePrototype, bounds: Bounds, allowed: boolean): void {
    if (!this.preview) {
      this.preview = svgCreate('g', { class: 'sf-create-preview' }) as SVGGElement;
      append(this.options.layer, this.preview);
    }
    this.preview.setAttribute('data-allowed', String(allowed));

    const ghost = this.options.drawGhost?.(prototype, bounds);
    if (ghost) {
      while (this.preview.firstChild) this.preview.removeChild(this.preview.firstChild);
      append(this.preview, ghost);
      return;
    }
    // No renderer: a plain dashed footprint, which is all the model half can draw.
    const scale = this.scale();
    let rect = this.preview.firstElementChild as SVGRectElement | null;
    if (!rect) {
      rect = svgCreate('rect', { class: 'sf-create-preview-shape' }) as SVGRectElement;
      append(this.preview, rect);
    }
    attr(rect, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      fill: 'rgba(26,115,232,0.08)',
      stroke: '#1a73e8',
      'stroke-width': 1.5 / scale,
      'stroke-dasharray': `${4 / scale},${3 / scale}`,
    });
  }

  private clearPreview(): void {
    remove(this.preview);
    this.preview = undefined;
    // The tint belongs to the gesture, not to the element: it goes when the ghost does.
    this.options.markTarget?.(undefined, false);
  }

  private scale(): number {
    const scale = this.options.getScale();
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }
}
