import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  MarkerType,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useModelerStore } from './store';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { ContextPad } from './inspector/ContextPad';
import { downloadSchemas } from '../shared/downloadSchemas';
import { useTokenSimulation } from './simulation/useTokenSimulation';
import { TokenOverlay } from './simulation/TokenOverlay';
import { AlignmentGuides, type Guide } from './canvas/AlignmentGuides';
import { ConnectionPreview } from './canvas/ConnectionPreview';
import { ScopeBreadcrumb } from './canvas/ScopeBreadcrumb';

/** Threshold in flow-space pixels to trigger an alignment guide. */
const ALIGN_THRESHOLD = 5;


function ModelerCanvas() {
  const { screenToFlowPosition, setNodes, fitView } = useReactFlow();
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    isReady,
  } = useModelerStore();

  const { active: simActive, tokens, toggle: toggleSim } = useTokenSimulation(nodes, edges);
  const setSimActive = useModelerStore((s) => s.setSimActive);
  useEffect(() => { setSimActive(simActive); }, [simActive, setSimActive]);

  // Respond to store-driven toggle/reset-zoom requests
  const simToggleCount = useModelerStore((s) => s._simToggleCount);
  const resetZoomCount = useModelerStore((s) => s._resetZoomCount);
  const simToggleCountRef = useRef(simToggleCount);
  const resetZoomCountRef = useRef(resetZoomCount);
  useEffect(() => {
    if (simToggleCount !== simToggleCountRef.current) {
      simToggleCountRef.current = simToggleCount;
      toggleSim();
    }
  }, [simToggleCount, toggleSim]);
  useEffect(() => {
    if (resetZoomCount !== resetZoomCountRef.current) {
      resetZoomCountRef.current = resetZoomCount;
      fitView({ maxZoom: 0.9 });
    }
  }, [resetZoomCount, fitView]);
  // fitView when entering a subprocess scope
  const scopeId = useModelerStore((s) => s.scopeId);
  const exitScope = useModelerStore((s) => s.exitScope);
  useEffect(() => {
    fitView({ maxZoom: 0.9, duration: 300 });
  }, [scopeId, fitView]);

  const initializedRef = useRef(false);
  const [alignGuides, setAlignGuides] = useState<Guide[]>([]);
  const alignSnapRef = useRef<Record<string, { x: number; y: number }>>({});
  const [mouseFlowPos, setMouseFlowPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);

  const onNodeDrag = useCallback((_: React.MouseEvent, dragged: Node) => {
    const allNodes = useModelerStore.getState().nodes;
    const dw = (dragged.data.width as number) || (dragged.measured?.width ?? 100);
    const dh = (dragged.data.height as number) || (dragged.measured?.height ?? 80);
    const dcx = dragged.position.x + dw / 2;
    const dcy = dragged.position.y + dh / 2;

    const guides: Guide[] = [];
    let snapX: number | null = null;
    let snapY: number | null = null;

    for (const node of allNodes) {
      if (node.id === dragged.id) continue;
      const nw = (node.data.width as number) || (node.measured?.width ?? 100);
      const nh = (node.data.height as number) || (node.measured?.height ?? 80);
      const ncx = node.position.x + nw / 2;
      const ncy = node.position.y + nh / 2;

      if (Math.abs(dcy - ncy) < ALIGN_THRESHOLD) {
        if (snapY === null || Math.abs(dcy - ncy) < Math.abs(dcy - snapY)) snapY = ncy;
        guides.push({
          type: 'h',
          flowPos: ncy,
          flowFrom: Math.min(dcx, ncx) - 20,
          flowTo: Math.max(dcx, ncx) + 20,
        });
      }
      if (Math.abs(dcx - ncx) < ALIGN_THRESHOLD) {
        if (snapX === null || Math.abs(dcx - ncx) < Math.abs(dcx - snapX)) snapX = ncx;
        guides.push({
          type: 'v',
          flowPos: ncx,
          flowFrom: Math.min(dcy, ncy) - 20,
          flowTo: Math.max(dcy, ncy) + 20,
        });
      }
    }

    if (snapX !== null || snapY !== null) {
      const snapped = {
        x: snapX !== null ? snapX - dw / 2 : dragged.position.x,
        y: snapY !== null ? snapY - dh / 2 : dragged.position.y,
      };
      alignSnapRef.current[dragged.id] = snapped;
      setNodes((nds) =>
        nds.map((n) => (n.id === dragged.id ? { ...n, position: snapped } : n)),
      );
    } else {
      delete alignSnapRef.current[dragged.id];
    }

    setAlignGuides(guides);
  }, [setNodes]);

  const onNodeDragStop = useCallback((_: React.MouseEvent, dragged: Node) => {
    const snapped = alignSnapRef.current[dragged.id];
    const finalPos = snapped ?? dragged.position;

    if (snapped) {
      delete alignSnapRef.current[dragged.id];
    }
    setAlignGuides([]);

    // Group containment: find the topmost group that contains this node's center
    setNodes((nds) => {
      const dw = (dragged.data?.width as number) || (dragged.measured?.width ?? 100);
      const dh = (dragged.data?.height as number) || (dragged.measured?.height ?? 80);
      const dcx = finalPos.x + dw / 2;
      const dcy = finalPos.y + dh / 2;

      const groups = nds.filter(
        (n) => n.type === 'group' && n.id !== dragged.id,
      );

      let parentGroup: Node | null = null;
      for (const g of groups) {
        const gw = (g.data?.width as number) || (g.measured?.width ?? 200);
        const gh = (g.data?.height as number) || (g.measured?.height ?? 150);
        if (
          dcx >= g.position.x &&
          dcx <= g.position.x + gw &&
          dcy >= g.position.y &&
          dcy <= g.position.y + gh
        ) {
          parentGroup = g;
        }
      }

      return nds.map((n) => {
        if (n.id !== dragged.id) return n;
        if (parentGroup) {
          // Convert absolute position to relative
          const relX = finalPos.x - parentGroup.position.x;
          const relY = finalPos.y - parentGroup.position.y;
          return { ...n, position: snapped ? { x: relX, y: relY } : { x: relX, y: relY }, parentId: parentGroup.id, extent: 'parent' as const };
        }
        // Remove parentId if dragged outside all groups
        if (n.parentId) {
          return { ...n, position: finalPos, parentId: undefined, extent: undefined };
        }
        return snapped ? { ...n, position: finalPos } : n;
      });
    });
  }, [setNodes]);

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

  // Keyboard shortcuts for undo/redo and save
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
      } else if (e.key === 's') {
        e.preventDefault();
        useModelerStore.getState().saveFile();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Cancel connecting / inline editing on Escape; exit scope if inside a subprocess
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const state = useModelerStore.getState();
      if (state.connectingFromId) { state.cancelConnecting(); return; }
      if (state.editingNodeId) { state.setEditingNodeId(null); return; }
      if (state.scopeId) { exitScope(); }
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [exitScope]);


  const connectingFromId = useModelerStore((s) => s.connectingFromId);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const { connectingFromId: fromId } = useModelerStore.getState();
    if (fromId) useModelerStore.getState().connectTo(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    useModelerStore.getState().setEditingNodeId(null);
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!useModelerStore.getState().connectingFromId) return;
    setMouseFlowPos(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }, [screenToFlowPosition]);

  const onNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node) => {
    setHoverTargetId(node.id);
  }, []);

  const onNodeMouseLeave = useCallback(() => {
    setHoverTargetId(null);
  }, []);

  // Place element at viewport center via custom event (dispatched from Palette / SchemaPopupMenu)
  useEffect(() => {
    function handlePlaceElement(e: Event) {
      const { bpmnType, studyflowType } = (e as CustomEvent).detail ?? {};
      if (!bpmnType) return;
      const canvasEl = document.querySelector('[data-testid="modeler-canvas"]');
      const rect = canvasEl?.getBoundingClientRect();
      const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      const position = screenToFlowPosition({ x: cx, y: cy });
      useModelerStore.getState().addElement(bpmnType, position, studyflowType || undefined);
    }
    window.addEventListener('modeler:place-element', handlePlaceElement);
    return () => window.removeEventListener('modeler:place-element', handlePlaceElement);
  }, [screenToFlowPosition]);

  /** Handle drop from palette — create a new element at drop position. */
  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!event.dataTransfer) return;

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

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
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
    <div
      className="grow bg-amber-50"
      data-testid="modeler-canvas"
      style={{ cursor: connectingFromId ? 'crosshair' : undefined }}
    >

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onMouseMove={onMouseMove}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{
          type: 'floating',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#57534e', width: 16, height: 16 },
          style: { strokeWidth: 2 },
        }}
        snapToGrid
        snapGrid={[10, 10]}
        fitView
        fitViewOptions={{ maxZoom: 0.9 }}
        deleteKeyCode={['Backspace', 'Delete']}
        selectionKeyCode={null}
        multiSelectionKeyCode="Shift"
        elevateNodesOnSelect={false}
        className="h-full"
      >
        <Background gap={10} size={1} color="#d4d4d4" />
        <Controls position="bottom-right" />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          className="!bg-stone-100"
        />
        <ContextPad />
        <ScopeBreadcrumb />
        <AlignmentGuides guides={alignGuides} />
        {connectingFromId && (
          <ConnectionPreview
            sourceId={connectingFromId}
            hoverTargetId={hoverTargetId}
            mouseFlowPos={mouseFlowPos}
          />
        )}
      </ReactFlow>
      <TokenOverlay tokens={tokens} />
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
