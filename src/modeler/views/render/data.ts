import { getStrokeColor } from 'bpmn-js/lib/draw/BpmnRenderUtil';
import { getCatalog } from '@/core/catalog';
import { SVG_ICON_PATHS } from '@/modeler/infra/constants';
import { colorToHex, drawIcon, drawSvgPaths } from '@/modeler/views/render/utils';
import { getAttribute } from '@/core/extensions';
import type { BpmnRenderer } from '@/modeler/infra/bpmn-js.d';

/** Render a bpmn:DataStoreReference (dataset) with optional format icon. */
export function drawDataStore(
  parentNode: SVGElement,
  element: any,
  bpmnRenderer: BpmnRenderer,
): SVGElement {
  const format = getAttribute(element, 'format');
  const formatEnum = getCatalog().enumOf('DatasetFormatEnum');
  const iconClass: string | undefined =
    formatEnum?.literals.find((lv) => lv.value === format)?.icon || undefined;

  const dataset = bpmnRenderer.handlers['bpmn:DataStoreReference'](parentNode, element);

  const strokeHex = colorToHex(getStrokeColor(element));
  const iconColor = strokeHex ? strokeHex + 'bb' : '#000000bb';

  // Inline SVG paths survive SVG export; iconify icons fall back to foreignObject.
  const svgDef = iconClass && SVG_ICON_PATHS[iconClass];
  if (svgDef) {
    drawSvgPaths(parentNode, svgDef, 4, 28, 42, 14, iconColor);
  } else if (iconClass) {
    drawIcon(parentNode, element, iconClass, 15, 27, 20, iconColor);
  }
  // FIXME this XY only works for BIDS, need a more robust way to position the dataset icon
  return dataset;
}
