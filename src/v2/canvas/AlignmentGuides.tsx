/**
 * AlignmentGuides — renders horizontal/vertical guide lines when the dragged
 * node's center aligns with another node's center.
 *
 * Must be rendered as a child of <ReactFlow> so it can use useViewport().
 */
import { useViewport } from '@xyflow/react';

export type Guide = {
  /** 'h' = horizontal line (shared Y), 'v' = vertical line (shared X). */
  type: 'h' | 'v';
  /** The shared axis position in flow coordinates. */
  flowPos: number;
  /** Line start in the perpendicular axis (flow coordinates). */
  flowFrom: number;
  /** Line end in the perpendicular axis (flow coordinates). */
  flowTo: number;
};

type Props = { guides: Guide[] };

export function AlignmentGuides({ guides }: Props) {
  const { x: vpX, y: vpY, zoom } = useViewport();

  if (guides.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: '100%', height: '100%', zIndex: 10 }}
    >
      {guides.map((g, i) => {
        if (g.type === 'h') {
          const sy = g.flowPos * zoom + vpY;
          const sx1 = g.flowFrom * zoom + vpX;
          const sx2 = g.flowTo * zoom + vpX;
          return (
            <line
              key={i}
              x1={sx1} y1={sy}
              x2={sx2} y2={sy}
              stroke="#3b82f6"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          );
        } else {
          const sx = g.flowPos * zoom + vpX;
          const sy1 = g.flowFrom * zoom + vpY;
          const sy2 = g.flowTo * zoom + vpY;
          return (
            <line
              key={i}
              x1={sx} y1={sy1}
              x2={sx} y2={sy2}
              stroke="#3b82f6"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          );
        }
      })}
    </svg>
  );
}
