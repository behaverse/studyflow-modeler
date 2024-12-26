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
    return element.type === "bflow:Activity" || element.type === "bflow:RandomAssignment";
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

    if (element.type === "bflow:RandomAssignment") {
      const polygon = svgCreate("polygon");

      polygon.setAttribute("points", "0,0 20,0 10,20");
      polygon.setAttribute("stroke", "black");
      polygon.setAttribute("fill", "lightgray");
      polygon.setAttribute("stroke-width", 1);

      svgAppend(parentNode, polygon);

      return polygon;
    }
  }

}
