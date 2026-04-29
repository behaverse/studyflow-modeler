import type { InternalNode } from '@xyflow/react';
import { Position } from '@xyflow/react';

/**
 * Find the point on a node's border closest to an external target point —
 * i.e. where the center→target line crosses the node boundary.
 * Small square nodes (events/gateways ≤ 56px) are treated as circles.
 */
export function getBorderPoint(
  node: InternalNode,
  toX: number,
  toY: number,
): { x: number; y: number; position: Position } {
  const { x, y } = node.internals.positionAbsolute;
  const width = node.measured?.width ?? 100;
  const height = node.measured?.height ?? 80;

  const cx = x + width / 2;
  const cy = y + height / 2;
  const dx = toX - cx;
  const dy = toY - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: cy, position: Position.Right };

  const isSquare = Math.abs(width - height) < 4 && width <= 56;
  const isDiamond = isSquare && node.type === 'gatewayNode';
  const isCircular = isSquare && !isDiamond;

  // Diamond shapes: the inner div is rotated 45°, so the visual tips are at
  // (width/2)*√2 from center — further out than the DOM bounding box radius.
  if (isDiamond) {
    const tipRadius = (width / 2) * Math.SQRT2;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const position = dx > 0 ? Position.Right : Position.Left;
      return { x: cx + (dx > 0 ? tipRadius : -tipRadius), y: cy, position };
    } else {
      const position = dy > 0 ? Position.Bottom : Position.Top;
      return { x: cx, y: cy + (dy > 0 ? tipRadius : -tipRadius), position };
    }
  }

  if (isCircular) {
    const radius = width / 2;
    // Snap to the nearest cardinal point (right / bottom / left / top)
    if (Math.abs(dx) >= Math.abs(dy)) {
      const position = dx > 0 ? Position.Right : Position.Left;
      return { x: cx + (dx > 0 ? radius : -radius), y: cy, position };
    } else {
      const position = dy > 0 ? Position.Bottom : Position.Top;
      return { x: cx, y: cy + (dy > 0 ? radius : -radius), position };
    }
  }

  const halfW = width / 2;
  const halfH = height / 2;
  const scaleX = halfW / Math.abs(dx);
  const scaleY = halfH / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);

  const position =
    scaleX <= scaleY
      ? dx > 0 ? Position.Right : Position.Left
      : dy > 0 ? Position.Bottom : Position.Top;

  return { x: cx + dx * scale, y: cy + dy * scale, position };
}
