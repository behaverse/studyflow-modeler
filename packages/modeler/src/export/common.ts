import type { Editor } from '@modeler/editor/port';
import { getDiagramName } from '@modeler/diagram/file';

export function exportDiagramName(modeler: Editor): string {
  return getDiagramName(modeler) ?? 'diagram';
}
