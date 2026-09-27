import type { Editor } from '@modeler/editor/port';

/* A leaf: the projections reach this through `export/model.ts`, so nothing here may import the format catalog. */

/** The study's name: its root's, whatever a view is drilled into. */
export function getDiagramName(modeler: Editor): string | undefined {
  return modeler.study.root.name;
}

export function exportDiagramName(modeler: Editor): string {
  return getDiagramName(modeler) ?? 'diagram';
}
