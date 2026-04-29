import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { resolveIconClass, isImageUrl } from './nodeUtils';
import { useModelerStore } from '../store';
import { PerimeterHandles } from './PerimeterHandles';

function GatewayNodeComponent({ data, selected }: NodeProps) {
  const bo = data.businessObject as any;
  const size = (data.width as number) || 50;
  const typeMap = useModelerStore((s) => s.document?.getTypeMap() ?? {});
  const iconClass = resolveIconClass(bo, typeMap);

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* Diamond shape */}
      <div
        className={[
          'absolute inset-0 border-2 bg-white',
          selected ? 'border-blue-500' : 'border-stone-800',
        ].join(' ')}
        style={{ transform: 'rotate(45deg)' }}
      />

      {/* Icon centered */}
      <div className="relative z-10">
        {iconClass && (
          isImageUrl(iconClass) ? (
            <img src={iconClass} alt="" className="w-5 h-5 object-contain" />
          ) : (
            <i className={`text-[20px] text-stone-700 ${iconClass}`} />
          )
        )}
      </div>

      <PerimeterHandles />
    </div>
  );
}

export const GatewayNode = memo(GatewayNodeComponent);
