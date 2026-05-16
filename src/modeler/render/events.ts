import { drawIcon } from './utils';
import type { BpmnRenderer } from '../bpmn-js';

/** Render a bpmn:Event with optional overlay. */
export function drawEventWithIcon(
  parentNode: SVGElement,
  element: any,
  bpmnRenderer: BpmnRenderer,
): SVGElement {
  const circle = bpmnRenderer.handlers[element.type](parentNode, element);

  // TODO hardcoded icons, should be based on element type and attributes
  if (element.businessObject.get('redirectTo')) {
    drawIcon(parentNode, element, 'iconify fluent--arrow-exit-24-regular', 6, 6, 24);
  }
  if (element.businessObject.get('consentFormUri')) {
    drawIcon(parentNode, element, 'iconify fluent--shield-task-24-regular', 6, 6, 24);
  }
  return circle;
}
