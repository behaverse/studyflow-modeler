/**
 * Alignment snapping during a drag: the neighbours it may line up with, collected when it starts, the point or the
 * shape it pulls onto them, and the guide lines it draws while one holds. An axis no guide holds is the grid's.
 */

import type { GridAxes, Movable } from '@canvas/study/drag.ts';
import { append, create, remove } from '@canvas/render/svg.ts';
import type { Bounds, Point, Scene, SceneNode } from '@canvas/study/scene.ts';
import { collectSnapTargets, snapMove, snapPoint, type SnapTargets } from '@canvas/interaction/snapping.ts';
import type { Viewport } from '@canvas/view/viewport.ts';

/** What a drag snaps: a shape it moves (by its centre), or one point it moves (a resize corner, a bendpoint). */
interface SnapContext {
  targets: SnapTargets;
  bounds?: Bounds;
  point?: Point;
}

const UNSNAPPED: GridAxes = { x: true, y: true };

export class SnapLines {
  private readonly overlays: SVGGElement;
  private readonly viewport: Viewport;
  private context?: SnapContext;
  private lines?: SVGGElement;

  constructor(overlays: SVGGElement, viewport: Viewport) {
    this.overlays = overlays;
    this.viewport = viewport;
  }

  /** A move of `moving` begins: its lead shape's centre lines up with the others' centres. */
  beginMove(scene: Scene, scope: SceneNode | undefined, moving: readonly Movable[]): void {
    const lead = moving[0];
    if (!lead) return;
    this.context = {
      targets: collectSnapTargets(scene, scope, new Set(moving.map((el) => el.id)), 'mid'),
      bounds: { x: lead.x, y: lead.y, width: lead.width, height: lead.height },
    };
  }

  /** A drag of one point begins: it lines up with the other shapes' centres and edges, but those `exclude` names. */
  beginPoint(scene: Scene, scope: SceneNode | undefined, point: Point, exclude: ReadonlySet<string> = new Set()): void {
    this.context = { targets: collectSnapTargets(scene, scope, exclude, 'bounds'), point: { ...point } };
  }

  /** The drag pressed at `down` is at `point`: where alignment pulls it, and which axes are left to the grid. */
  snap(down: Point, point: Point): { point: Point; grid: GridAxes } {
    const ctx = this.context;
    const dx = point.x - down.x;
    const dy = point.y - down.y;
    if (ctx?.bounds) {
      const snapped = snapMove(ctx.bounds, dx, dy, ctx.targets);
      this.show(snapped.guideX, snapped.guideY);
      return { point: { x: down.x + snapped.dx, y: down.y + snapped.dy }, grid: { x: snapped.guideX === undefined, y: snapped.guideY === undefined } };
    }
    if (ctx?.point) {
      const moved = { x: ctx.point.x + dx, y: ctx.point.y + dy };
      const snapped = snapPoint(moved, ctx.targets);
      this.show(snapped.guideX, snapped.guideY);
      return {
        point: { x: point.x + (snapped.point.x - moved.x), y: point.y + (snapped.point.y - moved.y) },
        grid: { x: snapped.guideX === undefined, y: snapped.guideY === undefined },
      };
    }
    this.hide();
    return { point, grid: UNSNAPPED };
  }

  /** No drag snaps: the point as it is, and no guide. */
  unsnapped(point: Point): { point: Point; grid: GridAxes } {
    this.hide();
    return { point, grid: UNSNAPPED };
  }

  /** The drag is over. */
  end(): void {
    this.hide();
    this.context = undefined;
  }

  private show(x?: number, y?: number): void {
    if (x === undefined && y === undefined) {
      this.hide();
      return;
    }
    const box = this.viewport.getViewbox();
    if (!this.lines) this.lines = append(this.overlays, create('g', { class: 'sf-snap-lines' })) as SVGGElement;
    while (this.lines.firstChild) this.lines.removeChild(this.lines.firstChild);
    if (x !== undefined) append(this.lines, create('line', { class: 'sf-snap-line', x1: x, y1: box.y, x2: x, y2: box.y + box.height }));
    if (y !== undefined) append(this.lines, create('line', { class: 'sf-snap-line', x1: box.x, y1: y, x2: box.x + box.width, y2: y }));
  }

  private hide(): void {
    remove(this.lines);
    this.lines = undefined;
  }
}
