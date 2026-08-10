import { Canvg } from 'canvg';

export type IconSvg = { content: string; viewBox: string };

export interface IconSource {
  resolve(iconClass: string): Promise<IconSvg | null>;
}

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

/** Embed a draw.io `<mxfile>` document into the SVG root's `content` attribute — draw.io's "editable SVG" form. */
export function embedDrawioIntoSvg(svg: string, mxfileXml: string): string {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
  const svgEl = svgDoc.querySelector('svg') || svgDoc.documentElement;

  svgEl.setAttribute('content', mxfileXml.trim());

  return new XMLSerializer().serializeToString(svgDoc);
}

const EXPORT_PADDING = 8;

export function padSvg(svg: string, padding = EXPORT_PADDING): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const el = doc.querySelector('svg') ?? doc.documentElement;

  const box = (el.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) return svg;
  const [minX, minY, width, height] = box;
  el.setAttribute(
    'viewBox',
    `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`,
  );

  // width/height may carry a unit (`100%`, `620px`); only a bare number is ours to adjust.
  for (const [name, along] of [['width', width], ['height', height]] as const) {
    const declared = Number(el.getAttribute(name));
    el.setAttribute(name, String((Number.isFinite(declared) && declared > 0 ? declared : along) + padding * 2));
  }

  return new XMLSerializer().serializeToString(doc);
}

export async function exportToPng(svg: string): Promise<string> {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const canvg = Canvg.fromString(context, padSvg(svg));
  await canvg.render();

  // White background under the rendered SVG so transparent areas don't appear black.
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/png');
}
