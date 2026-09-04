import type { Editor } from '@modeler/editor/port';

/* A leaf: the projections reach this through `export/model.ts`, so nothing here may import the format catalog. */

export function getDiagramName(modeler: Editor): string | undefined {
  let root: any;
  try {
    root = modeler?.canvas.getRoot();
  } catch {
    root = undefined;
  }
  const name = root?.businessObject?.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

export function exportDiagramName(modeler: Editor): string {
  return getDiagramName(modeler) ?? 'diagram';
}
