const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * The text of an SVG's `<studyflow>` (the modeler's export writes it in `<metadata>`), unescaped.
 * Read without a DOM, so the CLI reads what the modeler opens.
 */
export function extractStudyflowFromSvg(svg: string): string {
  const match = svg.match(/<studyflow(?:\s[^>]*)?>([\s\S]*?)<\/studyflow>/);
  if (!match) throw new Error('The SVG carries no studyflow.');
  return match[1].replace(
    /&(?:#x([\da-fA-F]+)|#(\d+)|(lt|gt|amp|quot|apos));/g,
    (_, hex, dec, name) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : ENTITIES[name]),
  );
}
