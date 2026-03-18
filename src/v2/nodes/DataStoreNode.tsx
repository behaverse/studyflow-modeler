import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { resolveDataStoreIcon, isImageUrl } from './nodeUtils';
import { useModelerStore } from '../store';
import { PerimeterHandles } from './PerimeterHandles';

function DataStoreNodeComponent({ data, selected }: NodeProps) {
  const bo = data.businessObject as any;
  const label = (data.label as string) || bo?.name || '';
  const width = (data.width as number) || 50;
  const height = (data.height as number) || 50;
  const doc = useModelerStore((s) => s.document);
  const enumerations = doc?.getEnumerations() ?? [];
  const iconClass = resolveDataStoreIcon(bo, enumerations);

  return (
    <div
      className="flex flex-col items-center"
      style={{ width, minHeight: height, position: 'relative' }}
    >
      {/* Cylinder shape via SVG */}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
      >
        {/* Cylinder body */}
        <path
          d={`M 0 10 L 0 ${height - 5} Q 0 ${height} ${width / 2} ${height} Q ${width} ${height} ${width} ${height - 5} L ${width} 10`}
          fill="white"
          stroke={selected ? '#3b82f6' : '#292524'}
          strokeWidth={2}
        />
        {/* Top ellipse */}
        <ellipse
          cx={width / 2}
          cy={10}
          rx={width / 2}
          ry={10}
          fill="white"
          stroke={selected ? '#3b82f6' : '#292524'}
          strokeWidth={2}
        />
      </svg>

      {/* Format icon overlay */}
      {iconClass && (
        <div className="absolute" style={{ top: height / 2 - 10 }}>
          {isImageUrl(iconClass) ? (
            <img src={iconClass} alt="" className="w-5 h-5 object-contain opacity-70" />
          ) : (
            <i className={`text-[18px] text-stone-500 ${iconClass}`} />
          )}
        </div>
      )}

      {/* Label below shape */}
      {label && (
        <span className="mt-1 text-[10px] text-center text-stone-700 leading-tight max-w-[80px] break-words">
          {label}
        </span>
      )}

      <PerimeterHandles />
    </div>
  );
}

export const DataStoreNode = memo(DataStoreNodeComponent);
