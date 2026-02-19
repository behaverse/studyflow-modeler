import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import { is } from "bpmn-js/lib/util/ModelUtil";
import {getFillColor, getStrokeColor} from "bpmn-js/lib/draw/BpmnRenderUtil";
import {
  append as svgAppend, create as svgCreate
} from "tiny-svg";

/**
 * Custom icon overrides for standard BPMN task types.
 * Maps BPMN element type to an iconify class string.
 * Add new entries here to override more task type icons.
 */
const BPMN_TASK_ICON_OVERRIDES = {
  'bpmn:ManualTask':        'iconify mdi--hand-back-right-outline rotate-90',
  'bpmn:UserTask':          'iconify bi--person',
  'bpmn:ServiceTask':       'iconify mdi--cog',
  'bpmn:ScriptTask':        'iconify mdi--script-text',
  'bpmn:SendTask':          'iconify mdi--send',
  'bpmn:ReceiveTask':       'iconify mdi--email-open',
  'bpmn:BusinessRuleTask':  'iconify mdi--table',
  'bpmn:CallActivity':      'iconify mdi--arrow-right-bold-box',
};

export default class StudyflowRenderer extends BaseRenderer {

  static $inject = ["eventBus", "styles", "bpmnRenderer", "bpmnFactory", "moddle"];

