import type { EditorHandle } from '@modeler/editor/registry';
import { getDiagramName } from '@modeler/diagram/file';

export function exportDiagramName(modeler: EditorHandle): string {
  return getDiagramName(modeler) ?? 'diagram';
}
