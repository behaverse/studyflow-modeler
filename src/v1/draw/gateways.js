import { drawDiamond, drawIcon } from './utils';

/**
 * Render a bpmn:Gateway as a diamond with an optional studyflow icon.
 */
export function drawGateway(parentNode, element, iconClass, styles) {
  const gateway = drawDiamond(parentNode, element, {}, styles);
  drawIcon(parentNode, element, iconClass, 13, 13, 24);
  return gateway;
}
