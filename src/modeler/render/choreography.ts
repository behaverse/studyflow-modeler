import { getFillColor, getStrokeColor } from 'bpmn-js/lib/draw/BpmnRenderUtil';
import { append as svgAppend, create as svgCreate } from 'tiny-svg';
import { getAttribute } from '@/lib/core/extensions';
import type { Styles } from '../bpmn-js';

/** BPMN element type; the studyflow trait contributes the band attributes. */
export const CHOREOGRAPHY_TASK_TYPE = 'bpmn:ChoreographyTask';

/** Nominal height of each participant band (shrinks for very short tasks). */
export const CHOREOGRAPHY_BAND_HEIGHT = 20;

/** Corner radius, matched to bpmn-js task shapes. */
const CORNER_RADIUS = 10;

/** Fill used for the non-initiating (receiving) participant band. */
const RECEIVING_BAND_FILL = '#ededed';

/** True when the element (djs shape or business object) is a choreography task. */
export function isChoreographyTask(element: any): boolean {
  const type = element?.type ?? element?.businessObject?.$type ?? element?.$type;
  return type === CHOREOGRAPHY_TASK_TYPE;
}

/** Actual band height for an element, clamped so the middle name band survives. */
export function choreographyBandHeight(element: { height: number }): number {
  return Math.min(CHOREOGRAPHY_BAND_HEIGHT, Math.floor(element.height / 3));
}

/** Truncate text to roughly fit `maxWidth` at `fontSize`, adding an ellipsis. */
function fit(text: string, maxWidth: number, fontSize: number): string {
  const perChar = fontSize * 0.58;
  const maxChars = Math.max(1, Math.floor((maxWidth - 8) / perChar));
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)).trimEnd() + '…';
}

/** Greedy word-wrap into at most `maxLines` lines; overflow is ellipsized. */
function wrap(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const perChar = fontSize * 0.58;
  const maxChars = Math.max(1, Math.floor((maxWidth - 8) / perChar));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
    const candidate = current ? `${current} ${words[i]}` : words[i];
    if (candidate.length <= maxChars || !current) {
      current = candidate;
      continue;
    }
    if (lines.length === maxLines - 1) {
      // Last permitted line: keep the rest so `fit` ellipsizes it below.
      current = `${current} ${words.slice(i).join(' ')}`;
      break;
    }
    lines.push(fit(current, maxWidth, fontSize));
    current = words[i];
  }
  if (current) lines.push(fit(current, maxWidth, fontSize));
  return lines;
}

/** Centered text line inside a band/region. */
function drawText(
  parentGfx: SVGElement,
  content: string,
  cx: number,
  cy: number,
  width: number,
  stroke: string,
  fontSize: number,
  fontWeight: string,
): void {
  const text = svgCreate('text', {
    x: cx,
    y: cy,
    fill: stroke,
    fontSize,
    fontWeight,
    fontFamily: '"IBM Plex Sans", Helvetica, sans-serif',
    strokeWidth: 0,
  });
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'middle');
  text.textContent = fit(content, width, fontSize);
  svgAppend(parentGfx, text);
}

/** Path for a horizontal band with rounded corners only on the outer edge. */
function bandPath(width: number, bandHeight: number, height: number, edge: 'top' | 'bottom'): string {
  const r = CORNER_RADIUS;
  if (edge === 'top') {
    return `M0,${bandHeight} L0,${r} Q0,0 ${r},0 L${width - r},0 Q${width},0 ${width},${r} L${width},${bandHeight} Z`;
  }
  const y = height - bandHeight;
  return `M0,${y} L${width},${y} L${width},${height - r} Q${width},${height} ${width - r},${height} L${r},${height} Q0,${height} 0,${height - r} Z`;
}

/**
 * Render a choreography task: an outer rounded rect with a participant band
 * top and bottom and the task name in the middle. The initiating participant's
 * band keeps the shape fill; the other band is shaded.
 */
export function drawChoreographyTask(
  parentGfx: SVGElement,
  element: any,
  styles: Styles,
): SVGElement {
  const { width, height } = element;
  const bandHeight = choreographyBandHeight(element);
  const stroke = getStrokeColor(element);
  const fill = getFillColor(element);

  const initiator = getAttribute(element, 'initiator') || 'top';
  const topName = getAttribute(element, 'topParticipant') || 'Participant A';
  const bottomName = getAttribute(element, 'bottomParticipant') || 'Participant B';
  const name = element.businessObject?.name || '';

  const outerStyle = styles.computeStyle({}, {
    stroke,
    fill,
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  });

  // Base shape (fills the middle name region).
  const outer = svgCreate('rect', {
    ...outerStyle,
    x: 0,
    y: 0,
    rx: CORNER_RADIUS,
    ry: CORNER_RADIUS,
    width,
    height,
  });
  svgAppend(parentGfx, outer);

  // Participant bands.
  const topFill = initiator === 'top' ? fill : RECEIVING_BAND_FILL;
  const bottomFill = initiator === 'bottom' ? fill : RECEIVING_BAND_FILL;

  const topBand = svgCreate('path', { d: bandPath(width, bandHeight, height, 'top'), fill: topFill, stroke: 'none' });
  const bottomBand = svgCreate('path', { d: bandPath(width, bandHeight, height, 'bottom'), fill: bottomFill, stroke: 'none' });
  svgAppend(parentGfx, topBand);
  svgAppend(parentGfx, bottomBand);

  // Band divider lines.
  for (const y of [bandHeight, height - bandHeight]) {
    const line = svgCreate('line', { x1: 0, y1: y, x2: width, y2: y, stroke, strokeWidth: 1 });
    svgAppend(parentGfx, line);
  }

  // Crisp border on top of the band fills.
  const border = svgCreate('rect', {
    x: 0,
    y: 0,
    rx: CORNER_RADIUS,
    ry: CORNER_RADIUS,
    width,
    height,
    fill: 'none',
    stroke,
    strokeWidth: 2,
  });
  svgAppend(parentGfx, border);

  // Text: participants in the bands, task name (wrapped) in the middle.
  drawText(parentGfx, topName, width / 2, bandHeight / 2, width, stroke, 11, '400');
  drawText(parentGfx, bottomName, width / 2, height - bandHeight / 2, width, stroke, 11, '400');
  if (name) {
    const lineHeight = 15;
    const middleHeight = height - 2 * bandHeight;
    const maxLines = Math.max(1, Math.min(3, Math.floor(middleHeight / lineHeight)));
    const lines = wrap(name, width, 12, maxLines);
    const firstY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      drawText(parentGfx, line, width / 2, firstY + i * lineHeight, width, stroke, 12, '600');
    });
  }

  return border;
}
