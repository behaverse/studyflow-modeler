import type { Modeler } from '@/modeler/bpmn/types';
import { getDiagramName } from '@/modeler/diagram/file';

export function exportDiagramName(modeler: Modeler): string {
  return getDiagramName(modeler) ?? 'diagram';
}

export function forEachBusinessObject(modeler: Modeler, visit: (bo: any, el: any) => void): void {
  const elementRegistry = modeler.get('elementRegistry');
  elementRegistry.forEach((el: any) => {
    if (el.type === 'label') return;
    const bo = el.businessObject;
    if (!bo) return;
    visit(bo, el);
  });
}
