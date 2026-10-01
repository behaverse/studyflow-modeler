/**
 * The rubber band a shift-drag draws: the shapes it touches are shown as the selection while it is drawn, and
 * selected when it is released.
 */

import type { Selection } from '@canvas/interaction/selection.ts';
import { append, create, remove } from '@canvas/render/svg.ts';
import { nodesIntersecting, normalizeRect } from '@canvas/study/hit.ts';
import type { Bounds, Point, Scene, SceneNode } from '@canvas/study/scene.ts';

const between = (a: Point, b: Point): Bounds => normalizeRect({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });

export class Marquee {
  private readonly overlays: SVGGElement;
  private readonly selection: Selection;
  private rect?: SVGRectElement;

  constructor(overlays: SVGGElement, selection: Selection) {
    this.overlays = overlays;
    this.selection = selection;
  }

  /** Draw the band from `a` to `b`, and preview what it touches in the view drilled into `scope`; `add` keeps the
   * selection there is. */
  draw(a: Point, b: Point, scene: Scene | undefined, scope: SceneNode | undefined, add: boolean): void {
    const rect = between(a, b);
    if (!this.rect) this.rect = append(this.overlays, create('rect', { class: 'sf-marquee' })) as SVGRectElement;
    for (const [name, value] of Object.entries(rect)) this.rect.setAttribute(name, String(value));
    if (!scene) return;
    const enclosed = nodesIntersecting(scene, rect, scope);
    this.selection.previewSelection(add ? [...this.selection.get(), ...enclosed] : enclosed);
  }

  /** The band released from `a` to `b`: select what it touches. */
  select(a: Point, b: Point, scene: Scene, scope: SceneNode | undefined, add: boolean): void {
    this.selection.select(nodesIntersecting(scene, between(a, b), scope), add);
  }

  clear(): void {
    remove(this.rect);
    this.rect = undefined;
    this.selection.clearPreview();
  }
}
