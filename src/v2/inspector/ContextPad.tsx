import { memo, useCallback, useState } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useModelerStore } from '../store';
import { useSelectedNode } from '../store/selectors';

const MORPH_OPTIONS: { label: string; icon: string; bpmnType: string }[] = [
  { label: 'Task',          icon: 'iconify bpmn--task-none',          bpmnType: 'bpmn:Task' },
  { label: 'User Task',     icon: 'iconify bpmn--task-user',          bpmnType: 'bpmn:UserTask' },
  { label: 'Service Task',  icon: 'iconify bpmn--task-service',       bpmnType: 'bpmn:ServiceTask' },
  { label: 'Script Task',   icon: 'iconify bpmn--task-script',        bpmnType: 'bpmn:ScriptTask' },
  { label: 'Manual Task',   icon: 'iconify bpmn--task-manual',        bpmnType: 'bpmn:ManualTask' },
  { label: 'Sub-Process',   icon: 'iconify bpmn--subprocess-expanded', bpmnType: 'bpmn:SubProcess' },
];


/**
 * Floating context pad that appears above the selected node.
 * Provides quick actions: delete, connect, append element.
 */
function ContextPadComponent() {
  const selectedNode = useSelectedNode();
  const removeElements = useModelerStore((s) => s.removeElements);
  const addElement = useModelerStore((s) => s.addElement);
  const morphElement = useModelerStore((s) => s.morphElement);
  const connectElements = useModelerStore((s) => s.connectElements);
  const connectingFromId = useModelerStore((s) => s.connectingFromId);
  const startConnecting = useModelerStore((s) => s.startConnecting);
  const cancelConnecting = useModelerStore((s) => s.cancelConnecting);
  const [morphOpen, setMorphOpen] = useState(false);
  const { getNode } = useReactFlow();
  const { x: vpX, y: vpY, zoom } = useViewport();

  const handleConnect = useCallback(() => {
    if (!selectedNode) return;
    if (connectingFromId === selectedNode.id) {
      cancelConnecting();
    } else {
      startConnecting(selectedNode.id);
    }
  }, [selectedNode, connectingFromId, startConnecting, cancelConnecting]);

  const handleDelete = useCallback(() => {
    if (!selectedNode) return;
    removeElements([selectedNode.id]);
  }, [selectedNode, removeElements]);

  const handleAppendTask = useCallback(() => {
    if (!selectedNode) return;
    const node = getNode(selectedNode.id);
    if (!node) return;
    const newX = node.position.x + (node.measured?.width ?? 100) + 60;
    const newY = node.position.y;
    const newId = addElement('bpmn:Task', { x: newX, y: newY });
    connectElements(selectedNode.id, newId);
  }, [selectedNode, getNode, addElement, connectElements]);

  const handleAppendEnd = useCallback(() => {
    if (!selectedNode) return;
    const node = getNode(selectedNode.id);
    if (!node) return;
    const newX = node.position.x + (node.measured?.width ?? 100) + 60;
    const newY = node.position.y + ((node.measured?.height ?? 80) / 2) - 18;
    const newId = addElement('bpmn:EndEvent', { x: newX, y: newY }, 'studyflow:EndEvent');
    connectElements(selectedNode.id, newId);
  }, [selectedNode, getNode, addElement, connectElements]);

  const handleAppendGateway = useCallback(() => {
    if (!selectedNode) return;
    const node = getNode(selectedNode.id);
    if (!node) return;
    const newX = node.position.x + (node.measured?.width ?? 100) + 60;
    const newY = node.position.y + ((node.measured?.height ?? 80) / 2) - 25;
    const newId = addElement('bpmn:ExclusiveGateway', { x: newX, y: newY });
    connectElements(selectedNode.id, newId);
  }, [selectedNode, getNode, addElement, connectElements]);

  if (!selectedNode) return null;
  if (connectingFromId === selectedNode.id) return null;

  const node = getNode(selectedNode.id);
  if (!node) return null;

  const padX = (node.position.x + (node.measured?.width ?? 100)) * zoom + vpX + 10;
  const padY = node.position.y * zoom + vpY - 10;

  const bpmnType = (selectedNode.data?.bpmnType as string) ?? '';
  const isMorphable = bpmnType.includes('Task') || bpmnType === 'bpmn:SubProcess';
  const currentMorphOption = MORPH_OPTIONS.find((o) => o.bpmnType === bpmnType);

  return (
    <div
      className="absolute z-50 flex flex-col gap-1 bg-white rounded-lg shadow-lg border border-stone-200 p-1"
      style={{
        transform: `translate(${padX}px, ${padY}px)`,
        pointerEvents: 'all',
      }}
    >
      <button
        type="button"
        title={connectingFromId === selectedNode.id ? 'Cancel connect' : 'Connect to…'}
        className={`w-7 h-7 flex items-center justify-center rounded ${
          connectingFromId === selectedNode.id
            ? 'bg-blue-100 text-blue-600'
            : 'hover:bg-stone-100 text-stone-600'
        }`}
        onClick={handleConnect}
      >
        <i className="text-[16px] bi bi-arrow-right" />
      </button>
      <div className="border-t border-stone-200 my-0.5" />
      <button
        type="button"
        title="Append Task"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-stone-100"
        onClick={handleAppendTask}
      >
        <i className="text-[16px] iconify bpmn--task-none text-stone-600" />
      </button>
      <button
        type="button"
        title="Append Gateway"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-stone-100"
        onClick={handleAppendGateway}
      >
        <i className="text-[16px] iconify bpmn--gateway-xor text-stone-600" />
      </button>
      <button
        type="button"
        title="Append End Event"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-stone-100"
        onClick={handleAppendEnd}
      >
        <i className="text-[16px] iconify bpmn--end-event-none text-stone-600" />
      </button>

      {isMorphable && (
        <>
          <div className="border-t border-stone-200 my-0.5" />
          <div className="relative">
            <button
              type="button"
              title="Change type…"
              className={`w-7 h-7 flex items-center justify-center rounded hover:bg-stone-100 ${morphOpen ? 'bg-stone-100' : ''}`}
              onClick={() => setMorphOpen((v) => !v)}
            >
              <i className={`text-[16px] ${currentMorphOption?.icon ?? 'iconify bpmn--task-none'} text-stone-600`} />
            </button>
            {morphOpen && (
              <div className="absolute left-8 top-0 bg-white border border-stone-200 rounded-lg shadow-lg py-1 z-60 min-w-36">
                {MORPH_OPTIONS.filter((o) => o.bpmnType !== bpmnType).map((opt) => (
                  <button
                    key={opt.bpmnType}
                    type="button"
                    className="w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-stone-100 text-stone-700"
                    onClick={() => { morphElement(selectedNode.id, opt.bpmnType); setMorphOpen(false); }}
                  >
                    <i className={`text-[14px] ${opt.icon} text-stone-500`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="border-t border-stone-200 my-0.5" />
      <button
        type="button"
        title="Delete"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-50"
        onClick={handleDelete}
      >
        <i className="text-[16px] bi bi-trash text-red-500" />
      </button>
    </div>
  );
}

export const ContextPad = memo(ContextPadComponent);
