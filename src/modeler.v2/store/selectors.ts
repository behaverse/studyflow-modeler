import { useModelerStore } from './index';

/** Get the business object for the first selected node (or null). */
export function useSelectedBusinessObject() {
  return useModelerStore((state) => {
    if (state.selectedNodeIds.length !== 1) return null;
    const node = state.nodes.find((n) => n.id === state.selectedNodeIds[0]);
    return node?.data?.businessObject ?? null;
  });
}

/** Get the selected node (or null if none or multiple selected). */
export function useSelectedNode() {
  return useModelerStore((state) => {
    if (state.selectedNodeIds.length !== 1) return null;
    return state.nodes.find((n) => n.id === state.selectedNodeIds[0]) ?? null;
  });
}

/** Get the root process business object. */
export function useProcessBusinessObject() {
  return useModelerStore((state) => {
    return state.document?.getProcess() ?? null;
  });
}

/** Get the selected edge (or null if none or multiple selected). */
export function useSelectedEdge() {
  return useModelerStore((state) => {
    if (state.selectedEdgeIds.length !== 1) return null;
    return state.edges.find((e) => e.id === state.selectedEdgeIds[0]) ?? null;
  });
}
