import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import { is } from "bpmn-js/lib/util/ModelUtil";
import {getFillColor, getStrokeColor} from "bpmn-js/lib/draw/BpmnRenderUtil";
import {
  append as svgAppend, create as svgCreate
} from "tiny-svg";

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

  drawIconMarker(parentNode, element, marker, x=9, y=21, fontSize=12) {

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

      if (this.bpmnRenderer.handlers[element.type]) {
        activity = this.bpmnRenderer.handlers[element.type](parentNode, element);
      } else {
        activity = this.bpmnRenderer.handlers['bpmn:Task'](parentNode, element);
      }

      let instrument = businessObject?.get("instrument");
      let iconSize = 26;
      let iconMarker = undefined;

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
          case 2:
            iconSize = 24;
            break;
          default:
            iconSize = 28;
            break;
        }
      }

      this.drawIcon(parentNode, element, iconClass, 4, 4, iconSize);
      this.drawIconMarker(parentNode, element, iconMarker);
      
      // Draw dataOperator marker if active
      if (businessObject.get('isOperator')) {
        // Place on the same marker baseline as bpmn-js task markers and avoid overlapping
        // loop / MI / ad-hoc / compensation markers when those are enabled.


        const isSubProcess = is(element, 'bpmn:SubProcess') || is(element, 'bpmn:AdHocSubProcess');
        const isForCompensation = !!businessObject.get('isForCompensation');

        const markerSize = 22;

        const width = element.width;
        const height = element.height;

        const loopCharacteristics = businessObject.get('loopCharacteristics');
        const isSequential = loopCharacteristics && loopCharacteristics.get('isSequential');

        // Offset table copied from bpmn-js (BpmnRenderer#renderTaskMarkers).
        // We only need the relative horizontal positions.
        let offsets = isSubProcess
          ? { seq: -21, parallel: -22, compensation: -25, loop: -18, adhoc: 10 }
          : { seq: -5, parallel: -6, compensation: -7, loop: 0, adhoc: -8 };

        // bpmn-js shifts compensation when loop characteristics are present
        if (loopCharacteristics) {
          offsets = { ...offsets, compensation: offsets.compensation - 18 };

          // special case when both ad-hoc + loop are present
          if (isSubProcess) {
            offsets = { ...offsets, seq: -23, loop: -18, parallel: -24 };
          }
        }

        const occupiedCenters = [];

        // Collapsed subprocess draws a "+" marker at bottom-center in bpmn-js.
        // Reserve the center slot so our operator marker does not overlap it.
        const isCollapsed = (isSubProcess && businessObject.di && businessObject.di.isExpanded === false);
        if (isCollapsed) {
          occupiedCenters.push(width / 2);
        }

        if (isForCompensation) {
          occupiedCenters.push(width / 2 + offsets.compensation);
        }

        if (isSubProcess) {
          occupiedCenters.push(width / 2 + offsets.adhoc);
        }

        if (loopCharacteristics) {
          if (isSequential === undefined) {
            occupiedCenters.push(width / 2 + offsets.loop);
          } else if (isSequential === false) {
            occupiedCenters.push(width / 2 + offsets.parallel);
          } else if (isSequential === true) {
            occupiedCenters.push(width / 2 + offsets.seq);
          }
        }

        // Marker placement strategy:
        // - If no other markers are present: center it.
        // - Otherwise: place it in the next slot to the right of the rightmost marker.
        // Keep the gap tight by default, but make it a bit larger when the collapsed "+" is present
        // (the "+" marker is a 14x14 box centered at the bottom).
        const baseGap = Math.max(10, markerSize - 2);
        const minGap = isCollapsed ? baseGap + 6 : baseGap;

        const center = width / 2;
        const rightMostOccupied = occupiedCenters.length
          ? Math.max(...occupiedCenters, center)
          : undefined;

        let operatorCenter = rightMostOccupied !== undefined
          ? rightMostOccupied + minGap
          : center;

        if (isSubProcess && !loopCharacteristics) {
          operatorCenter += 14; // compensate for the fact that subprocesses are drawn with a left offset in bpmn-js
        }

        // avoid overlaps with existing marker centers
        for (let i = 0; i < 6; i++) {
          const collides = occupiedCenters.some(c => Math.abs(c - operatorCenter) < minGap);
          if (!collides) {
            break;
          }
          operatorCenter += minGap;
        }

        const markerX = Math.max(0, Math.min(width - markerSize - 2, operatorCenter - markerSize / 2));

        // Match the bpmn-js task marker baseline (≈ height - 20) while avoiding clipping.
        let markerY = Math.max(0, height - 20);
        if (markerY + markerSize > height) {
          markerY = Math.max(0, height - markerSize - 2);
        }

        this.drawIcon(parentNode, element, 'data-operator-marker', markerX, markerY, markerSize);
      }
      
      return activity;
    }

    // Gateway
    if (is(element, "bpmn:Gateway")) {
      var gateway = this.drawDiamond(parentNode, element);
      this.drawIcon(parentNode, element, iconClass, 13, 13, 24);
      return gateway;
    }
  }
}
