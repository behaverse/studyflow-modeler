import { getProperty } from '@/lib/core/extensions';
import { BPMN_ICON_OVERRIDES } from '../constants';
import { drawIcon, drawIconText } from './utils';
import { drawMarkers } from './markers';
import type { BpmnRenderer } from '../bpmn-js';

/**
 * Render a bpmn:Activity (Task, SubProcess, etc.) with studyflow icons and markers.
 *
 * `sfIconClass` is the icon class resolved from the extension descriptor.
 * `preservePrimaryIcon` keeps the resolved icon (e.g. schema template icon)
 * even when other markers would normally override it.
 */
export function drawActivity(
  parentNode: SVGElement,
  element: any,
  bpmnRenderer: BpmnRenderer,
  _pkgEnums: any[],
  sfIconClass: string | undefined,
  preservePrimaryIcon: boolean = false,
): SVGElement {
  let activity: SVGElement;
  if (element.type in BPMN_ICON_OVERRIDES || !bpmnRenderer.handlers[element.type]) {
    activity = bpmnRenderer.handlers['bpmn:Task'](parentNode, element);
  } else {
    // render as normal
    activity = bpmnRenderer.handlers[element.type](parentNode, element);
  }

  const iconClass = sfIconClass || BPMN_ICON_OVERRIDES[element.type] || undefined;
  let iconSize = 24;
  let iconMarker: string | undefined;
  const instrument = getProperty(element, 'instrument');
  const scene = getProperty(element, 'scene')?.toUpperCase();

  if (instrument === 'behaverse' && !preservePrimaryIcon) {
    iconMarker = scene === 'UNDEFINED' ? undefined : scene;
    switch (iconMarker?.length) {
      case undefined:
      case 2:
        iconSize = 24;
        break;
      default:
        iconSize = 28;
        break;
    }
  }

  drawIcon(parentNode, element, iconClass, 4, 4, iconSize);
  if (!preservePrimaryIcon) {
    drawIconText(parentNode, element, iconMarker);
  }
  drawMarkers(parentNode, element);
  return activity;
}
