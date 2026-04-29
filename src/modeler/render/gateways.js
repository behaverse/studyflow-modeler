// @ts-check

import { drawIcon } from './utils';
import {
  append as svgAppend, create as svgCreate
} from "tiny-svg";
import {getFillColor, getStrokeColor} from "bpmn-js/lib/draw/BpmnRenderUtil";


/**
 * Draw a diamond (rhombus) shape — used for gateways.
 *
 * @param {any} parentGfx
 * @param {{ width: number, height: number }} element
 * @param {Record<string, any>} attrs
 * @param {any} styles
 */
function drawDiamond(parentGfx, element, attrs, styles) {
  const width = element.width;
  const height = element.height;

  const x_2 = width / 2;
  const y_2 = height / 2;

  const points = [
    { x: x_2, y: 0 },
    { x: width, y: y_2 },
    { x: x_2, y: height },
    { x: 0, y: y_2 }
  ];

  const pointsString = points.map(point => point.x + ',' + point.y).join(' ');

  attrs = styles.computeStyle(attrs, {
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 2,
    stroke: getStrokeColor(element),
    fill: getFillColor(element)
  });

  const polygon = svgCreate('polygon', {
    ...attrs,
    points: pointsString
  });

  svgAppend(parentGfx, polygon);
  return polygon;
}

/**
 * Render a bpmn:Gateway as a diamond with an optional studyflow icon.
 *
 * @param {any} parentNode
 * @param {any} element
 * @param {string|undefined} iconClass
 * @param {any} styles
 */
export function drawGateway(parentNode, element, iconClass, styles) {
  const gateway = drawDiamond(parentNode, element, {}, styles);
  drawIcon(parentNode, element, iconClass, 13, 13, 24);
  return gateway;
}
