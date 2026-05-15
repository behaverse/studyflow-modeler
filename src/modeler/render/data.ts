import { getStrokeColor } from 'bpmn-js/lib/draw/BpmnRenderUtil';
import { SVG_ICON_PATHS } from '../constants';
import { colorToHex, drawIcon, drawSvgPaths } from './utils';
import { getProperty } from '@/lib/core/extensions';
import type { BpmnRenderer } from '../bpmn-js';

/** Render a bpmn:DataStoreReference (dataset) with optional format icon. */
export function drawDataStore(
  parentNode: SVGElement,
  element: any,
  bpmnRenderer: BpmnRenderer,
  pkgEnums: any[],
): SVGElement {
  const format = getProperty(element, 'format');
  const formatEnum = pkgEnums.find((e) => e.name === 'DatasetFormatEnum');
  const iconClass: string | undefined =
    formatEnum?.literalValues.find((lv: any) => lv.value === format)?.icon || undefined;

  const dataset = bpmnRenderer.handlers['bpmn:DataStoreReference'](parentNode, element);

  const strokeHex = colorToHex(getStrokeColor(element));
  const iconColor = strokeHex ? strokeHex + 'bb' : '#000000bb';

  // Use inline SVG paths for icons that need to survive SVG export;
  // fall back to foreignObject-based drawIcon for iconify icons.
  const svgDef = iconClass && SVG_ICON_PATHS[iconClass];
  if (svgDef) {
    drawSvgPaths(parentNode, svgDef, 4, 28, 42, 14, iconColor);
  } else if (iconClass) {
    drawIcon(parentNode, element, iconClass, 15, 27, 20, iconColor);
  }
  // FIXME this XY only works for BIDS, need a more robust way to position the dataset icon
  return dataset;
}
