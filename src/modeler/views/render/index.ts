import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import { is } from 'bpmn-js/lib/util/ModelUtil';
import { getCatalog } from '@/core/catalog';
import { getRawAttribute, StudyflowElement } from '@/core/extensions';
import { toPrefix } from '@/core/naming';
import { BPMN_ICON_OVERRIDES } from '@/modeler/infra/constants';
import { drawEventWithIcon } from '@/modeler/views/render/events';
import { drawDataStore } from '@/modeler/views/render/data';
import { drawActivity } from '@/modeler/views/render/activities';
import { drawChoreographyTask } from '@/modeler/views/render/choreography';
import { isChoreographyTask } from '@/modeler/models/render/choreography';
import { drawGateway } from '@/modeler/views/render/gateways';
import type { BpmnRenderer, EventBus, Styles } from '@/modeler/infra/bpmn-js.d';

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
      || extEntry?.meta?.icon
      || extEntry?.icon
      || BPMN_ICON_OVERRIDES[element.type];

    if (isChoreographyTask(element)) return drawChoreographyTask(parentNode, element, this.styles);
    if (is(element, 'bpmn:Event')) return drawEventWithIcon(parentNode, element, this.bpmnRenderer);
    if (is(element, 'bpmn:DataStoreReference')) return drawDataStore(parentNode, element, this.bpmnRenderer);
    if (is(element, 'bpmn:Activity')) return drawActivity(parentNode, element, this.bpmnRenderer, iconClass, !!templateIcon);
    if (is(element, 'bpmn:Gateway')) return drawGateway(parentNode, element, iconClass, this.styles);

    return this.bpmnRenderer.handlers[element.type]?.(parentNode, element);
  }
}
