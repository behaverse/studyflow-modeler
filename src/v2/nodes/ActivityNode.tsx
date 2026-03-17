import { memo, useRef, useState, useCallback } from 'react';
import { type NodeProps, NodeResizer } from '@xyflow/react';
import { resolveIconClass, resolveSceneText, resolveMarkers, getMarkerIcon, isImageUrl } from './nodeUtils';
import { useModelerStore } from '../store';
import { PerimeterHandles } from './PerimeterHandles';

function ActivityNodeComponent({ id, data, selected }: NodeProps) {
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
  const editingNodeId = useModelerStore((s) => s.editingNodeId);
  const setEditingNodeId = useModelerStore((s) => s.setEditingNodeId);
  const updateProperty = useModelerStore((s) => s.updateProperty);
  const enterScope = useModelerStore((s) => s.enterScope);
  const isEditing = editingNodeId === id;
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isSubProcess = bo?.$type === 'bpmn:SubProcess';

  const commitEdit = useCallback(() => {
    updateProperty(id, 'bpmn:name', editValue);
    setEditingNodeId(null);
  }, [id, editValue, updateProperty, setEditingNodeId]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSubProcess) {
      enterScope(id);
      return;
    }
    setEditValue(label);
    setEditingNodeId(id);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [id, label, isSubProcess, enterScope, setEditingNodeId]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <NodeResizer
        isVisible={selected}
        minWidth={60}
        minHeight={40}
        lineClassName="!border-blue-400"
        handleClassName="!w-2 !h-2 !rounded-sm !bg-blue-400 !border-blue-600"
      />
      <div
        onDoubleClick={handleDoubleClick}
        className={[
          'relative flex flex-col w-full h-full rounded-lg border-2 bg-white/30 overflow-hidden',
          selected ? 'border-blue-500 shadow-md' : 'border-stone-800',
        ].join(' ')}
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

      {/* Centered label / inline editor */}
      <div className="flex-1 flex items-center justify-center px-2 py-1">
        {isEditing ? (
          <input
            ref={inputRef}
            className="nodrag nopan w-full text-xs text-center text-stone-800 bg-white/80 rounded border border-blue-400 outline-none px-1"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
              if (e.key === 'Escape') { e.stopPropagation(); setEditingNodeId(null); }
            }}
          />
        ) : (
          <span className="text-xs text-center text-stone-800 leading-tight line-clamp-3 break-words">
            {label}
          </span>
        )}
      </div>

      {/* Bottom markers + subprocess drill-in indicator */}
      {(markers.length > 0 || isSubProcess) && (
        <div className="flex items-center justify-center gap-0.5 pb-1">
          {markers.map((marker) => {
            const markerIcon = getMarkerIcon(marker);
            return markerIcon ? (
              <i key={marker} className={`text-[14px] text-stone-500 ${markerIcon}`} />
            ) : null;
          })}
          {isSubProcess && (
            <i
              className="text-[14px] text-stone-400 iconify tabler--corner-right-down"
              title="Double-click to enter sub-process"
            />
          )}
        </div>
      )}

      <PerimeterHandles />
      </div>
    </div>
  );
}

export const ActivityNode = memo(ActivityNodeComponent);
