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

/**
 * The host app's UI scale as a plain factor — `--ui-scale` in `assets/css/app.css`
 * lands on the root font size, so one `getComputedStyle` reads it without the
 * canvas package having to know the variable's name. 1 on any display that has not
 * stepped up, which is what keeps a fit 1:1 everywhere it used to be.
 */
function uiScale(): number {
  if (typeof document === 'undefined') return 1;
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(root) && root > 0 ? root / 16 : 1;
}

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
    // A fit shows everything; it never magnifies past the UI scale. Without a cap
    // a one-shape diagram is blown up until a 36px event fills the window, which
    // makes every screen→diagram coordinate wildly off. diagram-js caps its own
    // `zoom('fit-viewport')` at 1:1; the cap here is the app's UI scale
    // (`--ui-scale`, `assets/css/app.css`), which IS 1:1 on a normal display and
    // rises only where the chrome around the canvas grew too — otherwise a 4K
    // panel opens every diagram at 100%, a third the apparent size of the toolbar
    // beside it. The box already carries the viewport's aspect ratio, so one
    // factor scales both axes and keeps it.
    const magnification = this.clientWidth() / boxWidth / uiScale();
    if (Number.isFinite(magnification) && magnification > 1) {
      boxWidth *= magnification;
      boxHeight *= magnification;
    }
    this.box = {
      x: bounds.x + width / 2 - boxWidth / 2,
      y: bounds.y + height / 2 - boxHeight / 2,
      width: boxWidth,
      height: boxHeight,
    };
    this.applyViewbox();
  }

  /**
   * How the browser actually maps the viewBox into the container: the root SVG
   * carries `preserveAspectRatio="xMidYMid meet"`, i.e. ONE uniform scale with the
   * box centred on the letterboxed axis. `fitBounds`/`zoom` keep the two aspects
   * equal, where this is identical to the old per-axis math — but a viewBox minted
   * while the container had no size (a hidden tab) is square in a non-square
   * container, and mapping per-axis there put every pointer event tens of units
   * off, which made the whole canvas click-dead.
   */
  private rendering(): { rect: DOMRect; scale: number; ox: number; oy: number } {
    const rect = this.container.getBoundingClientRect();
    const width = rect.width || this.box.width;
    const height = rect.height || this.box.height;
    const scale = Math.min(width / this.box.width, height / this.box.height);
    return {
      rect,
      scale,
      ox: (width - this.box.width * scale) / 2,
      oy: (height - this.box.height * scale) / 2,
    };
  }

  /** Convert a screen point (client coords) to diagram coordinates. */
  toDiagram(screen: Point): Point {
    const { rect, scale, ox, oy } = this.rendering();
    return {
      x: this.box.x + (screen.x - rect.left - ox) / scale,
      y: this.box.y + (screen.y - rect.top - oy) / scale,
    };
  }

  /** Convert a diagram point to a screen point (client coords). */
  toScreen(diagram: Point): Point {
    const { rect, scale, ox, oy } = this.rendering();
    return {
      x: rect.left + ox + (diagram.x - this.box.x) * scale,
      y: rect.top + oy + (diagram.y - this.box.y) * scale,
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
