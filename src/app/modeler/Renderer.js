import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import { is } from "bpmn-js/lib/util/ModelUtil";
import {getFillColor, getStrokeColor} from "bpmn-js/lib/draw/BpmnRenderUtil";
import {
  append as svgAppend, create as svgCreate
} from "tiny-svg";

import ActivityIcon from "@/assets/icons/svg/Activity.svg";
import BehaverseTaskIcon from "@/assets/icons/svg/BehaverseTask.svg";
import CognitiveTestIcon from "@/assets/icons/svg/CognitiveTest.svg";
import EndRedirectIcon from "@/assets/icons/svg/EndRedirect.svg";
import InstructionIcon from "@/assets/icons/svg/Instruction.svg";
import QuestionnaireIcon from "@/assets/icons/svg/Questionnaire.svg";
import RandomGatewayIcon from "@/assets/icons/svg/_RandomGateway.svg";
import RestIcon from "@/assets/icons/svg/Rest.svg";
import StartConsentIcon from "@/assets/icons/svg/StartConsent.svg";
import VideoGameIcon from "@/assets/icons/svg/VideoGame.svg";
import EventDataIcon from "@/assets/icons/svg/EventData.svg";
import TrialDataIcon from "@/assets/icons/svg/TrialData.svg";
import ModelDataIcon from "@/assets/icons/svg/ModelData.svg";
import BIDSDataIcon from "@/assets/icons/svg/BIDSData.svg";
import PsychDSDataIcon from "@/assets/icons/svg/PsychDSData.svg";

export default class StudyflowRenderer extends BaseRenderer {

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

    if (!task) {
      return;
    }

    switch (task.length) {
      case 2:
        x = 9;
        y = 20;
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

    // StartEvent
    if (is(element, "bpmn:StartEvent") && element.businessObject.get("requiresConsent")) {
      const circle = this.bpmnRenderer.handlers["bpmn:StartEvent"](parentNode, element);
      this.drawIcon(parentNode, element, StartConsentIcon, 5, 5, 24, 24);
      return circle
    }

    // EndEvent
    if (is(element, "bpmn:EndEvent") && element.businessObject.get("hasRedirectUrl")) {
      const circle = this.bpmnRenderer.handlers["bpmn:EndEvent"](parentNode, element);
      this.drawIcon(parentNode, element, EndRedirectIcon, 8, 7, 22, 22);
      return circle
    }

    // Dataset
    if (is(element, "bpmn:DataStoreReference")) {
      const dataset = this.bpmnRenderer.handlers["bpmn:DataStoreReference"](parentNode, element);

      if (element.businessObject.get("datasetFormat") === "bids") {
        this.drawIcon(parentNode, element, BIDSDataIcon, 7, 18, 36, 36);
        return dataset
      }

      if (element.businessObject.get("datasetFormat") === "psych-ds") {
        this.drawIcon(parentNode, element, PsychDSDataIcon, 14, 26, 22, 22);
        return dataset
      }

      if (element.businessObject.get("datasetFormat") === "bdm") {
        switch (element.businessObject.get("bdmDataLevel")) {
          case "events":
            this.drawIcon(parentNode, element, EventDataIcon, 14, 26, 22, 22);
            break;
          case "trials":
            this.drawIcon(parentNode, element, TrialDataIcon, 14, 26, 22, 22);
            break;
          case "models":
            this.drawIcon(parentNode, element, ModelDataIcon, 15, 27, 20, 20);
            break;
        }
        
        return dataset
      }
    }



    var icon = {
      'studyflow:RandomGateway': RandomGatewayIcon,
      // 'studyflow:VideoGame': ControllerIcon,
      'studyflow:CognitiveTest': CognitiveTestIcon,
      'studyflow:Questionnaire': QuestionnaireIcon,
      'studyflow:Instruction': InstructionIcon,
    }[element.type] || ActivityIcon;

    var textOnIconMarker = undefined;

    // change instrument icon
    switch (element.businessObject.get("instrument")) {
      case "behaverse":
        icon = BehaverseTaskIcon;
        textOnIconMarker = element.businessObject.get("behaverseTask")?.toUpperCase();
        if (textOnIconMarker === "UNDEFINED") {
          // HACK to handle undefined values.
          textOnIconMarker = undefined;
        }
        break;
      case "videoGame":
        icon = VideoGameIcon;
        break;
      case "rest":
        icon = RestIcon;
        break;
    }

    // Generic Activity
    if (is(element, "studyflow:Activity")) {
      const activity = this.bpmnRenderer.handlers["bpmn:Task"](parentNode, element);
      var iconSize = 26;
      this.drawBehaverseTaskMarker(parentNode, element, textOnIconMarker);
      switch (textOnIconMarker?.length) {
        case undefined:
          iconSize = 24;
          break;
        case 2:
          iconSize = 24;
          break;
        default: // 3, 4, or more
          iconSize = 28;
          break;
      }
      this.drawIcon(parentNode, element, icon, 4, 4, iconSize, iconSize);

      return activity;
    }

    // Gateway
    if (is(element, "bpmn:Gateway")) {
      var gateway = this.drawDiamond(parentNode, element);
      this.drawIcon(parentNode, element, icon, 9, 9, 52, 52);
      return gateway;
    }
  }
}
