import type { Modeler } from '@modeler/bpmn/types';
import { getDiagramName } from '@modeler/diagram/file';

export function exportDiagramName(modeler: Modeler): string {
  return getDiagramName(modeler) ?? 'diagram';
}
