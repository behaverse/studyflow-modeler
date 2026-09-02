/** Pan and zoom, expressed as the root `viewBox`; screen ↔ diagram transforms. */

import type { Bounds, Point, SceneElement } from '@canvas/model/scene.ts';

export interface Viewbox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Screen pixels per diagram unit. */
  scale: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 20;

/** The host's UI scale (root font size / 16), which caps how far a fit magnifies. */
function uiScale(): number {
  if (typeof document === 'undefined') return 1;
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(root) && root > 0 ? root / 16 : 1;
}

export class Viewport {
  private readonly root: SVGSVGElement;
  private readonly container: HTMLElement;
  private box = { x: 0, y: 0, width: 1000, height: 1000 };

  constructor(root: SVGSVGElement, container: HTMLElement) {
    this.root = root;
    this.container = container;
    this.applyViewbox();
  }

  private clientWidth(): number {
    const w = this.container.clientWidth;
    return w > 0 ? w : this.box.width;
  }

  private clientHeight(): number {
    const h = this.container.clientHeight;
    return h > 0 ? h : this.box.height;
  }

  private applyViewbox(): void {
    this.root.setAttribute('viewBox', `${this.box.x} ${this.box.y} ${this.box.width} ${this.box.height}`);
  }

  getViewbox(): Viewbox {
    return { ...this.box, scale: this.rendering().scale };
  }

  setViewbox(box: Partial<Omit<Viewbox, 'scale'>>): void {
    this.box = {
      x: box.x ?? this.box.x,
      y: box.y ?? this.box.y,
      width: box.width && box.width > 0 ? box.width : this.box.width,
      height: box.height && box.height > 0 ? box.height : this.box.height,
    };
    this.applyViewbox();
  }

  zoom(): number;
  zoom(scale: number, center?: Point): number;
  zoom(scale?: number, center?: Point): number {
    if (scale === undefined) return this.getViewbox().scale;
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    const cx = center?.x ?? this.box.x + this.box.width / 2;
    const cy = center?.y ?? this.box.y + this.box.height / 2;
    const newWidth = this.clientWidth() / clamped;
    const newHeight = this.clientHeight() / clamped;
    const relX = (cx - this.box.x) / this.box.width;
    const relY = (cy - this.box.y) / this.box.height;
    this.box = { x: cx - relX * newWidth, y: cy - relY * newHeight, width: newWidth, height: newHeight };
    this.applyViewbox();
    return clamped;
  }

  pan(dx: number, dy: number): void {
    this.box = { ...this.box, x: this.box.x - dx, y: this.box.y - dy };
    this.applyViewbox();
  }

  /** A fit asked for while the container had no size yet, re-applied once it does. */
  private pendingFit?: { bounds: Bounds; padding: number };

  /** Re-run a fit that happened before the container was laid out. */
  refitIfPending(): void {
    const pending = this.pendingFit;
    if (!pending || this.container.clientWidth <= 0 || this.container.clientHeight <= 0) return;
    this.pendingFit = undefined;
    this.fitBounds(pending.bounds, pending.padding);
  }

  /** Fit `bounds` with `padding`, never magnifying past the UI scale. */
  fitBounds(bounds: Bounds, padding = 40): void {
    this.pendingFit = this.container.clientWidth > 0 && this.container.clientHeight > 0 ? undefined : { bounds, padding };
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const aspect = this.clientWidth() / this.clientHeight() || 1;
    let boxWidth = width + padding * 2;
    let boxHeight = height + padding * 2;
    if (boxWidth / boxHeight < aspect) boxWidth = boxHeight * aspect;
    else boxHeight = boxWidth / aspect;
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

  /** How the browser maps the viewBox (`xMidYMid meet`): one scale, centred. */
  private rendering(): { rect: DOMRect; scale: number; ox: number; oy: number } {
    const rect = this.container.getBoundingClientRect();
    const width = rect.width || this.box.width;
    const height = rect.height || this.box.height;
    const scale = Math.min(width / this.box.width, height / this.box.height);
    return { rect, scale, ox: (width - this.box.width * scale) / 2, oy: (height - this.box.height * scale) / 2 };
  }

  toDiagram(screen: Point): Point {
    const { rect, scale, ox, oy } = this.rendering();
    return { x: this.box.x + (screen.x - rect.left - ox) / scale, y: this.box.y + (screen.y - rect.top - oy) / scale };
  }

  toScreen(diagram: Point): Point {
    const { rect, scale, ox, oy } = this.rendering();
    return { x: rect.left + ox + (diagram.x - this.box.x) * scale, y: rect.top + oy + (diagram.y - this.box.y) * scale };
  }

  getAbsoluteBBox(bounds: Bounds): Bounds {
    const topLeft = this.toScreen({ x: bounds.x, y: bounds.y });
    const bottomRight = this.toScreen({ x: bounds.x + bounds.width, y: bounds.y + bounds.height });
    return { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
  }

  scrollToElement(element: SceneElement): void {
    const center = elementCenter(element);
    if (!center) return;
    this.box = { ...this.box, x: center.x - this.box.width / 2, y: center.y - this.box.height / 2 };
    this.applyViewbox();
  }
}

function elementCenter(element: SceneElement): Point | undefined {
  if (element.kind !== 'edge') return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  const pts = element.waypoints;
  if (pts.length === 0) return undefined;
  const mid = pts[Math.floor(pts.length / 2)];
  return { x: mid.x, y: mid.y };
}
