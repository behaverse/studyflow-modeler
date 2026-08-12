import { COMPOUND_EXTENSIONS } from '@modeler/export/formats';
import type { Modeler } from '@modeler/bpmn/types';

export function getDiagramName(modeler: Modeler): string | undefined {
  const name = modeler?.get('canvas')?.getRootElement?.()?.businessObject?.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

export function extractXmlFromSvg(svgText: string): string {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
  const studyflowEl = svgDoc.querySelector('metadata > studyflow');
  if (!studyflowEl) {
    throw new Error('The selected SVG file does not contain embedded Studyflow.');
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
