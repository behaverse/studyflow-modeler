import { getCatalog } from '@/lib/core/catalog';
import { getAttribute, StudyflowElement } from '@/lib/core/extensions';
import { drawIcon } from './utils';
import type { BpmnRenderer } from '../bpmn-js';

/**
 * Render a bpmn:Event with attribute-driven overlays: any instance attribute
 * that declares `meta.icon` in its schema draws that icon when it has a value
 * (e.g. `consentFormUri` on start events, `redirectTo` on end events).
 */
export function drawEventWithIcon(
  parentNode: SVGElement,
  element: any,
  bpmnRenderer: BpmnRenderer,
): SVGElement {
  const circle = bpmnRenderer.handlers[element.type](parentNode, element);

  const typeName = StudyflowElement.fromBusinessObject(element).extensionType ?? element.businessObject?.$type;
  for (const attr of getCatalog().instanceAttributesOf(typeName)) {
    const icon = attr.meta?.icon;
    if (typeof icon !== 'string' || !icon) continue;
    if (!getAttribute(element, attr.name)) continue;
    drawIcon(parentNode, element, icon, 6, 6, 24);
  }
  return circle;
}
