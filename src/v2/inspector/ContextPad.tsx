import { memo, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useModelerStore } from '../store';
import { useSelectedNode } from '../store/selectors';

/**
 * Floating context pad that appears above the selected node.
 * Provides quick actions: delete, connect, append element.
 */
function ContextPadComponent() {
  const selectedNode = useSelectedNode();
  const removeElements = useModelerStore((s) => s.removeElements);
  const addElement = useModelerStore((s) => s.addElement);
  const doc = useModelerStore((s) => s.document);
  const { getNode } = useReactFlow();

  const handleDelete = useCallback(() => {
    if (!selectedNode) return;
    removeElements([selectedNode.id]);
  }, [selectedNode, removeElements]);

  const handleAppendTask = useCallback(() => {
    if (!selectedNode || !doc) return;
    const node = getNode(selectedNode.id);
    if (!node) return;

    const newX = node.position.x + (node.measured?.width ?? 100) + 60;
    const newY = node.position.y;
    const newId = addElement('bpmn:Task', { x: newX, y: newY });

    // Create sequence flow from selected to new
    const process = doc.getProcess();
    const sourceBO = process?.flowElements?.find((el: any) => el.id === selectedNode.id);
    const targetBO = process?.flowElements?.find((el: any) => el.id === newId);
    if (sourceBO && targetBO) {
      doc.addSequenceFlow(sourceBO, targetBO);
      useModelerStore.getState().refreshFromModel();
    }
  }, [selectedNode, doc, getNode, addElement]);

  const handleAppendEnd = useCallback(() => {
    if (!selectedNode || !doc) return;
    const node = getNode(selectedNode.id);
    if (!node) return;

    const newX = node.position.x + (node.measured?.width ?? 100) + 60;
    const newY = node.position.y + ((node.measured?.height ?? 80) / 2) - 18;
    const newId = addElement('bpmn:EndEvent', { x: newX, y: newY }, 'studyflow:EndEvent');

    const process = doc.getProcess();
    const sourceBO = process?.flowElements?.find((el: any) => el.id === selectedNode.id);
    const targetBO = process?.flowElements?.find((el: any) => el.id === newId);
    if (sourceBO && targetBO) {
      doc.addSequenceFlow(sourceBO, targetBO);
      useModelerStore.getState().refreshFromModel();
    }
  }, [selectedNode, doc, getNode, addElement]);

  if (!selectedNode) return null;

  const node = getNode(selectedNode.id);
  if (!node) return null;

  const padX = node.position.x + (node.measured?.width ?? 100) + 10;
  const padY = node.position.y - 10;

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
        title="Append Task"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-stone-100"
        onClick={handleAppendTask}
      >
        <i className="text-[16px] iconify bpmn--task-none text-stone-600" />
      </button>
      <button
        type="button"
        title="Append End Event"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-stone-100"
        onClick={handleAppendEnd}
      >
        <i className="text-[16px] iconify bpmn--end-event-none text-stone-600" />
      </button>
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
