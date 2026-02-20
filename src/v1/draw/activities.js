import { getStudyflowExtension } from '../extensionElements';
import { BPMN_ICON_OVERRIDES } from './constants';
import { drawIcon, drawIconText } from './utils';
import { drawMarkers } from './markers';

/**
 * Render a bpmn:Activity (Task, SubProcess, etc.) with studyflow icons and markers.
 * @param {string|undefined} sfIconClass - icon class resolved from the extension descriptor
 */
export function drawActivity(parentNode, element, bpmnRenderer, pkgEnums, sfIconClass) {
  const ext = getStudyflowExtension(element);
  let iconClass = sfIconClass || BPMN_ICON_OVERRIDES[element.type] || undefined;

  let activity;
  if (element.type in BPMN_ICON_OVERRIDES) {
    activity = bpmnRenderer.handlers['bpmn:Task'](parentNode, element);
  } else if (bpmnRenderer.handlers[element.type]) {
    activity = bpmnRenderer.handlers[element.type](parentNode, element);
  } else {
    activity = bpmnRenderer.handlers['bpmn:Task'](parentNode, element);
  }

  let iconSize = 24;
  let iconMarker = undefined;

  if (ext) {
    let instrument = ext.get("instrument");
    const instrumentEnum = pkgEnums.find(e => e.name === "InstrumentEnum");
    iconClass = instrumentEnum?.literalValues.find(lv => lv.value === instrument)?.icon || iconClass;

    if (instrument === "behaverse") {
      iconMarker = ext.get("behaverseTask")?.toUpperCase();
      if (iconMarker === "UNDEFINED") {
        iconMarker = undefined;
      }
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
  drawIconText(parentNode, element, iconMarker);
  drawMarkers(parentNode, element);
  return activity;
}
