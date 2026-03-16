import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';

function GroupNodeComponent({ data, selected }: NodeProps) {
  const bo = data.businessObject as any;
  const label = (data.label as string) || bo?.name || '';
  const width = (data.width as number) || 300;
  const height = (data.height as number) || 200;

  return (
    <div
      className={[
        'relative rounded-lg border-2 border-dashed bg-stone-50/30',
        selected ? 'border-blue-500' : 'border-stone-400',
      ].join(' ')}
      style={{ width, height }}
    >
      {label && (
        <span className="absolute top-1 left-2 text-xs text-stone-500 font-medium">
          {label}
        </span>
      )}
    </div>
  );
}

export const GroupNode = memo(GroupNodeComponent);
