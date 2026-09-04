/**
 * A resolved icon glyph: the body of an `<svg>` plus the viewBox it is drawn in.
 * Fetched by `export/iconSource.ts` and cached by `draw/iconCache.ts`, which hands
 * it to the canvas renderer — so glyphs are drawn INTO the scene and an exported SVG
 * needs no icon substitution pass at all.
 */
export type IconSvg = { content: string; viewBox: string };

export interface IconSource {
  resolve(iconClass: string): Promise<IconSvg | null>;
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

/** The pixel size a padded export SVG declares: its `width`/`height`, else its viewBox. */
function svgSize(svg: string): { width: number; height: number } | undefined {
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('svg');
  if (!el) return undefined;

  const declared = (['width', 'height'] as const).map((name) => Number(el.getAttribute(name)));
  if (declared.every((value) => Number.isFinite(value) && value > 0)) {
    return { width: declared[0], height: declared[1] };
  }

  const box = (el.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (box.length === 4 && box.slice(2).every((value) => Number.isFinite(value) && value > 0)) {
    return { width: box[2], height: box[3] };
  }
  return undefined;
}

/** Load an SVG string as an `<img>` through a blob URL, revoking it either way. */
function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const image = new Image();
  return new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('the diagram SVG could not be rasterized'));
    image.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

/**
 * Rasterize the diagram SVG to a PNG data URL, natively: the browser already knows
 * how to draw an SVG image, so the document goes through a blob URL into an `<img>`
 * and onto a 2d canvas. This replaced Canvg, which existed to
 * paint icons the browser could not, back when they were `foreignObject`s; the
 * renderer now draws real glyphs, so plain `drawImage` covers the whole document.
 */
export async function exportToPng(svg: string): Promise<string> {
  const padded = padSvg(svg);
  const image = await loadSvgImage(padded);

  // An SVG image's intrinsic size is only reliable when the document declares one;
  // the padded root always does, and the viewBox is the fallback for anything else.
  const size = svgSize(padded)
    ?? (image.naturalWidth > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : undefined);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(size?.width ?? image.width));
  canvas.height = Math.max(1, Math.round(size?.height ?? image.height));

  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  // White background under the rendered SVG so transparent areas don't appear black.
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/png');
}
