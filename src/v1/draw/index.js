import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import { is } from "bpmn-js/lib/util/ModelUtil";
import { getStudyflowExtension, hasStudyflowExtends } from '../extensionElements';
import { BPMN_ICON_OVERRIDES } from './constants';
import { drawStartEvent, drawEndEvent } from './events';
import { drawDataStore } from './data';
import { drawActivity } from './activities';
import { drawGateway } from './gateways';

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
    return !!getStudyflowExtension(element) || hasStudyflowExtends(element);
  }

  drawShape(parentNode, element) {
    const ext = getStudyflowExtension(element);
    const sfType = ext?.$type;
    const sfDescriptor = sfType ? this.pkgTypeMap[sfType] : undefined;
    const iconClass = sfDescriptor?.icon || BPMN_ICON_OVERRIDES[element.type] || undefined;

    if (is(element, "bpmn:StartEvent")) {
      return drawStartEvent(parentNode, element, this.bpmnRenderer);
    }

    if (is(element, "bpmn:EndEvent")) {
      return drawEndEvent(parentNode, element, this.bpmnRenderer);
    }

    if (is(element, "bpmn:DataStoreReference")) {
      return drawDataStore(parentNode, element, this.bpmnRenderer, this.pkgEnums);
    }

    if (is(element, "bpmn:Activity")) {
      return drawActivity(parentNode, element, this.bpmnRenderer, this.pkgEnums, iconClass);
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
