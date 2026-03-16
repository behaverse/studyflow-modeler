import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type DragEvent,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useModelerStore } from './store';
import { nodeTypes } from './nodes';
import { ContextPad } from './inspector/ContextPad';
import { downloadSchemas } from '../shared/downloadSchemas';
import { useTokenSimulation } from './simulation/useTokenSimulation';
import { TokenOverlay } from './simulation/TokenOverlay';

/** Marker definition for edge arrowheads. */
function ArrowMarker() {
  return (
    <svg className="absolute w-0 h-0">
      <defs>
        <marker
          id="arrowhead"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#57534e" />
        </marker>
      </defs>
    </svg>
  );
}

function ModelerCanvas() {
  const { screenToFlowPosition } = useReactFlow();
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    isReady,
  } = useModelerStore();

  const { active: simActive, tokens, toggle: toggleSim } = useTokenSimulation(nodes, edges);
  const initializedRef = useRef(false);

  // Initialize modeler on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    (async () => {
      try {
        const downloadedSchemas = await downloadSchemas();

        const diagramModule = await import('@/assets/new_diagram.bpmn');
        const diagramUrl = diagramModule.default;
        const xml = await fetch(diagramUrl).then((r) => r.text());

        await useModelerStore.getState().initialize(downloadedSchemas, xml);
      } catch (err) {
        console.error('Error initializing v2 modeler:', err);
      }
    })();
  }, []);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useModelerStore.getState().undo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        useModelerStore.getState().redo();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /** Handle drop from palette — create a new element at drop position. */
  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const bpmnType = event.dataTransfer.getData('application/bpmn-type');
      if (!bpmnType) return;

      const studyflowType =
        event.dataTransfer.getData('application/studyflow-type') || undefined;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      useModelerStore.getState().addElement(bpmnType, position, studyflowType);
    },
    [screenToFlowPosition],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  if (!isReady) {
    return (
      <div className="flex h-full text-center" data-testid="modeler-loading">
        <div
          role="status"
          className="m-auto animate-spin"
          aria-label="Loading modeler"
        >
          <span className="bi bi-arrow-repeat text-fuchsia-600 text-[3rem]" />
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grow bg-amber-50" data-testid="modeler-canvas">
      <ArrowMarker />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{
          type: 'default',
          markerEnd: 'url(#arrowhead)',
        }}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        selectionKeyCode={null}
        multiSelectionKeyCode="Shift"
        className="h-full"
      >
        <Background gap={20} size={1} color="#d4d4d4" />
        <Controls position="bottom-right" />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          className="!bg-stone-100"
        />
        <ContextPad />
      </ReactFlow>
      <TokenOverlay tokens={tokens} />
      <button
        type="button"
        title={simActive ? 'Stop simulation' : 'Start simulation'}
        className={`absolute top-2 right-2 z-20 rounded-full p-2 shadow-md transition-colors ${
          simActive
            ? 'bg-fuchsia-600 text-white hover:bg-fuchsia-700'
            : 'bg-white text-stone-600 hover:bg-stone-100'
        }`}
        onClick={toggleSim}
      >
        <i className={`bi ${simActive ? 'bi-stop-fill' : 'bi-play-fill'} text-lg`} />
      </button>
    </div>
  );
}

export function Modeler() {
  return (
    <ReactFlowProvider>
      <ModelerCanvas />
    </ReactFlowProvider>
  );
}
