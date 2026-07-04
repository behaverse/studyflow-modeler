import { getAttribute } from '@/core/extensions';
import { BPMN_ICON_OVERRIDES } from '@/modeler/infra/constants';
import { drawIcon, drawIconText } from '@/modeler/views/render/utils';
import { drawMarkers } from '@/modeler/views/render/markers';
import type { BpmnRenderer } from '@/modeler/infra/bpmn-js.d';

/** Icon/text-marker box size (px) drawn on an activity; the larger size gives a
 *  longer scene abbreviation room to breathe. */
const ICON_SIZE = 24;
const ICON_SIZE_LARGE = 28;
/** Scene abbreviations longer than this switch to the larger marker size. */
const LONG_SCENE_LENGTH = 2;

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

  // Behaverse tasks show their scene abbreviation (e.g. "NB") as a text marker
  // instead of an icon — a display convention of that instrument, not schema data.
  let iconMarker: string | undefined;
  let iconSize = ICON_SIZE;
  if (getAttribute(element, 'instrument') === 'behaverse' && !preservePrimaryIcon) {
    const scene = getAttribute(element, 'scene')?.toUpperCase();
    iconMarker = scene === 'UNDEFINED' ? undefined : scene;
    if (iconMarker && iconMarker.length > LONG_SCENE_LENGTH) iconSize = ICON_SIZE_LARGE;
  }

  drawIcon(parentNode, element, iconClass, 4, 4, iconSize);
  if (!preservePrimaryIcon) drawIconText(parentNode, element, iconMarker);
  drawMarkers(parentNode, element);
  return activity;
}