  constructor(eventBus, styles, bpmnRenderer, bpmnFactory, moddle) {
    const HIGH_PRIORITY = 1500;
    super(eventBus, HIGH_PRIORITY);
    this.styles = styles;
    this.bpmnRenderer = bpmnRenderer;
    this.bpmnFactory = bpmnFactory;

    this.pkgTypeMap = moddle.registry.typeMap;
    this.pkgEnums = moddle.registry.packageMap["studyflow"]["enumerations"];

    /** @type {Record<string, string>} */
    this.bpmnTaskIconOverrides = { ...BPMN_TASK_ICON_OVERRIDES };
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

  drawIcon(parentNode, element, iconClass, x = 4, y = 4, size = 26) {

    if (!iconClass) {
      return;
    }

    const color = this.colorToHex(getStrokeColor(element));

    const foreignObject = svgCreate('foreignObject', {
      x,
      y,
      width: size,
      height: size,
      class: 'icon-container',
      color: color,
    });

    const iconDiv = document.createElement('div');
    iconDiv.className = iconClass;
    iconDiv.style.width = size + 'px';
    iconDiv.style.height = size + 'px';
    iconDiv.style.fontSize = size + 'px';
    iconDiv.style.color = color || 'currentColor';
    iconDiv.setAttribute('data-icon-class', iconClass);
    iconDiv.setAttribute('data-icon-color', color || '');
    foreignObject.appendChild(iconDiv);
    svgAppend(parentNode, foreignObject);

    return foreignObject;
  }

  drawIconText(parentNode, element, marker, x=9, y=21, fontSize=12) {

    if (!marker) {
      return;
    }

    switch (marker.length) {
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
        marker = marker.substring(0, 4);
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

    text.textContent = marker;
    
    svgAppend(parentNode, text);
    return text;
  }

  removeDefaultMarkers(parentGfx) {
    const markerPaths = parentGfx.querySelectorAll('[data-marker]');
    markerPaths.forEach(path => {
      // For SubProcessMarker, also remove the associated rect that precedes the "+" path
      if (path.getAttribute('data-marker') === 'sub-process') {
        const prevSibling = path.previousElementSibling;
        if (prevSibling && prevSibling.tagName.toLowerCase() === 'rect') {
          prevSibling.remove();
        }
      }
      path.remove();
    });
  }

  drawShape(parentNode, element) {
    let iconClass = this.pkgTypeMap[element.type].icon || undefined;

    // StartEvent
    if (is(element, "bpmn:StartEvent") && element.businessObject.get("requiresConsent")) {
      const circle = this.bpmnRenderer.handlers["bpmn:StartEvent"](parentNode, element);
      iconClass = "iconify tabler--shield-lock";
      this.drawIcon(parentNode, element, iconClass, 3, 3, 30);
      return circle;
    }

    // EndEvent
    if (is(element, "bpmn:EndEvent") && element.businessObject.get("hasRedirectUrl")) {
      const circle = this.bpmnRenderer.handlers["bpmn:EndEvent"](parentNode, element);
      iconClass = "iconify tabler--external-link";
      this.drawIcon(parentNode, element, iconClass, 4, 4, 28);
      return circle;
    }

    // Dataset
    if (is(element, "bpmn:DataStoreReference")) {
      const dataset = this.bpmnRenderer.handlers["bpmn:DataStoreReference"](parentNode, element);
      this.drawIcon(parentNode, element, iconClass, 10, 12, 32);
      return dataset;
    }

    // Activity with custom icons
    const businessObject = element.businessObject;
    if (is(element, "studyflow:Activity")) {
      let activity;

      if (element.type in this.bpmnTaskIconOverrides) {
        // If this task type has a custom icon override, draw a clean rectangle
        // Otherwise, use the default bpmn-js handler (with its built-in icon)
        activity = this.bpmnRenderer.handlers['bpmn:Task'](parentNode, element);
        iconClass = this.bpmnTaskIconOverrides[element.type];
      } else if (this.bpmnRenderer.handlers[element.type]) {
        activity = this.bpmnRenderer.handlers[element.type](parentNode, element);
      } else {
        activity = this.bpmnRenderer.handlers['bpmn:Task'](parentNode, element);
      }

      let iconSize = 24;
      let iconMarker = undefined;

      let instrument = businessObject?.get("instrument");
      const instrumentEnum = this.pkgEnums.find(e => e.name === "InstrumentEnum");
      iconClass = instrumentEnum.literalValues.find(lv => lv.value === instrument)?.icon || iconClass;

      if (instrument === "behaverse") {
        iconMarker = businessObject.get("behaverseTask")?.toUpperCase();
        if (iconMarker === "UNDEFINED") {
          iconMarker = undefined;
        }
        // adjust icon size based on marker length
        switch (iconMarker?.length) {
          case undefined:
          case 2: // 2 characters fit well within the icon
            iconSize = 24;
            break;
          default:  // for longer markers, reduce icon size to make room
            iconSize = 28;
            break;
        }
      }

      this.drawIcon(parentNode, element, iconClass, 4, 4, iconSize);
      this.drawIconText(parentNode, element, iconMarker);      
      this.drawMarkers(parentNode, element);
      return activity;
    }

    // Gateway
    if (is(element, "bpmn:Gateway")) {
      var gateway = this.drawDiamond(parentNode, element);
      this.drawIcon(parentNode, element, iconClass, 13, 13, 24);
      return gateway;
    }
  }

  drawMarkers(parentNode, element) {
    const businessObject = element.businessObject;
    let markers = [];
    this.removeDefaultMarkers(parentNode);

    if (businessObject.get("isDataOperation")) {
      markers.push("operation");
    }

    if (businessObject.get("checklist")?.length > 0) {
      markers.push("checklist");
    }

    if (is(element, 'bpmn:SubProcess')) {
      if (!element.di.isExpanded) {
        markers.push("subprocess");
      }
    }

    if (is(element, 'bpmn:AdHocSubProcess')) {
      markers.push("adhoc");
    }

    if (businessObject.get('isForCompensation')) {
      markers.push("compensation");
    }

    const loopCharacteristics = businessObject.get('loopCharacteristics');
    if (loopCharacteristics) {
      if (loopCharacteristics.get('isSequential') === true) {
        markers.push("sequential");
      } else if (loopCharacteristics.get('isSequential') === false) {
        markers.push("parallel");
      } else if (loopCharacteristics.get('isSequential') === undefined) {
        markers.push("loop");
      }
    }

    // sort
    markers = markers.sort((a, b) => a.localeCompare(b));

    // TODO show subprocess marker always in the center, and other markers on the lef/right side of it

    const gapX = 0;
    const gapY = 4;
    const markerSize = 20;
    const markerY = element.height - markerSize - gapY;
    const offsetX = (element.width - (markers.length * (markerSize + gapX))) / 2;
    markers.forEach((marker, index) => {
      const markerX = offsetX + index * (markerSize + gapX);
      this.drawIcon(parentNode, element, `data-marker-${marker}`, markerX, markerY, markerSize);
    });

  }
}
