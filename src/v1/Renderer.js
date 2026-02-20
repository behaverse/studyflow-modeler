import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import { is } from "bpmn-js/lib/util/ModelUtil";
import {getFillColor, getStrokeColor} from "bpmn-js/lib/draw/BpmnRenderUtil";
import {
  append as svgAppend, create as svgCreate
} from "tiny-svg";
import { getStudyflowExtension, hasStudyflowExtends } from './extensionElements';

/**
 * FIXME remove this and load icons as separate SVG files when needed, instead of hardcoding path data here.
 * Inline SVG path data for icons that must survive SVG export.
 * CSS-based icons (mask-image, background-image) are lost during export
 * because foreignObject content is not self-contained.
 */
const SVG_ICON_PATHS = {
  'bids-dataset-icon': {
    viewBox: '0 0 135 43.461',
    paths: [
      'm29.99,21.107l-0.961,-0.458l0.814,-0.702a10.755,10.755 0 0 0 3.827,-8.452c0,-6.731 -4.513,-10.019 -13.782,-10.019l-18.051,0l0,40.517l17.542,0c5.843,0 15.644,-1.525 15.644,-11.747c0.013,-4.535 -1.638,-7.519 -5.032,-9.138m-11.673,-12.353c5.048,0 7.106,1.404 7.106,4.836c0,1.282 -0.616,4.231 -6.33,4.231l-9.388,0l0,-6.919l-4.993,-2.148l13.605,0zm0.116,25.961l-8.727,0l0,-9.903l9.208,0c3.872,0 7.83,0.58 7.83,4.891c0.007,4.398 -3.993,5 -8.311,5l0,0.012z',
      'm42.724,1.476l7.875,0l0,40.506l-7.875,0l0,-40.506z',
      'm72.676,1.476l-12.593,0l0,40.516l11.692,0c8.195,0 14.356,-1.949 18.311,-5.789s6.009,-8.866 6.009,-15.003c0.003,-7.372 -3.039,-19.725 -23.42,-19.725m-0.122,33.227l-4.59,0l0,-23.627l-5.638,-2.321l10.237,0c10.202,0 15.384,4.167 15.384,12.436c-0.019,8.971 -5.192,13.513 -15.394,13.513',
      'm133.16,30.351a10.255,10.255 0 0 0 -1.602,-5.715c-2.144,-3.132 -5.324,-4.394 -9.58,-5.833c-1.509,-0.513 -3.007,-0.914 -4.455,-1.298c-4.128,-1.1 -7.692,-2.048 -7.692,-5.055c0,-2.122 1.211,-4.654 6.987,-4.654c4.003,0 7.465,1.548 10.577,4.734l5.227,-5.058c-3.75,-4.676 -8.817,-6.952 -15.465,-6.952c-4.596,0 -8.372,1.211 -11.218,3.606s-4.301,5.128 -4.301,8.442c0,7.138 5.375,9.766 11.18,11.539c1.417,0.477 2.734,0.836 4.007,1.186c2.414,0.664 4.487,1.234 6.116,2.311c1.308,0.872 2.058,2.134 2.058,3.465s-0.705,2.513 -1.923,3.333c-1.164,0.84 -2.904,1.253 -5.301,1.253c-5.009,0 -9.542,-2.481 -12.548,-6.843l-5.718,4.763c3.356,5.961 10.064,9.366 18.507,9.366c4.384,0 7.936,-1.199 10.862,-3.667c2.84,-2.352 4.285,-5.352 4.285,-8.923',
    ]
  }
};

/**
 * Custom icon overrides for standard BPMN elements.
 * Maps BPMN element/marker names to iconify class strings.
 */
