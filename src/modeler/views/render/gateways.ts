import { drawIcon } from '@/modeler/views/render/utils';
import { append as svgAppend, create as svgCreate } from 'tiny-svg';
import { getFillColor, getStrokeColor } from 'bpmn-js/lib/draw/BpmnRenderUtil';
import type { Styles } from '@/modeler/infra/bpmn-js.d';

/** Draw a diamond (rhombus) shape - used for gateways. */
function drawDiamond(
  parentGfx: SVGElement,
  element: { width: number; height: number },
  styles: Styles,
): SVGElement {
  const { width, height } = element;
  const cx = width / 2;
  const cy = height / 2;
  const points = `${cx},0 ${width},${cy} ${cx},${height} 0,${cy}`;

  const svgAttributes = styles.computeStyle({}, {
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 2,
    stroke: getStrokeColor(element),
    fill: getFillColor(element),
  });

  const polygon = svgCreate('polygon', { ...svgAttributes, points });
  svgAppend(parentGfx, polygon);
  return polygon;
}

/** Render a bpmn:Gateway as a diamond with an optional studyflow icon. */
export function drawGateway(
  parentNode: SVGElement,
  element: any,
  iconClass: string | undefined,
  styles: Styles,
): SVGElement {
  const gateway = drawDiamond(parentNode, element, styles);
  drawIcon(parentNode, element, iconClass, 13, 13, 24);
  return gateway;
}
