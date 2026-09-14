/**
 * The BPMN XML an SVG carries: the `<definitions>` the modeler's export nests in its `<metadata>`.
 * Read without a DOM, so the CLI reads what the modeler opens.
 */
export function extractStudyflowFromSvg(svg: string): string {
  const match = svg.match(/<(\w+:)?definitions[\s>][\s\S]*<\/\1definitions>/);
  if (!match) throw new Error('The SVG carries no studyflow.');
  return match[0];
}
