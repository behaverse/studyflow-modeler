import { COMPOUND_EXTENSIONS } from '@modeler/export/formats';


/** The text `embedStudyflowIntoSvg` put in the SVG. */
export function extractStudyflowFromSvg(svgText: string): string {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
  const studyflowEl = svgDoc.querySelector('metadata > studyflow');
  if (!studyflowEl) {
    throw new Error('The SVG carries no studyflow.');
  }
  return studyflowEl.textContent ?? '';
}

/** Compound extensions count as one, read from the export catalog so a new format cannot drift. */
export const filenameStem = (filename: string): string => {
  const lower = filename.toLowerCase();
  const compound = COMPOUND_EXTENSIONS.find((extension) => lower.endsWith(extension.toLowerCase()));
  if (compound) return filename.slice(0, -compound.length);
  return filename.replace(/\.[^/.]+$/, '');
};
