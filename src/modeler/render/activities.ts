import { getAttribute } from '@/lib/core/extensions';
import { BPMN_ICON_OVERRIDES } from '../constants';
import { drawIcon, drawIconText } from './utils';
import { drawMarkers } from './markers';
import type { BpmnRenderer } from '../bpmn-js';

/** Render an activity (Task, SubProcess, etc.) with its resolved icon and markers. */
export function drawActivity(
  parentNode: SVGElement,
  element: any,
  bpmnRenderer: BpmnRenderer,
  iconClass: string | undefined,
  preservePrimaryIcon: boolean = false,
): SVGElement {
  // Force generic Task rendering for any overridden type, or when no handler exists.
  const handlerType = (element.type in BPMN_ICON_OVERRIDES || !bpmnRenderer.handlers[element.type])
    ? 'bpmn:Task'
    : element.type;
  const activity = bpmnRenderer.handlers[handlerType](parentNode, element);

  let iconMarker: string | undefined;
  let iconSize = 24;
  if (getAttribute(element, 'instrument') === 'behaverse' && !preservePrimaryIcon) {
    const scene = getAttribute(element, 'scene')?.toUpperCase();
    iconMarker = scene === 'UNDEFINED' ? undefined : scene;
    if (iconMarker && iconMarker.length > 2) iconSize = 28;
  }

  drawIcon(parentNode, element, iconClass, 4, 4, iconSize);
  if (!preservePrimaryIcon) drawIconText(parentNode, element, iconMarker);
  drawMarkers(parentNode, element);
  return activity;
}
