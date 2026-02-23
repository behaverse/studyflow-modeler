import { is } from "bpmn-js/lib/util/ModelUtil";
import { getStudyflowExtension } from '../extensionElements';
import { BPMN_ICON_OVERRIDES } from './constants';
import { drawIcon, removeDefaultMarkers } from './utils';

/**
 * Draw bottom-of-task markers (subprocess, loop, parallel, etc.).
 */
export function drawMarkers(parentNode, element) {
  const businessObject = element.businessObject;
  const ext = getStudyflowExtension(element);
  let markers = [];
  removeDefaultMarkers(parentNode);

  if (businessObject.get("isDataOperation")) {
    markers.push("operation");
  }

  const checklist = ext?.get("checklist") || businessObject.get("checklist");
  if (checklist?.length > 0) {
    markers.push("checklist");
  }

  if (is(element, 'bpmn:SubProcess')) {
    if (!element.di.isExpanded) {
      markers.push("subprocess");
    }
  }

  if (is(element, 'bpmn:AdHocSubProcess')) {
    markers.push("adhoc");
  }

  if (businessObject.get('isForCompensation')) {
    markers.push("compensation");
  }

  const loopCharacteristics = businessObject.get('loopCharacteristics');
  if (loopCharacteristics) {
    if (loopCharacteristics.get('isSequential') === true) {
      markers.push("sequential");
    } else if (loopCharacteristics.get('isSequential') === false) {
      markers.push("parallel");
    } else if (loopCharacteristics.get('isSequential') === undefined) {
      markers.push("loop");
    }
  }

  markers = markers.sort((a, b) => a.localeCompare(b));

  // TODO show subprocess marker always in the center, and other markers on the left/right side of it

  const gapX = 0;
  const gapY = 4;
  const markerSize = 20;
  const markerY = element.height - markerSize - gapY;
  const offsetX = (element.width - (markers.length * (markerSize + gapX))) / 2;
  markers.forEach((marker, index) => {
    const markerX = offsetX + index * (markerSize + gapX);
    const markerIcon = BPMN_ICON_OVERRIDES[marker];
    drawIcon(parentNode, element, markerIcon, markerX, markerY, markerSize);
  });
}
