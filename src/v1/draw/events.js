import { drawIcon } from './utils';

/**
 * Render a bpmn:EndEvent with optional studyflow overlay.
 */
export function drawEndEvent(parentNode, element, bpmnRenderer) {
  const circle = bpmnRenderer.handlers["bpmn:EndEvent"](parentNode, element);
  if (element.businessObject.get("hasRedirectUrl")) {
    drawIcon(parentNode, element, "iconify tabler--external-link", 4, 4, 28);
  }
  return circle;
}


/**
 * Render a bpmn:StartEvent with optional studyflow overlay.
 */
export function drawStartEvent(parentNode, element, bpmnRenderer) {
  const circle = bpmnRenderer.handlers["bpmn:StartEvent"](parentNode, element);
  if (element.businessObject.get("requiresConsent")) {
    drawIcon(parentNode, element, "iconify tabler--shield-lock", 3, 3, 30);
  }
  return circle;
}
