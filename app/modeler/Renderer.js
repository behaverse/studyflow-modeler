import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import { is } from "bpmn-js/lib/util/ModelUtil";
import {getFillColor, getStrokeColor} from "bpmn-js/lib/draw/BpmnRenderUtil";
import {
  append as svgAppend, create as svgCreate
} from "tiny-svg";

import PuzzleIcon from "bootstrap-icons/icons/puzzle.svg";
import ControllerIcon from "bootstrap-icons/icons/controller.svg";
import PencilIcon from "bootstrap-icons/icons/pencil.svg";
import ChatSquareDotsIcon from "bootstrap-icons/icons/chat-square-dots.svg";
import ShuffleIcon from "bootstrap-icons/icons/shuffle.svg";
import PersonGearIcon from "bootstrap-icons/icons/person-gear.svg";

const STUDYFLOW_ICONS = {
  'studyflow:RandomGateway': ShuffleIcon,
  // 'studyflow:VideoGame': ControllerIcon,
  'studyflow:CognitiveTest': PuzzleIcon,
  'studyflow:Questionnaire': PencilIcon,
  'studyflow:Instruction': ChatSquareDotsIcon
}

const STUDYFLOW_DEFAULT_ICON = PersonGearIcon;


export default class StudyFlowRenderer extends BaseRenderer {

  static $inject = ["eventBus", "styles", "bpmnRenderer"];

  constructor(eventBus, styles, bpmnRenderer) {
    const HIGH_PRIORITY = 1500;
    super(eventBus, HIGH_PRIORITY);
    this.styles = styles;
    this.bpmnRenderer = bpmnRenderer;
  }

  canRender(element) {
    if (element.type === "label") {
      return false;  // fixes #15
    }
    return is(element, "studyflow:Element");
  }

  colorToHex(color) {
    var context = document.createElement('canvas').getContext('2d');
    context.fillStyle = 'transparent';
    context.fillStyle = color;
    return /^#[0-9a-fA-F]{6}$/.test(context.fillStyle) ? context.fillStyle : null;
  }

  drawDiamond(parentGfx, element, attrs) {

    const width = element.width;
    const height = element.height;

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
      stroke: getStrokeColor(element),
      fill: getFillColor(element)
    });

    var polygon = svgCreate('polygon', {
      ...attrs,
      points: pointsString
    });

    svgAppend(parentGfx, polygon);

    return polygon;
  }

  drawIcon(parentNode, element, icon, x, y) {

    var image = svgCreate('image', {
      x: x,
      y: y,
      width: 26,
      height: 26,
      href: icon.replace(/currentColor/g,
                         this.colorToHex(getStrokeColor(element)).replaceAll('#', '%23')),
      fill: getFillColor(element),
    });

    svgAppend(parentNode, image);

    return icon;
  }

  drawShape(parentNode, element) {

    const icon = STUDYFLOW_ICONS[element.type] || STUDYFLOW_DEFAULT_ICON;

    if (is(element, "studyflow:Activity")) {
      const box = this.bpmnRenderer.handlers["bpmn:Task"](parentNode, element);
      this.drawIcon(parentNode, element, icon, 4, 4);
      return box;
    }

    if (is(element, "studyflow:RandomGateway")) {
      var diamond = this.drawDiamond(parentNode, element);
      this.drawIcon(parentNode, element, icon, 12, 12);
      return diamond;
    }
  }

}
