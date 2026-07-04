/** Extract the studyflow XML embedded in an exported SVG's
 *  `<metadata><studyflow>` element; throws when absent. */
export function extractXmlFromSvg(svgText: string): string {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
  const studyflowEl = svgDoc.querySelector('metadata > studyflow');
  if (!studyflowEl) {
    throw new Error('The selected SVG file does not contain embedded Studyflow.');
  }
  return studyflowEl.innerHTML;
}

/** Filename without its extension. */
export const filenameStem = (filename: string): string => filename.replace(/\.[^/.]+$/, '');
