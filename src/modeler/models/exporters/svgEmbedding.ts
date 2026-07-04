import { Canvg } from 'canvg';

/** An icon's inner SVG plus its viewBox, as resolved for export embedding. */
export type IconSvg = { content: string; viewBox: string };

/** Injection point for resolving icon glyphs during export. Implementations
 *  (live Iconify fetch vs. offline no-op) live in the infra layer. */
export interface IconSource {
  /** Resolve an icon (e.g. `"i-ph--gear"`) to its inner SVG, or null if unknown. */
  resolve(iconClass: string): Promise<IconSvg | null>;
}

/** Replace `foreignObject.icon-container` placeholders in an exported SVG with
 *  inline `<svg>` glyphs resolved via `source`; unresolved icons are left as-is. */
export async function embedIconsInSvg(svgString: string, source: IconSource): Promise<string> {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
  const foreignObjects = svgDoc.querySelectorAll('foreignObject.icon-container');

  for (const foreignObject of foreignObjects) {
    const iconDiv = foreignObject.querySelector('div[data-icon-class], DIV[data-icon-class]');
    const iconClass = iconDiv?.getAttribute('data-icon-class');
    if (!iconClass) continue;

    const iconData = await source.resolve(iconClass);
    if (!iconData) continue;

    const color = iconDiv?.getAttribute('data-icon-color')
      || foreignObject.getAttribute('color')
      || foreignObject.getAttribute('style')?.match(/color:\s*([^;]+)/)?.[1];

    const iconSvg = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('x', foreignObject.getAttribute('x') || '0');
    iconSvg.setAttribute('y', foreignObject.getAttribute('y') || '0');
    iconSvg.setAttribute('width', foreignObject.getAttribute('width') || '24');
    iconSvg.setAttribute('height', foreignObject.getAttribute('height') || '24');
    iconSvg.setAttribute('viewBox', iconData.viewBox);
    iconSvg.setAttribute('stroke', 'none');
    iconSvg.innerHTML = color ? iconData.content.replace(/currentColor/g, color) : iconData.content;

    foreignObject.parentNode?.replaceChild(iconSvg, foreignObject);
  }

  return new XMLSerializer().serializeToString(svgDoc);
}

/** Embed the diagram's BPMN XML into the SVG under `<metadata><studyflow>` so a
 *  saved `.svg` round-trips back into the modeler. */
export function embedStudyflowIntoSvg(svg: string, xml: string): string {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
  const svgEl = svgDoc.querySelector('svg') || svgDoc.documentElement;

  const xmlClean = xml
    .replace(/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[\s\S]*?>\s*)?/i, '')
    .trim();

  const metadataEl = svgDoc.createElement('metadata');
  svgEl.insertBefore(metadataEl, svgEl.firstElementChild);

  const studyflowEl = svgDoc.createElement('studyflow');
  metadataEl.appendChild(studyflowEl);
  studyflowEl.innerHTML = xmlClean;

  return new XMLSerializer().serializeToString(svgDoc);
}

/** Rasterize an SVG string to a PNG data URL, flattening onto a white background. */
export async function exportToPng(svg: string): Promise<string> {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const canvg = Canvg.fromString(context, svg);
  await canvg.render();

  // White background under the rendered SVG so transparent areas don't appear black.
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/png');
}
