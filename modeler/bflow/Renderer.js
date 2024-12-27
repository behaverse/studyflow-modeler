import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import {
  append as svgAppend, create as svgCreate,
  classes as svgClasses, attr as svgAttr
} from "tiny-svg";

export default class BFlowRenderer extends BaseRenderer {

  static $inject = ["eventBus", "styles", "bpmnRenderer"];

  constructor(eventBus, styles, bpmnRenderer) {
    const HIGH_PRIORITY = 1500;
    super(eventBus, HIGH_PRIORITY);
    this.styles = styles;
    this.bpmnRenderer = bpmnRenderer;
    console.log(this.bpmnRenderer)
  }

  canRender(element) {
    return element.type === "bflow:Activity" || element.type === "bflow:RandomAssignment";
  }

  drawDiamond(parentGfx, width, height, attrs) {

    var x_2 = width / 2;
    var y_2 = height / 2;

    var points = [
      { x: x_2, y: 0 },
      { x: width, y: y_2 },
      { x: x_2, y: height },
      { x: 0, y: y_2 }
    ];

    var pointsString = points.map(function(point) {
      return point.x + ',' + point.y;
    }).join(' ');

    attrs = this.styles.computeStyle(attrs, {
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeWidth: 2,
          fill: 'white'
    });

    var polygon = svgCreate('polygon', {
      ...attrs,
      points: pointsString
    });

    svgAppend(parentGfx, polygon);

    return polygon;
  }

  drawIcon(parentNode, element, icon, x, y) {
    var text = svgCreate('text', {
      x: x,
      y: y,
      width: element.width,
      height: element.height,
      fontSize: 24,
      fill: 'purple',
      class: 'bi'
    });
    text.textContent = icon
    svgAppend(parentNode, text);

    return icon;
  }

  drawShape(parentNode, element) {
    if (element.type === "bflow:Activity") {
      const el = this.bpmnRenderer.handlers["bpmn:Task"](parentNode, element);
      this.drawIcon(parentNode, element, "\uF502", 5, 29);
      return el;
    }

    if (element.type === "bflow:RandomAssignment") {
      var diamond = this.drawDiamond(
        parentNode, element.width, element.height, {
          stroke: 'black'
      });
      this.drawIcon(parentNode, element, "\uF2FD",
        element.width / 2 - 12,
        element.height / 2 + 12);
      return diamond;
    }
  }

}
