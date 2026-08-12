import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import { is } from 'bpmn-js/lib/util/ModelUtil';
import { getFillColor, getStrokeColor } from 'bpmn-js/lib/draw/BpmnRenderUtil';
import { append as svgAppend, create as svgCreate } from 'tiny-svg';
import { getCatalog } from '@core/notation';
import { getAttribute, getRawAttribute, isDataOperationActivity, StudyflowElement } from '@core/element';
import { BPMN_ICON_OVERRIDES, MARKER_ICONS, SVG_ICON_PATHS } from '@modeler/draw/icons';
import { colorToHex, drawIcon, drawIconText, drawSvgPaths, removeDefaultMarkers } from '@modeler/draw/utils';
import { drawChoreographyTask } from '@modeler/draw/choreography';
import { isChoreographyTask } from '@modeler/draw/choreographyLayout';
import type { BpmnRenderer, EventBus, Styles } from '@modeler/bpmn/types';

const HIGH_PRIORITY = 1500;

// px.
const ICON_SIZE = 24;
const ICON_SIZE_LARGE = 28;
const LONG_SCENE_LENGTH = 2;

/** Any instance attribute declaring `meta.icon` in its schema draws that icon when it holds a value. */
function drawEventWithIcon(
  parentNode: SVGElement,
  element: any,
  bpmnRenderer: BpmnRenderer,
): SVGElement {
  const circle = bpmnRenderer.handlers[element.type](parentNode, element);

  const typeName = StudyflowElement.fromBusinessObject(element).extensionType ?? element.businessObject?.$type;
  for (const attr of getCatalog().instanceAttributesOf(typeName)) {
    const icon = attr.meta?.icon;
    if (typeof icon !== 'string' || !icon) continue;
    if (!getAttribute(element, attr.name)) continue;
    drawIcon(parentNode, element, icon, 6, 6, 24);
  }
  return circle;
}

function drawDataStore(
  parentNode: SVGElement,
  element: any,
  bpmnRenderer: BpmnRenderer,
): SVGElement {
  const format = getAttribute(element, 'format');
  const formatEnum = getCatalog().enumOf('DatasetFormatEnum');
  const iconClass: string | undefined =
    formatEnum?.literals.find((lv) => lv.value === format)?.icon || undefined;

  const dataset = bpmnRenderer.handlers['bpmn:DataStoreReference'](parentNode, element);

  const strokeHex = colorToHex(getStrokeColor(element));
  const iconColor = strokeHex ? strokeHex + 'bb' : '#000000bb';

  const svgDef = iconClass && SVG_ICON_PATHS[iconClass];
  if (svgDef) {
    drawSvgPaths(parentNode, svgDef, 4, 28, 42, 14, iconColor);
  } else if (iconClass) {
    drawIcon(parentNode, element, iconClass, 15, 27, 20, iconColor);
  }
  // FIXME this XY only works for BIDS, need a more robust way to position the dataset icon
  return dataset;
}

function drawDiamond(
  parentGfx: SVGElement,
  element: { width: number; height: number },
  styles: Styles,
): SVGElement {
  const { width, height } = element;
  const cx = width / 2;
  const cy = height / 2;
  const points = `${cx},0 ${width},${cy} ${cx},${height} 0,${cy}`;

  const svgAttributes = styles.computeStyle({}, {
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 2,
    stroke: getStrokeColor(element),
    fill: getFillColor(element),
  });

  const polygon = svgCreate('polygon', { ...svgAttributes, points });
  svgAppend(parentGfx, polygon);
  return polygon;
}

function drawGateway(
  parentNode: SVGElement,
  element: any,
  iconClass: string | undefined,
  styles: Styles,
): SVGElement {
  const gateway = drawDiamond(parentNode, element, styles);
  drawIcon(parentNode, element, iconClass, 13, 13, 24);
  return gateway;
}

