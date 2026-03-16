import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { resolveIconClass, isImageUrl } from './nodeUtils';
import { getProperty } from '../../shared/extensionElements';
import { useModelerStore } from '../store';
import { PerimeterHandles } from './PerimeterHandles';

function EventNodeComponent({ data, selected }: NodeProps) {
  const bo = data.businessObject as any;
  const bpmnType = bo?.$type ?? '';
  const isEnd = bpmnType === 'bpmn:EndEvent';
  const isStart = bpmnType.includes('Start');
  const typeMap = useModelerStore((s) => s.document?.getTypeMap() ?? {});
  const iconClass = resolveIconClass(bo, typeMap);

  // Studyflow event overlays
  const hasRedirectUrl = getProperty(bo, 'hasRedirectUrl');
  const requiresConsent = getProperty(bo, 'requiresConsent');

  const size = (data.width as number) || 36;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* Circle background */}
      <div
        className={[
          'absolute inset-0 rounded-full bg-white',
          isEnd ? 'border-[3px]' : 'border-2',
          selected ? 'border-blue-500' : 'border-stone-800',
        ].join(' ')}
      />

      {/* Primary icon */}
      <div className="relative z-10">
        {iconClass && (
          isImageUrl(iconClass) ? (
            <img src={iconClass} alt="" className="w-4 h-4 object-contain" />
          ) : (
            <i className={`text-[14px] text-stone-700 ${iconClass}`} />
          )
        )}
      </div>

      {/* Overlay icons for studyflow event properties */}
      {hasRedirectUrl && (
        <div className="absolute -top-1 -right-1 z-20">
          <i className="text-[12px] text-blue-500 iconify tabler--external-link" />
        </div>
      )}
      {requiresConsent && (
        <div className="absolute -bottom-1 -right-1 z-20">
          <i className="text-[12px] text-amber-600 iconify fluent--shield-task-28-regular" />
        </div>
      )}

      <PerimeterHandles
        allowSource={!isEnd}
        allowTarget={!isStart}
      />
    </div>
  );
}

export const EventNode = memo(EventNodeComponent);
