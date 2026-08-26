import type { PortHandle } from '@modeler/editor/registry';
import { getDiagramName } from '@modeler/diagram/file';

export function exportDiagramName(modeler: PortHandle): string {
  return getDiagramName(modeler) ?? 'diagram';
}
