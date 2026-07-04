import { getFillColor, getStrokeColor } from 'bpmn-js/lib/draw/BpmnRenderUtil';
import { append as svgAppend, create as svgCreate } from 'tiny-svg';
import { getAttribute } from '@/core/extensions';
import { CORNER_RADIUS, bandPath, choreographyBandHeight, fit, wrap } from '@/modeler/models/render/choreography';
import type { Styles } from '@/modeler/infra/bpmn-js.d';

/** Fill used for the non-initiating (receiving) participant band. */
const RECEIVING_BAND_FILL = '#ededed';

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
