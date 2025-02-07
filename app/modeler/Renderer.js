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
import HexagonIcon from "bootstrap-icons/icons/hexagon.svg";
import MoonIcon from "bootstrap-icons/icons/moon.svg";
import ShieldExclamationIcon from "bootstrap-icons/icons/shield-exclamation.svg";
import BoxArrowRightIcon from "bootstrap-icons/icons/box-arrow-right.svg";

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

  drawIcon(parentNode, element, icon, x=4, y=4, w=26, h=26) {

    var image = svgCreate('image', {
      x: x,
      y: y,
      width: w,
      height: h,
      href: icon.replace(/currentColor/g,
                         this.colorToHex(getStrokeColor(element)).replaceAll('#', '%23')),
      fill: getFillColor(element),
    });

    svgAppend(parentNode, image);

    return icon;
  }

  drawBehaverseTaskMarker(parentNode, element, task, x=9, y=21, fontSize=12) {

    switch (task.length) {
      case 2:
        x = 10;
        y = 21;
        fontSize = 11;
        break;
      case 3:
        x = 8;
        y = 22;
        fontSize = 11;
        break;
      default:
        task = task.substring(0, 4);
        x = 8.5;
        y = 21;
        fontSize = 8;
        break;
    }

    var text = svgCreate('text', {
      x: x,
      y: y,
      fontSize: fontSize,
      fontFamily: 'ui-monospace, monospace',
      fill: getStrokeColor(element),
      fontWeight: 'bold',
      strokeWidth: 0
    });

    text.textContent = task;
    
    svgAppend(parentNode, text);
    return text;
  }

  drawShape(parentNode, element) {

    // draw icon
    var icon = STUDYFLOW_ICONS[element.type] || STUDYFLOW_DEFAULT_ICON;
    var textMarker = undefined;

    // change instrument icon
    switch (element.businessObject.get("instrument")) {
      case "behaverse":
        icon = HexagonIcon;
        textMarker = element.businessObject.get("behaverseTask")?.toUpperCase();
        if (textMarker === "UNDEFINED") {
          // HACK to handle undefined values.
          textMarker = undefined;
        }
        break;
      case "videoGame":
        icon = ControllerIcon;
        break;
      case "rest":
        icon = MoonIcon;
        break;
    }

    // StartEvent
    if (is(element, "bpmn:StartEvent") && element.businessObject.get("requiresConsent")) {
      const circle = this.bpmnRenderer.handlers["bpmn:StartEvent"](parentNode, element);
      this.drawIcon(parentNode, element, ShieldExclamationIcon, 6, 6, 24, 24);
      return circle
    }

    if (is(element, "bpmn:EndEvent") && element.businessObject.get("hasRedirectUrl")) {
      const circle = this.bpmnRenderer.handlers["bpmn:EndEvent"](parentNode, element);
      this.drawIcon(parentNode, element, BoxArrowRightIcon, 9, 8, 20, 20);
      return circle
    }

    if (is(element, "studyflow:Activity")) {
      const activity = this.bpmnRenderer.handlers["bpmn:Task"](parentNode, element);
      var iconSize = 26;
      if (textMarker !== undefined) {
        this.drawBehaverseTaskMarker(parentNode, element, textMarker);
        switch (textMarker.length) {
          case 2:
            iconSize = 26;
            break;
          default:
            iconSize = 28;
            break;
        }
      }
      this.drawIcon(parentNode, element, icon, 4, 4, iconSize, iconSize);

      return activity;
    }

    if (is(element, "bpmn:Gateway")) {
      var gateway = this.drawDiamond(parentNode, element);
      this.drawIcon(parentNode, element, icon, 12, 12);
      return gateway;
    }
  }
}
