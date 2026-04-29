/**
 * Convert moddle definitions to React Flow nodes and edges.
 *
 * Walks the BPMN process flowElements and maps each to a React Flow
 * node or edge, using the DI layer (BPMNDiagram) for positions and bounds.
 */
import type { Node, Edge } from '@xyflow/react';
import type { BpmnDocument } from './BpmnDocument';

/** Default dimensions when DI bounds are missing. */
const DEFAULT_BOUNDS: Record<string, { width: number; height: number }> = {
  'bpmn:StartEvent':    { width: 36, height: 36 },
  'bpmn:EndEvent':      { width: 36, height: 36 },
  'bpmn:IntermediateThrowEvent': { width: 36, height: 36 },
  'bpmn:IntermediateCatchEvent': { width: 36, height: 36 },
  'bpmn:BoundaryEvent': { width: 36, height: 36 },
  'bpmn:Task':          { width: 100, height: 80 },
  'bpmn:SubProcess':    { width: 350, height: 200 },
  'bpmn:CallActivity':  { width: 100, height: 80 },
  'bpmn:ExclusiveGateway':  { width: 50, height: 50 },
  'bpmn:ParallelGateway':   { width: 50, height: 50 },
  'bpmn:InclusiveGateway':  { width: 50, height: 50 },
  'bpmn:ComplexGateway':    { width: 50, height: 50 },
  'bpmn:EventBasedGateway': { width: 50, height: 50 },
  'bpmn:DataStoreReference': { width: 50, height: 50 },
  'bpmn:DataObjectReference': { width: 36, height: 50 },
  'bpmn:Group': { width: 300, height: 200 },
};

/** Map a BPMN $type to a React Flow custom node type. */
function resolveNodeType(bpmnType: string): string {
  if (bpmnType.includes('Event')) return 'eventNode';
  if (bpmnType.includes('Gateway')) return 'gatewayNode';
  if (bpmnType.includes('DataStoreReference') || bpmnType.includes('DataObjectReference')) return 'dataStoreNode';
  if (bpmnType === 'bpmn:Group') return 'groupNode';
  // Tasks, SubProcesses, CallActivities
  return 'activityNode';
}

/** Check if a flow element is a connection (edge) rather than a shape (node). */
function isConnection(element: any): boolean {
  const type = element.$type;
  return type === 'bpmn:SequenceFlow'
    || type === 'bpmn:MessageFlow'
    || type === 'bpmn:Association';
}

/** Get default dimensions for a BPMN type. */
function getDefaultBounds(bpmnType: string): { width: number; height: number } {
  // Check exact match first, then partial matches
  if (DEFAULT_BOUNDS[bpmnType]) return DEFAULT_BOUNDS[bpmnType];

  if (bpmnType.includes('Event')) return { width: 36, height: 36 };
  if (bpmnType.includes('Gateway')) return { width: 50, height: 50 };
  if (bpmnType.includes('DataStore')) return { width: 50, height: 50 };

  // Default activity size
  return { width: 100, height: 80 };
}

/** Convert moddle definitions to React Flow nodes.
 * @param scope Optional scope BO (subprocess). Defaults to the root process.
 */
export function toReactFlowNodes(doc: BpmnDocument, scope?: any): Node[] {
  const target = scope ?? doc.getProcess();
  if (!target?.flowElements) return [];

  const nodes: Node[] = [];

  for (const element of target.flowElements) {
    if (isConnection(element)) continue;

    const shape = doc.findShape(element.id);
    const bounds = shape?.bounds;
    const defaults = getDefaultBounds(element.$type);

    nodes.push({
      id: element.id,
      type: resolveNodeType(element.$type),
      zIndex: element.$type === 'bpmn:Group' ? 0 : 1,
      ...(element.$type === 'bpmn:Group' && {
        style: {
          width: bounds?.width ?? defaults.width,
          height: bounds?.height ?? defaults.height,
          pointerEvents: 'none' as const,
        },
        dragHandle: '.group-drag-handle',
      }),
      position: {
        x: bounds?.x ?? 0,
        y: bounds?.y ?? 0,
      },
      data: {
        businessObject: element,
        label: element.name ?? '',
        bpmnType: element.$type,
        width: bounds?.width ?? defaults.width,
        height: bounds?.height ?? defaults.height,
      },
      style: {
        width: bounds?.width ?? defaults.width,
        height: bounds?.height ?? defaults.height,
      },
    });
  }

  return nodes;
}

/** Convert moddle definitions to React Flow edges.
 * @param scope Optional scope BO (subprocess). Defaults to the root process.
 */
export function toReactFlowEdges(doc: BpmnDocument, scope?: any): Edge[] {
  const target = scope ?? doc.getProcess();
  if (!target?.flowElements) return [];

  const edges: Edge[] = [];

  for (const element of target.flowElements) {
    if (!isConnection(element)) continue;

    const sourceId = element.sourceRef?.id;
    const targetId = element.targetRef?.id;
    if (!sourceId || !targetId) continue;

    // Extract DI waypoints as bend points (skip first/last which are anchors)
    const diEdge = doc.findEdge(element.id);
    const rawWaypoints: { x: number; y: number }[] = (diEdge?.waypoint ?? [])
      .map((wp: any) => ({ x: wp.x, y: wp.y }));
    // First and last waypoints are source/target anchors — keep only interior bends
    const waypoints = rawWaypoints.length > 2 ? rawWaypoints.slice(1, -1) : [];

    edges.push({
      id: element.id,
      source: sourceId,
      target: targetId,
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'floating',
      style: { strokeWidth: 2 },
      label: element.name ?? '',
      data: {
        businessObject: element,
        bpmnType: element.$type,
        waypoints,
      },
    });
  }

  return edges;
}
