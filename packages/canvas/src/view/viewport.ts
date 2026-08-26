/**
 * Viewport — pan/zoom over the canvas root `viewBox` (design §3 `view/viewport.ts`).
 *
 * Zoom and pan are expressed as the root SVG `viewBox` (diagram coordinates), the
 * same model diagram-js exposes: a {@link Viewbox} `{x, y, width, height}` plus a
 * derived `scale = containerWidth / viewBox.width`. Shapes are drawn in diagram
 * coordinates directly, so no per-shape transform is needed — only the root
 * `viewBox` changes. Screen↔diagram conversion uses the container's client rect.
 *
 * Read-only for P1: methods exist and are correct, but no pointer wiring yet.
 */

import type { Bounds, Point, SceneElement } from '@canvas/model/scene.ts';

/** The visible diagram rectangle, plus the derived screen scale. */
export interface Viewbox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Screen pixels per diagram unit (`containerWidth / width`). */
  scale: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 20;

/** Manages the root `viewBox` and screen↔diagram transforms. */
export class Viewport {
  private readonly root: SVGSVGElement;
  private readonly container: HTMLElement;
  private box = { x: 0, y: 0, width: 1000, height: 1000 };

  constructor(root: SVGSVGElement, container: HTMLElement) {
    this.root = root;
    this.container = container;
    this.applyViewbox();
  }

  /** Width of the container in screen pixels (falls back to the viewBox width). */
  private clientWidth(): number {
    const w = this.container.clientWidth;
    return w > 0 ? w : this.box.width;
  }

  /** Height of the container in screen pixels (falls back to the viewBox height). */
  private clientHeight(): number {
    const h = this.container.clientHeight;
    return h > 0 ? h : this.box.height;
  }

  private applyViewbox(): void {
    this.root.setAttribute('viewBox', `${this.box.x} ${this.box.y} ${this.box.width} ${this.box.height}`);
  }

  /** The current viewBox and derived scale. */
  getViewbox(): Viewbox {
    return { ...this.box, scale: this.clientWidth() / this.box.width };
  }

  /** Set the viewBox explicitly (a partial box updates only the given fields). */
  setViewbox(box: Partial<Omit<Viewbox, 'scale'>>): void {
    this.box = {
      x: box.x ?? this.box.x,
      y: box.y ?? this.box.y,
      width: box.width && box.width > 0 ? box.width : this.box.width,
      height: box.height && box.height > 0 ? box.height : this.box.height,
    };
    this.applyViewbox();
  }

  /** Current zoom (screen px per diagram unit). With no argument, a getter. */
  zoom(): number;
  /** Set zoom to `scale`, keeping `center` (diagram coords, default viewBox centre) fixed. */
  zoom(scale: number, center?: Point): number;
  zoom(scale?: number, center?: Point): number {
    if (scale === undefined) return this.getViewbox().scale;
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    const cx = center?.x ?? this.box.x + this.box.width / 2;
    const cy = center?.y ?? this.box.y + this.box.height / 2;
    const newWidth = this.clientWidth() / clamped;
    const newHeight = this.clientHeight() / clamped;
    // Keep (cx, cy) at the same relative position within the box.
    const relX = (cx - this.box.x) / this.box.width;
    const relY = (cy - this.box.y) / this.box.height;
    this.box = {
      x: cx - relX * newWidth,
      y: cy - relY * newHeight,
      width: newWidth,
      height: newHeight,
    };
    this.applyViewbox();
    return clamped;
  }

  /** Pan by a diagram-space delta. */
  pan(dx: number, dy: number): void {
    this.box = { ...this.box, x: this.box.x - dx, y: this.box.y - dy };
    this.applyViewbox();
  }

  /** Fit the viewBox to `bounds` (diagram coords) with proportional `padding`. */
  fitBounds(bounds: Bounds, padding = 40): void {
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const aspect = this.clientWidth() / this.clientHeight() || 1;
    // Expand the tighter axis so the diagram is fully visible and centred.
    let boxWidth = width + padding * 2;
    let boxHeight = height + padding * 2;
    if (boxWidth / boxHeight < aspect) boxWidth = boxHeight * aspect;
    else boxHeight = boxWidth / aspect;
    this.box = {
      x: bounds.x + width / 2 - boxWidth / 2,
      y: bounds.y + height / 2 - boxHeight / 2,
      width: boxWidth,
      height: boxHeight,
    };
    this.applyViewbox();
  }

  /** Convert a screen point (client coords) to diagram coordinates. */
  toDiagram(screen: Point): Point {
    const rect = this.container.getBoundingClientRect();
    const scaleX = this.box.width / (rect.width || this.box.width);
    const scaleY = this.box.height / (rect.height || this.box.height);
    return {
      x: this.box.x + (screen.x - rect.left) * scaleX,
      y: this.box.y + (screen.y - rect.top) * scaleY,
    };
  }

  /** Convert a diagram point to a screen point (client coords). */
  toScreen(diagram: Point): Point {
    const rect = this.container.getBoundingClientRect();
    const scaleX = (rect.width || this.box.width) / this.box.width;
    const scaleY = (rect.height || this.box.height) / this.box.height;
    return {
      x: rect.left + (diagram.x - this.box.x) * scaleX,
      y: rect.top + (diagram.y - this.box.y) * scaleY,
    };
  }

  /** The screen-space bounding box (client coords) of diagram-space `bounds`. */
  getAbsoluteBBox(bounds: Bounds): Bounds {
    const topLeft = this.toScreen({ x: bounds.x, y: bounds.y });
    const bottomRight = this.toScreen({ x: bounds.x + bounds.width, y: bounds.y + bounds.height });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }

  /** Pan so that `element` is centred in the viewport (keeps current zoom). */
  scrollToElement(element: SceneElement): void {
    const center = elementCenter(element);
    if (!center) return;
    this.box = {
      ...this.box,
      x: center.x - this.box.width / 2,
      y: center.y - this.box.height / 2,
    };
    this.applyViewbox();
  }
}

/** The diagram-space centre of a node or edge, if it has geometry. */
function elementCenter(element: SceneElement): Point | undefined {
  if (element.kind === 'node') {
    return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  }
  const pts = element.waypoints;
  if (pts.length === 0) return undefined;
  const mid = pts[Math.floor(pts.length / 2)];
  return { x: mid.x, y: mid.y };
}

/** Bounding box that encloses every node and edge waypoint of a set of elements. */
export function sceneBounds(elements: Iterable<SceneElement>): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const el of elements) {
    if (el.kind === 'node') {
      grow(el.x, el.y);
      grow(el.x + el.width, el.y + el.height);
    } else {
      for (const p of el.waypoints) grow(p.x, p.y);
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1000, height: 1000 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