const BPMN_ICON_OVERRIDES = {
  'bpmn:ManualTask':        'iconify tabler--hand-stop rotate-90',
  'bpmn:UserTask':          'iconify bi--person',
  'bpmn:ServiceTask':       'iconify mdi--cog',
  'bpmn:ScriptTask':        'iconify mdi--script-text',
  'bpmn:SendTask':          'iconify mdi--send',
  'bpmn:ReceiveTask':       'iconify mdi--email-open',
  'bpmn:BusinessRuleTask':  'iconify mdi--table',
  'bpmn:CallActivity':      'iconify mdi--arrow-right-bold-box',
  'operation':              'iconify mdi--function',
  'subprocess':             'iconify mdi--plus-box-outline',
  'adhoc':                  'iconify tabler--tilde',
  'parallel':               'iconify solar--hamburger-menu-linear rotate-90',
  'sequential':             'iconify solar--hamburger-menu-linear',
  'loop':                   'iconify mdi--loop',
  'compensation':           'iconify bpmn--compensation-marker',
  'checklist':              'iconify mdi--checkbox-outline'
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
  }

  canRender(element) {
    if (element.type === "label") {
      return false;  // fixes #15
    }
    // Render elements with studyflow extension elements (tasks, gateways)
    // or studyflow properties mixed in via extends (start/end events)
    return !!getStudyflowExtension(element) || hasStudyflowExtends(element);
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

  drawIcon(parentNode, element, iconClass, x = 4, y = 4, size = 26, colorOverride = undefined) {

    if (!iconClass) {
      return;
    }

    const color = colorOverride || this.colorToHex(getStrokeColor(element));

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

  /**
   * Draw an icon using inline SVG paths (no foreignObject / CSS).
   * This survives SVG export unlike CSS-based icons.
   */
  drawSvgPaths(parentNode, iconDef, x, y, width, height, fillColor) {
    const [, , vbW, vbH] = iconDef.viewBox.split(/\s+/).map(Number);
    const g = svgCreate('g');
    g.setAttribute('transform', `translate(${x}, ${y})`);

    const inner = svgCreate('g');
    const sx = width / vbW;
    const sy = height / vbH;
    const scale = Math.min(sx, sy);
    // Center within the bounding box
    const dx = (width - vbW * scale) / 2;
    const dy = (height - vbH * scale) / 2;
    inner.setAttribute('transform', `translate(${dx}, ${dy}) scale(${scale})`);

    for (const d of iconDef.paths) {
      const path = svgCreate('path', { d, fill: fillColor });
      svgAppend(inner, path);
    }

    svgAppend(g, inner);
    svgAppend(parentNode, g);
    return g;
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
    const ext = getStudyflowExtension(element);
    const sfType = ext?.$type;
    const sfDescriptor = sfType ? this.pkgTypeMap[sfType] : undefined;
    let iconClass = sfDescriptor?.icon || BPMN_ICON_OVERRIDES[element.type] || undefined;

    // StartEvent — studyflow properties live on the BO via extends
    if (is(element, "bpmn:StartEvent")) {
      const circle = this.bpmnRenderer.handlers["bpmn:StartEvent"](parentNode, element);
      if (element.businessObject.get("requiresConsent")) {
        this.drawIcon(parentNode, element, "iconify tabler--shield-lock", 3, 3, 30);
      }
      return circle;
    }

    // EndEvent — studyflow properties live on the BO via extends
    if (is(element, "bpmn:EndEvent")) {
      const circle = this.bpmnRenderer.handlers["bpmn:EndEvent"](parentNode, element);
      if (element.businessObject.get("hasRedirectUrl")) {
        this.drawIcon(parentNode, element, "iconify tabler--external-link", 4, 4, 28);
      }
      return circle;
    }

    // Dataset
    if (is(element, "bpmn:DataStoreReference")) {
      let format = element.businessObject.get("format");
      const formatEnum = this.pkgEnums.find(e => e.name === "DatasetFormatEnum");
      iconClass = formatEnum?.literalValues.find(lv => lv.value === format)?.icon || undefined;
      const dataset = this.bpmnRenderer.handlers["bpmn:DataStoreReference"](parentNode, element);
      // Use the element's stroke color with transparency for the dataset icon
      const strokeHex = this.colorToHex(getStrokeColor(element));
      const iconColor = strokeHex ? strokeHex + 'aa' : '#000000aa';

      // Use inline SVG paths for icons that need to survive SVG export;
      // fall back to foreignObject-based drawIcon for iconify icons.
      const svgDef = iconClass && SVG_ICON_PATHS[iconClass];
      if (svgDef) {
        this.drawSvgPaths(parentNode, svgDef, 4, 28, 42, 14, iconColor);
      } else if (iconClass) {
        this.drawIcon(parentNode, element, iconClass, 4, 28, 42, iconColor);
      }
      // FIXME this XY only works for BIDS, need a more robust way to position the dataset icon
      return dataset;
    }

    // Activity — renders with studyflow icons/markers
    // ext may be null for plain bpmn:Task with only extends-based props (e.g., isDataOperation)
    if (is(element, "bpmn:Activity")) {
      let activity;

      if (element.type in BPMN_ICON_OVERRIDES) {
        activity = this.bpmnRenderer.handlers['bpmn:Task'](parentNode, element);
      } else if (this.bpmnRenderer.handlers[element.type]) {
        activity = this.bpmnRenderer.handlers[element.type](parentNode, element);
      } else {
        activity = this.bpmnRenderer.handlers['bpmn:Task'](parentNode, element);
      }

      let iconSize = 24;
      let iconMarker = undefined;

      if (ext) {
        let instrument = ext.get("instrument");
        const instrumentEnum = this.pkgEnums.find(e => e.name === "InstrumentEnum");
        iconClass = instrumentEnum?.literalValues.find(lv => lv.value === instrument)?.icon || iconClass;

        if (instrument === "behaverse") {
          iconMarker = ext.get("behaverseTask")?.toUpperCase();
          if (iconMarker === "UNDEFINED") {
            iconMarker = undefined;
          }
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

    // Fallback: render using the default BPMN handler for the element type
    if (this.bpmnRenderer.handlers[element.type]) {
      return this.bpmnRenderer.handlers[element.type](parentNode, element);
    }
  }

  drawMarkers(parentNode, element) {
    const businessObject = element.businessObject;
    const ext = getStudyflowExtension(element);
    let markers = [];
    this.removeDefaultMarkers(parentNode);

    // isDataOperation is an extends property on bpmn:Activity (lives on the BO)
    if (businessObject.get("isDataOperation")) {
      markers.push("operation");
    }

    // checklist may be on the extension element or on the BO (extends)
    const checklist = ext?.get("checklist") || businessObject.get("checklist");
    if (checklist?.length > 0) {
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
      const markerIcon = BPMN_ICON_OVERRIDES[marker];
      this.drawIcon(parentNode, element, markerIcon, markerX, markerY, markerSize);
    });

  }
}
