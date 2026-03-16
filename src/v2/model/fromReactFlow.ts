/**
 * Sync React Flow node position changes back to the moddle DI layer.
 *
 * When users drag nodes in React Flow, positions need to be written
 * back to BPMNShape bounds so XML export reflects the new layout.
 */
import type { BpmnDocument } from './BpmnDocument';

/** Update DI bounds for a node after it has been dragged. */
export function syncNodePosition(
  doc: BpmnDocument,
  nodeId: string,
  position: { x: number; y: number },
): void {
  const shape = doc.findShape(nodeId);
  if (!shape?.bounds) return;

  shape.bounds.x = position.x;
  shape.bounds.y = position.y;
}

/** Update DI bounds dimensions for a node after it has been resized. */
export function syncNodeDimensions(
  doc: BpmnDocument,
  nodeId: string,
  dimensions: { width: number; height: number },
): void {
  const shape = doc.findShape(nodeId);
  if (!shape?.bounds) return;

  shape.bounds.width = dimensions.width;
  shape.bounds.height = dimensions.height;
}
