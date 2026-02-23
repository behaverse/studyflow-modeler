import { drawIcon } from './utils';

/**
 * Render a bpmn:Event with optional studyflow overlay.
 */
export function drawEventWithIcon(parentNode, element, bpmnRenderer) {
  const circle = bpmnRenderer.handlers[element.type](parentNode, element);
  if (element.businessObject.get("hasRedirectUrl")) {
    drawIcon(parentNode, element, "iconify tabler--external-link", 4, 4, 28);
  }
  if (element.businessObject.get("requiresConsent")) {
    drawIcon(parentNode, element, "iconify tabler--shield-lock", 3, 3, 30);
  }
  return circle;
}
