import BaseRenderer from "diagram-js/lib/draw/BaseRenderer";
import { is } from "bpmn-js/lib/util/ModelUtil";
import { getStudyflowExtension, hasStudyflowExtends } from '../extensionElements';
import { BPMN_ICON_OVERRIDES } from './constants';
import { drawEventWithIcon} from './events';
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
    this.pkgEnums = Object.values(moddle.registry.packageMap || {})
      .flatMap((pkg) => pkg?.enumerations || []);

    this.exampleIconByType = this._buildExampleIconIndex(moddle.getPackages?.() || []);
  }

  _buildExampleIconIndex(packages) {
    const index = new Map();

    for (const pkg of packages) {
      const examples = pkg?.examples || [];
      const prefix = pkg?.prefix;
      if (!prefix) {
        continue;
      }

      for (const example of examples) {
        const obj = example?.object;
        const className = obj?.class;
        const icon = obj?.icon;
        if (!className || !icon) {
          continue;
        }

        const qualifiedType = className.includes(':') ? className : `${prefix}:${className}`;

        // Keep the first icon per type as the canonical example icon.
        if (!index.has(qualifiedType)) {
          index.set(qualifiedType, icon);
        }
      }
    }

    return index;
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
    const exampleIconClass = sfType ? this.exampleIconByType.get(sfType) : undefined;
    const descriptorIconClass = sfDescriptor?.icon;
    const iconClass = exampleIconClass || descriptorIconClass || BPMN_ICON_OVERRIDES[element.type] || undefined;

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
        Boolean(exampleIconClass),
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
