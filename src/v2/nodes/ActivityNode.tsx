import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { resolveIconClass, resolveSceneText, resolveMarkers, getMarkerIcon, isImageUrl } from './nodeUtils';
import { useModelerStore } from '../store';
import { PerimeterHandles } from './PerimeterHandles';

function ActivityNodeComponent({ data, selected }: NodeProps) {
  const bo = data.businessObject as any;
  const label = (data.label as string) || bo?.name || '';
  const width = (data.width as number) || 100;
  const height = (data.height as number) || 80;
  const doc = useModelerStore((s) => s.document);
  const typeMap = doc?.getTypeMap() ?? {};
  const enumerations = doc?.getEnumerations() ?? [];
  const iconClass = resolveIconClass(bo, typeMap, enumerations);
  const sceneText = resolveSceneText(bo);
  const markers = resolveMarkers(bo);

  return (
    <div
      className={[
        'relative flex flex-col rounded-lg border-2 bg-white overflow-hidden',
        selected ? 'border-blue-500 shadow-md' : 'border-stone-800',
      ].join(' ')}
      style={{ width, height }}
    >
      {/* Icon in top-left */}
      {iconClass && (
        <div className="absolute top-1 left-1.5">
          {isImageUrl(iconClass) ? (
            <img src={iconClass} alt="" className="w-5 h-5 object-contain" />
          ) : (
            <i className={`text-[18px] text-stone-600 ${iconClass}`} />
          )}
        </div>
      )}

      {/* Scene text overlay (for behaverse instruments) */}
      {sceneText && (
        <div className="absolute top-1 left-7 text-[10px] font-bold text-stone-500">
          {sceneText}
        </div>
      )}

      {/* Centered label */}
      <div className="flex-1 flex items-center justify-center px-2 py-1">
        <span className="text-xs text-center text-stone-800 leading-tight line-clamp-3 break-words">
          {label}
        </span>
      </div>

      {/* Bottom markers */}
      {markers.length > 0 && (
        <div className="flex items-center justify-center gap-0.5 pb-1">
          {markers.map((marker) => {
            const markerIcon = getMarkerIcon(marker);
            return markerIcon ? (
              <i key={marker} className={`text-[14px] text-stone-500 ${markerIcon}`} />
            ) : null;
          })}
        </div>
      )}

      <PerimeterHandles />
    </div>
  );
}

export const ActivityNode = memo(ActivityNodeComponent);
