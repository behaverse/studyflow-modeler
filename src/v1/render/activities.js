// @ts-check

import { getExtensionElement, getProperty } from '../extensions';
import { BPMN_ICON_OVERRIDES } from './constants';
import { drawIcon, drawIconText } from './utils';
import { drawMarkers } from './markers';

/**
 * Render a bpmn:Activity (Task, SubProcess, etc.) with studyflow icons and markers.
 *
 * @param {any} parentNode
 * @param {any} element
 * @param {any} bpmnRenderer
 * @param {Array<any>} pkgEnums
 * @param {string|undefined} sfIconClass     icon class resolved from the extension descriptor
 * @param {boolean} [preservePrimaryIcon]    when true, keep the resolved icon (e.g., schema example icon)
 */
export function drawActivity(parentNode, element, bpmnRenderer, pkgEnums, sfIconClass, preservePrimaryIcon = false) {

  let activity;
  if (element.type in BPMN_ICON_OVERRIDES || !bpmnRenderer.handlers[element.type]) {
    activity = bpmnRenderer.handlers['bpmn:Task'](parentNode, element);
  } else {
    // render as normal
    activity = bpmnRenderer.handlers[element.type](parentNode, element);
  }

  const ext = getExtensionElement(element);

  let iconClass = sfIconClass || BPMN_ICON_OVERRIDES[element.type] || undefined;
  let iconSize = 24;
  let iconMarker = undefined;
  const instrument = getProperty(element, 'instrument');
  const scene = getProperty(element, 'scene')?.toUpperCase();

  if (ext) {
    if (!preservePrimaryIcon) {
      const instrumentEnum = pkgEnums.find(e => e.name === "InstrumentEnum");
      iconClass = instrumentEnum?.literalValues.find(lv => lv.value === instrument)?.icon || iconClass;
    }

    if (instrument === "behaverse" && !preservePrimaryIcon) {
      iconMarker = (scene === "UNDEFINED") ? undefined : scene;
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
  }

  drawIcon(parentNode, element, iconClass, 4, 4, iconSize);
  if (!preservePrimaryIcon) {
    drawIconText(parentNode, element, iconMarker);
  }
  drawMarkers(parentNode, element);
  return activity;
}
