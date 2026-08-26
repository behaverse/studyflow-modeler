import { COMPOUND_EXTENSIONS } from '@modeler/export/formats';
import { getEditorPort } from '@modeler/editor/registry';
import type { EditorHandle } from '@modeler/editor/registry';

export function getDiagramName(modeler: EditorHandle): string | undefined {
  const name = modeler ? getEditorPort(modeler).elements.root()?.businessObject?.name : undefined;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

export function extractXmlFromSvg(svgText: string): string {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
  const studyflowEl = svgDoc.querySelector('metadata > studyflow');
  if (!studyflowEl) {
    throw new Error('The SVG carries no studyflow. Export one from the modeler with "Studyflow embedded source" switched on.');
  }
  return studyflowEl.innerHTML;
}

/** Compound extensions count as one, read from the export catalog so a new format cannot drift. */
export const filenameStem = (filename: string): string => {
  const lower = filename.toLowerCase();
  const compound = COMPOUND_EXTENSIONS.find((extension) => lower.endsWith(extension.toLowerCase()));
  if (compound) return filename.slice(0, -compound.length);
  return filename.replace(/\.[^/.]+$/, '');
};
