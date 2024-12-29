import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import { is } from "bpmn-js/lib/util/ModelUtil";
import {
  append as svgAppend, create as svgCreate
} from "tiny-svg";

const STUDYFLOW_ICONS = {
  'studyflow:RandomAssignment': "\uF2FD",
  'studyflow:VideoGame': "\uF2D4",
  'studyflow:CognitiveTest': "\uF503",
  'studyflow:Questionnaire': "\uF4CB",
  'studyflow:Instruction': "\uF25F",
}

const STUDYFLOW_DEFAULT_ICON = "\uF8A7"; // person-gear


export default class StudyFlowRenderer extends BaseRenderer {

  static $inject = ["eventBus", "styles", "bpmnRenderer"];

  constructor(eventBus, styles, bpmnRenderer) {
    const HIGH_PRIORITY = 1500;
    super(eventBus, HIGH_PRIORITY);
    this.styles = styles;
    this.bpmnRenderer = bpmnRenderer;
  }

  canRender(element) {
    return is(element, "studyflow:Element");
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

  drawIcon(parentNode, element, x, y, classes) {

    const icon = STUDYFLOW_ICONS[element.type] || STUDYFLOW_DEFAULT_ICON;
    var text = svgCreate('text', {
      x: x,
      y: y,
      width: element.width,
      height: element.height,
      fontSize: 24,
      fill: '#a21caf',
      strokeWidth: 0,
      class: classes
    });
    text.textContent = icon
    svgAppend(parentNode, text);

    return icon;
  }

  drawShape(parentNode, element) {
    if (is(element, "studyflow:Activity")) {
      const el = this.bpmnRenderer.handlers["bpmn:Task"](parentNode, element, {stroke: 'black'});
      this.drawIcon(parentNode, element, 5, 29, 'bi text-fuchsia-100');
      return el;
    }

    if (is(element, "studyflow:RandomAssignment")) {
      var diamond = this.drawDiamond(
        parentNode, element.width, element.height, {
          stroke: 'black'
      });
      this.drawIcon(parentNode, element,
        element.width / 2 - 12,
        element.height / 2 + 12, 'bi text-fuchsia-100 bg-blue');
      return diamond;
    }
  }

}
