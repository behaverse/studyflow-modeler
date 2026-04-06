/**
 * ConnectionPreview — renders a dashed arrow from the source node's border
 * to the mouse cursor (or to the target node's border when hovering one)
 * while the connect tool is active.
 *
 * Must be a child of <ReactFlow> to use useViewport / useInternalNode.
 */
import { useViewport, useInternalNode, getSmoothStepPath, getStraightPath, Position } from '@xyflow/react';
import { getBorderPoint } from '../edges/edgeUtils';

type Props = {
  sourceId: string;
  hoverTargetId: string | null;
  mouseFlowPos: { x: number; y: number } | null;
};

const opposite: Record<Position, Position> = {
  [Position.Right]: Position.Left,
  [Position.Left]: Position.Right,
  [Position.Bottom]: Position.Top,
  [Position.Top]: Position.Bottom,
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

  const { x: sx, y: sy, position: sourcePosition } = getBorderPoint(sourceNode, tx, ty);

  const targetPosition = (targetNode && hoverTargetId && hoverTargetId !== sourceId)
    ? getBorderPoint(targetNode, sx, sy).position
    : opposite[sourcePosition];

  const isStraight = Math.abs(sy - ty) < 1 || Math.abs(sx - tx) < 1;
  const directDist = Math.sqrt((tx - sx) ** 2 + (ty - sy) ** 2);
  const offset = Math.min(16, directDist * 0.2);

  const [previewPath] = isStraight
    ? getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty })
    : getSmoothStepPath({
        sourceX: sx,
        sourceY: sy,
        sourcePosition,
        targetX: tx,
        targetY: ty,
        targetPosition,
        borderRadius: 4,
        offset,
      });

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: '100%', height: '100%', zIndex: 10 }}
    >
      <defs>
        <marker
          id="preview-arrow"
          viewBox="0 0 16 16"
          refX="14.5"
          refY="8"
          markerWidth={16 / zoom}
          markerHeight={16 / zoom}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L0,16 L16,8 z" fill="#3b82f6" />
        </marker>
      </defs>
      <g transform={`translate(${vpX}, ${vpY}) scale(${zoom})`}>
        <path
          d={previewPath}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2 / zoom}
          strokeDasharray={`${6 / zoom} ${3 / zoom}`}
          markerEnd="url(#preview-arrow)"
        />
      </g>
    </svg>
  );
}
