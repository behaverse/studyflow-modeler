/**
 * PerimeterHandles — renders invisible zero-size handles that satisfy
 * ReactFlow's internal edge validation without being interactive.
 * Actual connection is done via the context-pad arrow tool (click-to-connect).
 */
import { Handle, Position } from '@xyflow/react';

type PerimeterHandlesProps = {
  allowSource?: boolean;
  allowTarget?: boolean;
};

const HIDDEN_STYLE: React.CSSProperties = {
  width: 0,
  height: 0,
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  background: 'transparent',
  pointerEvents: 'none',
};

export function PerimeterHandles({
  allowSource = true,
  allowTarget = true,
}: PerimeterHandlesProps) {
  return (
    <>
      {allowTarget && (
        <Handle
          id="target"
          type="target"
          position={Position.Left}
          isConnectable={false}
          style={HIDDEN_STYLE}
        />
      )}
      {allowSource && (
        <Handle
          id="source"
          type="source"
          position={Position.Right}
          isConnectable={false}
          style={HIDDEN_STYLE}
        />
      )}
    </>
  );
}
