/**
 * Moving the camera by hand: a drag on the background, the wheel (with `Ctrl`/`Cmd`, a zoom about the cursor), and a
 * two-finger pinch.
 */

import type { Point } from '@canvas/study/scene.ts';
import type { Viewport } from '@canvas/view/viewport.ts';

/** What one zoom step multiplies the scale by. */
export const ZOOM_STEP = 1.25;
const WHEEL_ZOOM = 0.002;

export class Pan {
  private readonly svg: SVGSVGElement;
  private readonly viewport: Viewport;
  private readonly container: () => HTMLElement;
  /** Where a drag last panned from, on screen. */
  private from?: Point;
  private readonly touches = new Map<number, Point>();
  private pinch?: { prevMid: Point; prevDist: number };

  constructor(svg: SVGSVGElement, viewport: Viewport, container: () => HTMLElement) {
    this.svg = svg;
    this.viewport = viewport;
    this.container = container;
  }

  get pinching(): boolean {
    return !!this.pinch;
  }

  /** Pan by a distance on screen. */
  by(dxScreen: number, dyScreen: number): void {
    const box = this.viewport.getViewbox();
    const rect = this.container().getBoundingClientRect();
    this.viewport.pan(dxScreen * (box.width / (rect.width || box.width)), dyScreen * (box.height / (rect.height || box.height)));
  }

  /** A drag on the background starts panning from `at`, on screen. */
  start(at: Point): void {
    this.from = { ...at };
    this.svg.classList.add('sf-panning');
  }

  /** The drag reached `at`: the view follows. */
  to(at: Point): void {
    const from = this.from ?? at;
    this.by(at.x - from.x, at.y - from.y);
    this.from = { ...at };
  }

  /** The drag or the pinch is over. */
  end(): void {
    this.from = undefined;
    this.pinch = undefined;
    this.svg.classList.remove('sf-panning');
  }

  /** Wheel pans; `Ctrl`/`Cmd`+wheel zooms about `at`, in diagram coordinates. */
  wheel(ev: WheelEvent, at: Point): void {
    const lines = ev.deltaMode !== 0 ? 16 : 1;
    const deltaX = (ev.deltaX ?? 0) * lines;
    const deltaY = (ev.deltaY ?? 0) * lines;
    if (ev.ctrlKey || ev.metaKey) {
      this.viewport.zoom(this.viewport.getViewbox().scale * Math.exp(-deltaY * WHEEL_ZOOM), at);
      return;
    }
    if (ev.shiftKey) this.by(-deltaY, 0);
    else this.by(-deltaX, -deltaY);
  }

  // --- touch ---------------------------------------------------------------------

  /** A finger down: `pinch` when it is the second, which the caller starts with {@link startPinch} once it has dropped
   * whatever the first began; `ignored` for a third. */
  touchDown(ev: PointerEvent): 'pinch' | 'ignored' | undefined {
    if (this.touches.size >= 2) return 'ignored';
    this.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    return this.touches.size === 2 ? 'pinch' : undefined;
  }

  startPinch(): void {
    const [a, b] = [...this.touches.values()];
    this.pinch = { prevMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, prevDist: Math.hypot(b.x - a.x, b.y - a.y) };
  }

  /** A finger moved: true when a pinch took it, zooming about the fingers' midpoint and panning with it. */
  touchMove(ev: PointerEvent): boolean {
    if (ev.pointerType === 'touch' && this.touches.has(ev.pointerId)) this.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const p = this.pinch;
    if (!p) return false;
    if (this.touches.size < 2) return true;
    const [a, b] = [...this.touches.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (p.prevDist > 0 && dist > 0) this.viewport.zoom(this.viewport.getViewbox().scale * (dist / p.prevDist), this.viewport.toDiagram(mid));
    this.by(mid.x - p.prevMid.x, mid.y - p.prevMid.y);
    this.pinch = { prevMid: mid, prevDist: dist };
    return true;
  }

  /** A finger up: `pinching` while a pinch keeps a finger down, `pinched` once its last is lifted. */
  touchUp(ev: PointerEvent): 'pinching' | 'pinched' | undefined {
    if (ev.pointerType === 'touch') this.touches.delete(ev.pointerId);
    if (!this.pinch) return undefined;
    return this.touches.size === 0 ? 'pinched' : 'pinching';
  }

  /** The pointer was taken away: every finger is up. */
  touchCancel(): void {
    this.touches.clear();
  }
}
