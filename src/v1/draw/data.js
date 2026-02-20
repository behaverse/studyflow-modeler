import { getStrokeColor } from "bpmn-js/lib/draw/BpmnRenderUtil";
import { SVG_ICON_PATHS } from './constants';
import { colorToHex, drawIcon, drawSvgPaths } from './utils';

/**
 * Render a bpmn:DataStoreReference (dataset) with optional format icon.
 */
export function drawDataStore(parentNode, element, bpmnRenderer, pkgEnums) {
  let format = element.businessObject.get("format");
  const formatEnum = pkgEnums.find(e => e.name === "DatasetFormatEnum");
  let iconClass = formatEnum?.literalValues.find(lv => lv.value === format)?.icon || undefined;

  const dataset = bpmnRenderer.handlers["bpmn:DataStoreReference"](parentNode, element);

  const strokeHex = colorToHex(getStrokeColor(element));
  const iconColor = strokeHex ? strokeHex + 'aa' : '#000000aa';

  // Use inline SVG paths for icons that need to survive SVG export;
  // fall back to foreignObject-based drawIcon for iconify icons.
  const svgDef = iconClass && SVG_ICON_PATHS[iconClass];
  if (svgDef) {
    drawSvgPaths(parentNode, svgDef, 4, 28, 42, 14, iconColor);
  } else if (iconClass) {
    drawIcon(parentNode, element, iconClass, 4, 28, 42, iconColor);
  }
  // FIXME this XY only works for BIDS, need a more robust way to position the dataset icon
  return dataset;
}
