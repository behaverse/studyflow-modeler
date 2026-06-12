import { is } from 'bpmn-js/lib/util/ModelUtil';
import { getAttribute } from '@/lib/core/extensions';
import { BPMN_ICON_OVERRIDES } from '../constants';
import { drawIcon, removeDefaultMarkers } from './utils';

/** Service/Script tasks already convey "data operation" via their schema icon; skip the bottom marker. */
function isServiceOrScriptDataOp(element: any): boolean {
  if (!getAttribute(element, 'isDataOperation')) return false;
  return is(element, 'bpmn:ServiceTask') || is(element, 'bpmn:ScriptTask');
}

/** Draw bottom-of-task markers (subprocess, loop, parallel, etc.). */
export function drawMarkers(parentNode: SVGElement, element: any): void {
  const markers: string[] = [];
  removeDefaultMarkers(parentNode);

  if (getAttribute(element, 'isDataOperation') && !isServiceOrScriptDataOp(element)) {
    markers.push('operation');
  }

  const checklist = getAttribute(element, 'checklist');
  if (checklist?.length > 0) {
    markers.push('checklist');
  }

  const uses = getAttribute(element, 'uses');
  if (typeof uses === 'string' && uses.trim()) {
    markers.push('binding');
  }

  if (is(element, 'bpmn:SubProcess') && !element.di.isExpanded) {
    markers.push('subprocess');
  }

  if (is(element, 'bpmn:AdHocSubProcess')) {
    markers.push('adhoc');
  }

  if (getAttribute(element, 'isForCompensation')) {
    markers.push('compensation');
  }

  const loopCharacteristics = getAttribute(element, 'loopCharacteristics');
  if (loopCharacteristics) {
    const isSequential = loopCharacteristics.get('isSequential');
    if (isSequential === true) markers.push('sequential');
    else if (isSequential === false) markers.push('parallel');
    else markers.push('loop');
  }

  // TODO show subprocess marker always in the center, and other markers on the left/right side of it

  const MARKER_SIZE = 20;
  const MARKER_GAP_Y = 4;
  const markerY = element.height - MARKER_SIZE - MARKER_GAP_Y;
  const offsetX = (element.width - markers.length * MARKER_SIZE) / 2;
  markers.forEach((marker, index) => {
    drawIcon(parentNode, element, BPMN_ICON_OVERRIDES[marker], offsetX + index * MARKER_SIZE, markerY, MARKER_SIZE);
  });
}
