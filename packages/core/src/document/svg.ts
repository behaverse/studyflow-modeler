const DEFINITIONS = /<(\w+:)?definitions[\s>][\s\S]*<\/\1definitions>/;

/**
 * The BPMN XML an SVG carries: the `<definitions>` the modeler's export nests in its `<metadata>`.
 * Read without a DOM, so the CLI reads what the modeler opens.
 */
export function extractStudyflowFromSvg(svg: string): string {
  const match = svg.match(DEFINITIONS);
  if (!match) throw new Error('The SVG carries no studyflow.');
  return match[0];
}

/** `svg`, a studyflow SVG, carrying the BPMN `xml` in place of the one it carried. */
export function replaceStudyflowInSvg(svg: string, xml: string): string {
  extractStudyflowFromSvg(svg);
  // The XML prolog belongs to a document, not to an element nested in the SVG's `<metadata>`.
  return svg.replace(DEFINITIONS, () => xml.replace(/^<\?xml[^>]*\?>\s*/, ''));
}