function drawMarkers(parentNode: SVGElement, element: any): void {
  const markers: string[] = [];
  removeDefaultMarkers(parentNode);

  const checklist = getAttribute(element, 'checklist');
  if (checklist?.length > 0) {
    markers.push('checklist');
  }

  if (isDataOperationActivity(element)) {
    markers.push('function');
  }

  if (is(element, 'bpmn:SubProcess') && !element.di.isExpanded) {
    markers.push('subprocess');
  }

  if (is(element, 'bpmn:AdHocSubProcess')) {
    markers.push('adhoc');
  }

  if (getAttribute(element, 'isForCompensation')) {
    markers.push('compensation');
  }

  const loopCharacteristics = getAttribute(element, 'loopCharacteristics');
  if (loopCharacteristics) {
    const isSequential = loopCharacteristics.get('isSequential');
    if (isSequential === true) markers.push('sequential');
    else if (isSequential === false) markers.push('parallel');
    else markers.push('loop');
  }

  // TODO show subprocess marker always in the center, and other markers on the left/right side of it

  const MARKER_SIZE = 20;
  const MARKER_GAP_Y = 4;
  const markerY = element.height - MARKER_SIZE - MARKER_GAP_Y;
  const offsetX = (element.width - markers.length * MARKER_SIZE) / 2;
  markers.forEach((marker, index) => {
    drawIcon(parentNode, element, MARKER_ICONS[marker], offsetX + index * MARKER_SIZE, markerY, MARKER_SIZE);
  });
}

function drawActivity(
  parentNode: SVGElement,
  element: any,
  bpmnRenderer: BpmnRenderer,
  iconClass: string | undefined,
  preservePrimaryIcon: boolean = false,
): SVGElement {
  const handlerType = (element.type in BPMN_ICON_OVERRIDES || !bpmnRenderer.handlers[element.type])
    ? 'bpmn:Task'
    : element.type;
  const activity = bpmnRenderer.handlers[handlerType](parentNode, element);

  // Hardcoded display convention of the behaverse instrument, not schema data.
  let iconMarker: string | undefined;
  let iconSize = ICON_SIZE;
  if (getAttribute(element, 'instrument') === 'behaverse' && !preservePrimaryIcon) {
    const scene = getAttribute(element, 'behaverseScene')?.toUpperCase();
    iconMarker = scene === 'UNDEFINED' ? undefined : scene;
    if (iconMarker && iconMarker.length > LONG_SCENE_LENGTH) iconSize = ICON_SIZE_LARGE;
  }

  drawIcon(parentNode, element, iconClass, 4, 4, iconSize);
  if (!preservePrimaryIcon) drawIconText(parentNode, element, iconMarker);
  drawMarkers(parentNode, element);
  return activity;
}

function resolveTemplateIcon(ext: any): string | undefined {
  if (!ext) return undefined;
  return getRawAttribute(ext, 'icon');
}

export default class StudyflowRenderer extends BaseRenderer {
  static $inject = ['eventBus', 'styles', 'bpmnRenderer'];

  private styles: Styles;
  private bpmnRenderer: BpmnRenderer;

  constructor(eventBus: EventBus, styles: Styles, bpmnRenderer: BpmnRenderer) {
    super(eventBus as any, HIGH_PRIORITY);
    this.styles = styles;
    this.bpmnRenderer = bpmnRenderer;
    // This file delegates to bpmn-js's *private* `handlers` map (hence the exact
    // version pin); if an upgrade moves it, fail at boot — not as blank shapes.
    if (!bpmnRenderer.handlers || typeof bpmnRenderer.handlers !== 'object') {
      throw new Error(
        'bpmn-js internal changed: BpmnRenderer.handlers is gone. '
        + 'Update the render/ delegation (see bpmn/types.ts BpmnRenderer) before bumping bpmn-js.',
      );
    }
  }

  canRender(element: any): boolean {
    if (element.type === 'label') return false; // fixes #15
    const el = StudyflowElement.fromBusinessObject(element);
    return !!el.extension || el.hasTraits;
  }

  drawShape(parentNode: SVGElement, element: any): SVGElement {
    const el = StudyflowElement.fromBusinessObject(element);
    const ext = el.extension;
    const extType = el.extensionType;
    const extEntry = extType ? getCatalog().getType(extType) : undefined;
    const templateIcon = resolveTemplateIcon(ext || element.businessObject);

    const iconClass = templateIcon
      || extEntry?.iconClass
      || BPMN_ICON_OVERRIDES[element.type];

    if (isChoreographyTask(element)) return drawChoreographyTask(parentNode, element, this.styles);
    if (is(element, 'bpmn:Event')) return drawEventWithIcon(parentNode, element, this.bpmnRenderer);
    if (is(element, 'bpmn:DataStoreReference')) return drawDataStore(parentNode, element, this.bpmnRenderer);
    if (is(element, 'bpmn:Activity')) return drawActivity(parentNode, element, this.bpmnRenderer, iconClass, !!templateIcon);
    if (is(element, 'bpmn:Gateway')) return drawGateway(parentNode, element, iconClass, this.styles);

    return this.bpmnRenderer.handlers[element.type]?.(parentNode, element);
  }
}
