import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import { is } from 'bpmn-js/lib/util/ModelUtil';
import { getCatalog } from '@/lib/core/catalog';
import { getExtensionType, getExtensionElement, getRawAttribute, hasTraitAttributes } from '@/lib/core/extensions';
import { toPrefix } from '@/lib/core/naming';
import { BPMN_ICON_OVERRIDES } from '../constants';
import { drawEventWithIcon } from './events';
import { drawDataStore } from './data';
import { drawActivity } from './activities';
import { drawGateway } from './gateways';
import type { BpmnRenderer, EventBus, Styles } from '../bpmn-js';

const HIGH_PRIORITY = 1500;

/** Reads the studyflow-template namespaced `icon` attribute off the wrapper. */
function resolveTemplateIcon(ext: any): string | undefined {
  if (!ext) return undefined;
  return getRawAttribute(ext, 'icon', toPrefix(ext.$type));
}

/** Renders elements with a studyflow extension wrapper or trait-extended type. */
export default class StudyflowRenderer extends BaseRenderer {
  static $inject = ['eventBus', 'styles', 'bpmnRenderer'];

  private styles: Styles;
  private bpmnRenderer: BpmnRenderer;

  constructor(eventBus: EventBus, styles: Styles, bpmnRenderer: BpmnRenderer) {
    super(eventBus as any, HIGH_PRIORITY);
    this.styles = styles;
    this.bpmnRenderer = bpmnRenderer;
  }

  canRender(element: any): boolean {
    if (element.type === 'label') return false; // fixes #15
    return !!getExtensionElement(element) || hasTraitAttributes(element);
  }

  drawShape(parentNode: SVGElement, element: any): SVGElement {
    const ext = getExtensionElement(element);
    const extType = getExtensionType(element);
    const extEntry = extType ? getCatalog().getType(extType) : undefined;
    const templateIcon = resolveTemplateIcon(ext || element.businessObject);

    const iconClass = templateIcon
      || extEntry?.meta?.icon
      || extEntry?.icon
      || BPMN_ICON_OVERRIDES[element.type];

    if (is(element, 'bpmn:Event')) return drawEventWithIcon(parentNode, element, this.bpmnRenderer);
    if (is(element, 'bpmn:DataStoreReference')) return drawDataStore(parentNode, element, this.bpmnRenderer);
    if (is(element, 'bpmn:Activity')) return drawActivity(parentNode, element, this.bpmnRenderer, iconClass, !!templateIcon);
    if (is(element, 'bpmn:Gateway')) return drawGateway(parentNode, element, iconClass, this.styles);

    return this.bpmnRenderer.handlers[element.type]?.(parentNode, element);
  }
}
