// @ts-check

import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import { is } from "bpmn-js/lib/util/ModelUtil";
import { getAppliedType, getExtensionElement, getAttr, hasExtends } from '../extensions';
import { BPMN_ICON_OVERRIDES } from './constants';
import { drawEventWithIcon} from './events';
import { drawDataStore } from './data';
import { drawActivity } from './activities';
import { drawGateway } from './gateways';

/**
 * High-priority renderer that draws studyflow-typed BPMN elements with
 * their applied-type icon and delegates everything else to the default
 * bpmn-js renderer.
 *
 * `canRender` returns true only for elements that carry a studyflow
 * extension element or an extends-based applied type; that gates this
 * renderer in (priority 1500) over the built-in renderer for those shapes.
 */
export default class StudyflowRenderer extends BaseRenderer {

  static $inject = ["eventBus", "styles", "bpmnRenderer", "bpmnFactory", "moddle"];

  /**
   * @param {any} eventBus
   * @param {any} styles
   * @param {any} bpmnRenderer  default bpmn-js renderer (delegated to)
   * @param {any} bpmnFactory
   * @param {any} moddle
   */
  constructor(eventBus, styles, bpmnRenderer, bpmnFactory, moddle) {
    const HIGH_PRIORITY = 1500;
    super(eventBus, HIGH_PRIORITY);
    this.styles = styles;
    this.bpmnRenderer = bpmnRenderer;
    this.bpmnFactory = bpmnFactory;

    this.pkgTypeMap = moddle.registry.typeMap;
    this.pkgEnums = Object.values(moddle.registry.packageMap || {})
      .flatMap((pkg) => pkg?.enumerations || []);
  }

  /**
   * Resolve the icon supplied via the element's namespace-qualified `icon`
   * attribute (a studyflow-example mechanism). Returns `undefined` for
   * elements without an extension.
   *
   * @param {any} ext
   */
  _resolveElementExampleIcon(ext) {
    if (!ext) {
      return undefined;
    }

    const prefix = ext.$type?.split(':')?.[0];
    return getAttr(ext, 'icon', prefix);
  }

  /**
   * @param {any} element
   * @returns {boolean}
   */
  canRender(element) {
    if (element.type === "label") {
      return false;  // fixes #15
    }
    return !!getExtensionElement(element) || hasExtends(element);
  }

  /**
   * @param {any} parentNode SVG group where the shape is drawn
   * @param {any} element    diagram-js element
   */
  drawShape(parentNode, element) {
    const ext = getExtensionElement(element);
    const sfType = getAppliedType(element);
    const sfDescriptor = sfType ? this.pkgTypeMap[sfType] : undefined;
    const elementExampleIconClass = this._resolveElementExampleIcon(ext || element.businessObject);
    const descriptorIconClass = sfDescriptor?.meta?.icon || sfDescriptor?.icon;
    const iconClass = elementExampleIconClass || descriptorIconClass || BPMN_ICON_OVERRIDES[element.type] || undefined;

    if (is(element, "bpmn:Event")) {
      return drawEventWithIcon(parentNode, element, this.bpmnRenderer);
    }

    if (is(element, "bpmn:DataStoreReference")) {
      return drawDataStore(parentNode, element, this.bpmnRenderer, this.pkgEnums);
    }

    if (is(element, "bpmn:Activity")) {
      return drawActivity(
        parentNode,
        element,
        this.bpmnRenderer,
        this.pkgEnums,
        iconClass,
        Boolean(elementExampleIconClass),
      );
    }

    if (is(element, "bpmn:Gateway")) {
      return drawGateway(parentNode, element, iconClass, this.styles);
    }

    // Fallback: render using the default BPMN handler for the element type
    if (this.bpmnRenderer.handlers[element.type]) {
      return this.bpmnRenderer.handlers[element.type](parentNode, element);
    }
  }
}
