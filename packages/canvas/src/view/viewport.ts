/** Pan and zoom, expressed as the root `viewBox`; screen ↔ diagram transforms. */

import type { Bounds, Point, SceneElement } from '@canvas/study/scene.ts';
import { DURATION, easeOut, moves } from '@canvas/view/motion.ts';

export interface Viewbox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Screen pixels per diagram unit. */
  scale: number;
}

/** How far a host's own UI reaches into the view from each edge, in CSS pixels. */
export interface Insets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

type Box = { x: number; y: number; width: number; height: number };

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
  private box: Box = { x: 0, y: 0, width: 1000, height: 1000 };
  /** Where a glide is taking the camera, while one is under way. */
  private goal?: Box;
  private frame?: number;
  /** Told after every move of the camera, once constructed. */
  private onChange?: () => void;
  /** What the host's UI covers now, asked at each fit and reveal. */
  private readonly insets?: () => Insets;

  constructor(root: SVGSVGElement, container: HTMLElement, onChange?: () => void, insets?: () => Insets) {
    this.root = root;
    this.container = container;
    this.insets = insets;
    this.applyViewbox();
    this.onChange = onChange;
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
    this.onChange?.();
  }

  /**
   * Show `box`: at once, or with `glide` travelling there, its centre in a line and its scale evenly. Any other move
   * of the camera stops a glide where it is and goes on from there.
   */
  private moveTo(box: Box, glide = false): void {
    const view = this.root.ownerDocument?.defaultView;
    if (this.frame !== undefined) view?.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.goal = undefined;
    if (!glide || !view || !moves(this.root)) {
      this.box = box;
      this.applyViewbox();
      return;
    }
    const from = this.box;
    const cx = (b: Box): number => b.x + b.width / 2;
    const cy = (b: Box): number => b.y + b.height / 2;
    let start: number | undefined;
    const step = (now: number): void => {
      start ??= now;
      const t = Math.min(1, (now - start) / DURATION.camera);
      const k = easeOut(t);
      const width = from.width * (box.width / from.width) ** k;
      const height = from.height * (box.height / from.height) ** k;
      const x = cx(from) + (cx(box) - cx(from)) * k - width / 2;
      const y = cy(from) + (cy(box) - cy(from)) * k - height / 2;
      this.box = t < 1 ? { x, y, width, height } : box;
      this.frame = t < 1 ? view.requestAnimationFrame(step) : undefined;
      if (t >= 1) this.goal = undefined;
      this.applyViewbox();
    };
    this.goal = box;
    this.frame = view.requestAnimationFrame(step);
  }

  getViewbox(): Viewbox {
    return { ...this.box, scale: this.rendering().scale };
  }

  setViewbox(box: Partial<Omit<Viewbox, 'scale'>>): void {
    this.moveTo({
      x: box.x ?? this.box.x,
      y: box.y ?? this.box.y,
      width: box.width && box.width > 0 ? box.width : this.box.width,
      height: box.height && box.height > 0 ? box.height : this.box.height,
    });
  }

  zoom(): number;
  zoom(scale: number, center?: Point, glide?: boolean): number;
  zoom(scale?: number, center?: Point, glide = false): number {
    if (scale === undefined) return this.getViewbox().scale;
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    // A glide under way zooms about where it is going.
    const box = glide ? this.goal ?? this.box : this.box;
    const cx = center?.x ?? box.x + box.width / 2;
    const cy = center?.y ?? box.y + box.height / 2;
    const newWidth = this.clientWidth() / clamped;
    const newHeight = this.clientHeight() / clamped;
    const relX = (cx - box.x) / box.width;
    const relY = (cy - box.y) / box.height;
    this.moveTo({ x: cx - relX * newWidth, y: cy - relY * newHeight, width: newWidth, height: newHeight }, glide);
    return clamped;
  }

  /** The scale the camera shows at, or is gliding to. */
  destinedZoom(): number {
    const box = this.goal;
    if (!box) return this.zoom();
    return Math.min(this.clientWidth() / box.width, this.clientHeight() / box.height);
  }

  pan(dx: number, dy: number): void {
    this.moveTo({ ...this.box, x: this.box.x - dx, y: this.box.y - dy });
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

  /**
   * The part of the view the host's UI leaves free, in CSS pixels from the view's top left. Insets that would leave
   * nothing along an axis are ignored along it.
   */
  private free(): { left: number; top: number; width: number; height: number } {
    const width = this.clientWidth();
    const height = this.clientHeight();
    const { top = 0, right = 0, bottom = 0, left = 0 } = this.insets?.() ?? {};
    const across = width - left - right > 0;
    const down = height - top - bottom > 0;
    return {
      left: across ? left : 0,
      top: down ? top : 0,
      width: across ? width - left - right : width,
      height: down ? height - top - bottom : height,
    };
  }

  /**
   * Fit `bounds` with `padding` in the part of the view the host's UI leaves free, never magnifying past the UI scale;
   * the scale it lands on.
   */
  fitBounds(bounds: Bounds, padding = 40, glide = false): number {
    this.pendingFit = this.container.clientWidth > 0 && this.container.clientHeight > 0 ? undefined : { bounds, padding };
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const free = this.free();
    const scale = Math.min(free.width / (width + padding * 2), free.height / (height + padding * 2), uiScale());
    // The whole view at that scale, placed so the bounds sit centred in the free part.
    this.moveTo({
      x: bounds.x + width / 2 - (free.left + free.width / 2) / scale,
      y: bounds.y + height / 2 - (free.top + free.height / 2) / scale,
      width: this.clientWidth() / scale,
      height: this.clientHeight() / scale,
    }, glide);
    return scale;
  }

  /** How the browser maps the viewBox (`xMidYMid meet`): one scale, centred. */
  private rendering(): { rect: DOMRect; scale: number; ox: number; oy: number } {
    const rect = this.container.getBoundingClientRect();
    const width = rect.width || this.box.width;
    const height = rect.height || this.box.height;
    const scale = Math.min(width / this.box.width, height / this.box.height);
    return { rect, scale, ox: (width - this.box.width * scale) / 2, oy: (height - this.box.height * scale) / 2 };
  }

  /** The region of the diagram the view shows: the viewBox, widened to the view's own shape. */
  shown(): Bounds {
    const { rect, scale, ox, oy } = this.rendering();
    return { x: this.box.x - ox / scale, y: this.box.y - oy / scale, width: (rect.width || this.box.width) / scale, height: (rect.height || this.box.height) / scale };
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

  /** Pan the least that shows `bounds` whole, with `margin` screen pixels round it, in the part of the view left free. */
  bringIntoView(bounds: Bounds, margin = 20, glide = false): void {
    const { scale, ox, oy } = this.rendering();
    const free = this.free();
    // The free part, in diagram units.
    const left = this.box.x + (free.left - ox) / scale;
    const top = this.box.y + (free.top - oy) / scale;
    const right = left + free.width / scale;
    const bottom = top + free.height / scale;
    const room = margin / scale;
    const shift = (low: number, high: number, from: number, to: number): number =>
      low - room < from ? low - room - from : high + room > to ? high + room - to : 0;
    const dx = shift(bounds.x, bounds.x + bounds.width, left, right);
    const dy = shift(bounds.y, bounds.y + bounds.height, top, bottom);
    if (dx === 0 && dy === 0) return;
    this.moveTo({ ...this.box, x: this.box.x + dx, y: this.box.y + dy }, glide);
  }

  /** Centre `element` in the part of the view the host's UI leaves free, at the scale the view has. */
  scrollToElement(element: SceneElement, glide = false): void {
    const center = elementCenter(element);
    if (!center) return;
    const { scale, ox, oy } = this.rendering();
    const free = this.free();
    this.moveTo({
      ...this.box,
      x: center.x - (free.left + free.width / 2 - ox) / scale,
      y: center.y - (free.top + free.height / 2 - oy) / scale,
    }, glide);
  }
}

function elementCenter(element: SceneElement): Point | undefined {
  if (element.kind !== 'edge') return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  const pts = element.waypoints;
  if (pts.length === 0) return undefined;
  const mid = pts[Math.floor(pts.length / 2)];
  return { x: mid.x, y: mid.y };
}
