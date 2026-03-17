/**
 * ConnectionPreview — renders a dashed arrow from the source node's border
 * to the mouse cursor (or to the target node's border when hovering one)
 * while the connect tool is active.
 *
 * Must be a child of <ReactFlow> to use useViewport / useInternalNode.
 */
import { useViewport, useInternalNode } from '@xyflow/react';
import { getBorderPoint } from '../edges/edgeUtils';

type Props = {
  sourceId: string;
  hoverTargetId: string | null;
  mouseFlowPos: { x: number; y: number } | null;
};

export function ConnectionPreview({ sourceId, hoverTargetId, mouseFlowPos }: Props) {
  const { x: vpX, y: vpY, zoom } = useViewport();
  const sourceNode = useInternalNode(sourceId);
  const targetNode = useInternalNode(hoverTargetId ?? '');

  if (!sourceNode || !mouseFlowPos) return null;

  const sourceW = sourceNode.measured?.width ?? 100;
  const sourceH = sourceNode.measured?.height ?? 80;
  const sourceCX = sourceNode.internals.positionAbsolute.x + sourceW / 2;
  const sourceCY = sourceNode.internals.positionAbsolute.y + sourceH / 2;

  // Target: snap to node border when hovering a node, otherwise follow cursor
  let tx: number, ty: number;
  if (targetNode && hoverTargetId && hoverTargetId !== sourceId) {
    const bp = getBorderPoint(targetNode, sourceCX, sourceCY);
    tx = bp.x;
    ty = bp.y;
  } else {
    tx = mouseFlowPos.x;
    ty = mouseFlowPos.y;
  }

  const { x: sx, y: sy } = getBorderPoint(sourceNode, tx, ty);

  const toScreen = (fx: number, fy: number) => ({
    x: fx * zoom + vpX,
    y: fy * zoom + vpY,
  });

  const s = toScreen(sx, sy);
  const t = toScreen(tx, ty);

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: '100%', height: '100%', zIndex: 10 }}
    >
      <defs>
        <marker
          id="preview-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
        </marker>
      </defs>
      <line
        x1={s.x} y1={s.y}
        x2={t.x} y2={t.y}
        stroke="#3b82f6"
        strokeWidth={2}
        strokeDasharray="6 3"
        markerEnd="url(#preview-arrow)"
      />
    </svg>
  );
}
