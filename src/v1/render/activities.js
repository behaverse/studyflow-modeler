import { getStudyflowExtension } from '../extensionElements';
import { BPMN_ICON_OVERRIDES } from './constants';
import { drawIcon, drawIconText } from './utils';
import { drawMarkers } from './markers';

/**
 * Render a bpmn:Activity (Task, SubProcess, etc.) with studyflow icons and markers.
 * @param {string|undefined} sfIconClass - icon class resolved from the extension descriptor
 * @param {boolean} preservePrimaryIcon - when true, keep the resolved icon (e.g., schema example icon)
 */
export function drawActivity(parentNode, element, bpmnRenderer, pkgEnums, sfIconClass, preservePrimaryIcon = false) {

  let activity;
  if (element.type in BPMN_ICON_OVERRIDES || !bpmnRenderer.handlers[element.type]) {
    activity = bpmnRenderer.handlers['bpmn:Task'](parentNode, element);
  } else {
    // neither overridden, nor default renderer
    activity = bpmnRenderer.handlers[element.type](parentNode, element);
  }

  const ext = getStudyflowExtension(element);

  let iconClass = sfIconClass || BPMN_ICON_OVERRIDES[element.type] || undefined;
  let iconSize = 24;
  let iconMarker = undefined;

  if (ext) {
    const schemaPrefix = ext.$type?.split(':')?.[0];
    const schemaName = (prop) => schemaPrefix ? `${schemaPrefix}:${prop}` : prop;

    let instrument = ext.get("instrument") || ext.get(schemaName("instrument"));
    if (!preservePrimaryIcon) {
      const instrumentEnum = pkgEnums.find(e => e.name === "InstrumentEnum");
      iconClass = instrumentEnum?.literalValues.find(lv => lv.value === instrument)?.icon || iconClass;
    }

    if (instrument === "behaverse" && !preservePrimaryIcon) {
      const rawMarker =
        ext.get("behaverseTask")
        || ext.get(schemaName("behaverseTask"))
        || ext.get("scene")
        || ext.get(schemaName("scene"));
      iconMarker = rawMarker?.toUpperCase();
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
  if (!preservePrimaryIcon) {
    drawIconText(parentNode, element, iconMarker);
  }
  drawMarkers(parentNode, element);
  return activity;
}
