import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import { append as svgAppend, create as svgCreate } from "tiny-svg";

export default class BFlowRenderer extends BaseRenderer {

  static $inject = ["eventBus", "bpmnRenderer"];

  constructor(eventBus, bpmnRenderer) {
    const HIGH_PRIORITY = 1500;
    super(eventBus, HIGH_PRIORITY);
    this.bpmnRenderer = bpmnRenderer;
  }

  canRender(element) {
    return element.type === "bflow:Activity"
  }

  drawShape(parentNode, element) {
    if (element.type === "bflow:Activity") {
      const rect = svgCreate("rect");

      rect.setAttribute("width", element.width);
      rect.setAttribute("height", element.height);
      rect.setAttribute("stroke", "black");
      rect.setAttribute("fill", "lightgray");
      rect.setAttribute("stroke-width", 1);

      svgAppend(parentNode, rect);

      return rect;
    }
  }

}
