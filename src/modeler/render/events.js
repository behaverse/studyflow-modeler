import { drawIcon } from './utils';

/**
 * Render a bpmn:Event with optional overlay.
 *
 * @param {any} parentNode
 * @param {any} element
 * @param {any} bpmnRenderer
 */
export function drawEventWithIcon(parentNode, element, bpmnRenderer) {
  const circle = bpmnRenderer.handlers[element.type](parentNode, element);

  //TODO hardcoded icons, should be based on element type and properties
  if (element.businessObject.get("redirectTo")) {
    drawIcon(parentNode, element, "iconify fluent--arrow-exit-24-regular", 6, 6, 24);
  }
  if (element.businessObject.get("consentFormUri")) {
    drawIcon(parentNode, element, "iconify fluent--shield-task-24-regular", 6, 6, 24);
  }
  return circle;
}
