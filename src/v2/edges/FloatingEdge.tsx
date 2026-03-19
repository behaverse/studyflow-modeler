/**
 * FloatingEdge — an edge that dynamically attaches to the closest point on
 * each node's boundary rather than a fixed handle position, then routes
 * orthogonally between the two attachment points.
 */
import {
  useInternalNode,
  getSmoothStepPath,
  getStraightPath,
  EdgeLabelRenderer,
  BaseEdge,
  type EdgeProps,
} from '@xyflow/react';
import { getBorderPoint } from './edgeUtils';

export function FloatingEdge({
  id,
  source,
  target,
  label,
  style,
  selected,
}: EdgeProps) {
  const color = selected ? '#3b82f6' : '#292524';
  const markerId = `arrow-${id}`;
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) return null;

  const sourceW = sourceNode.measured?.width ?? 100;
  const sourceH = sourceNode.measured?.height ?? 80;
  const targetW = targetNode.measured?.width ?? 100;
  const targetH = targetNode.measured?.height ?? 80;

  const sourceCX = sourceNode.internals.positionAbsolute.x + sourceW / 2;
  const sourceCY = sourceNode.internals.positionAbsolute.y + sourceH / 2;
  const targetCX = targetNode.internals.positionAbsolute.x + targetW / 2;
  const targetCY = targetNode.internals.positionAbsolute.y + targetH / 2;

  const { x: sx, y: sy, position: sourcePosition } = getBorderPoint(
    sourceNode,
    targetCX,
    targetCY,
  );
  const { x: tx, y: ty, position: targetPosition } = getBorderPoint(
    targetNode,
    sourceCX,
    sourceCY,
  );

  // Use a straight line only when attachment points share the same axis
  // (perfectly horizontal or vertical connection). Otherwise step orthogonally.
  const isStraight = Math.abs(sy - ty) < 1 || Math.abs(sx - tx) < 1;

  // Keep the exit offset proportional to the available space so nearby nodes
  // don't produce a zigzag from overshooting the midpoint.
  const directDist = Math.sqrt((tx - sx) ** 2 + (ty - sy) ** 2);
  const offset = Math.min(16, directDist * 0.2);

  const [edgePath, labelX, labelY] = isStraight
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
    <>
      <defs>
        <marker id={markerId} markerWidth="16" markerHeight="16" refX="14.5" refY="8" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L0,16 L16,8 z" fill={color} stroke="none" />
        </marker>
      </defs>
      <BaseEdge id={id} path={edgePath} markerEnd={`url(#${markerId})`} style={{ ...style, stroke: color }} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan text-xs bg-white px-1 rounded border border-stone-200 text-stone-600"
          >
            {label as string}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
