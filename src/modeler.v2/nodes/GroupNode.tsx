import { memo } from 'react';
import { type NodeProps, NodeResizer } from '@xyflow/react';
import { useModelerStore } from '../store';

function GroupNodeComponent({ id, data, selected }: NodeProps) {
  const bo = data.businessObject as any;
  const label = (data.label as string) || bo?.name || '';
  const setSelection = useModelerStore((s) => s.setSelection);

  return (
    // pointer-events:none on the container lets interior clicks fall through
    // to nodes behind the group.
    <div style={{ width: '100%', height: '100%', position: 'relative', pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto' }}>
        <NodeResizer
          isVisible={selected}
          minWidth={100}
          minHeight={60}
          lineClassName="!border-blue-400"
          handleClassName="!w-2 !h-2 !rounded-sm !bg-blue-400 !border-blue-600"
        />
      </div>

      {/* SVG border — pointer-events:stroke means only the line itself is clickable.
          group-drag-handle is the ReactFlow dragHandle selector. */}
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        <rect
          x="1"
          y="1"
          width="calc(100% - 2px)"
          height="calc(100% - 2px)"
          rx="8"
          ry="8"
          fill="none"
          strokeDasharray="6 4"
          stroke={selected ? '#3b82f6' : '#a8a29e'}
          strokeWidth="2"
          className="group-drag-handle"
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onClick={() => setSelection([id])}
        />
      </svg>

      {label && (
        <span
          className="group-drag-handle absolute top-1 left-2 text-xs text-stone-500 font-medium"
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
          onClick={() => setSelection([id])}
        >
          {label}
        </span>
      )}
    </div>
  );
}

export const GroupNode = memo(GroupNodeComponent);
