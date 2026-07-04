import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { StudyflowElement } from '@/core/extensions';
import { runCreateTemplateConnection, runCreateTemplateShape } from '@/modeler/controllers/commands/shape';
import type {
  Template,
  TemplateFlowConnection,
  TemplateFlowNode,
} from '@/modeler/models/templates/types';

// Stash key on a SubProcess shape for TemplateFlowElementsBehavior to materialize nested flow elements.
export const TEMPLATE_FLOW_ELEMENTS = '__studyflowTemplateFlowElements';

type ShapeDefinition = Pick<TemplateFlowNode, 'bpmnType' | 'extensionType' | 'overrideIconClass' | 'templateAttributes'> & {
  x?: number;
  y?: number;
  parent?: any;
};

/** `elementTemplates` DI service: implements the bpmn-js-create-append-anything contract. */
export default class Templates {

  static $inject = ['elementFactory', 'moddle', 'eventBus'];

  private _elementFactory: any;
  private _moddle: any;
  private _eventBus: any;
  private _templates: Template[] = [];

  constructor(elementFactory: any, moddle: any, eventBus: any) {
    this._elementFactory = elementFactory;
    this._moddle = moddle;
    this._eventBus = eventBus;
  }

  private _createShape(definition: ShapeDefinition): any {
    return runCreateTemplateShape({
      type: 'create-template-shape',
      elementFactory: this._elementFactory,
      moddle: this._moddle,
      ...definition,
    });
  }

  createFlowNodeShape(definition: TemplateFlowNode, parent: any): any {
    return this._createShape({ ...definition, parent });
  }

  createFlowConnection(definition: TemplateFlowConnection, source: any, target: any, parent: any): any {
    return runCreateTemplateConnection({
      type: 'create-template-connection',
      elementFactory: this._elementFactory,
      definition,
      source,
      target,
      parent,
    });
  }

  set(templates: Template[]): void {
    this._templates = templates;
    this._eventBus.fire('elementTemplates.changed');
  }

  getLatest(element?: any): Template[] {
    if (!element) return this._templates;
    const type = getBusinessObject(element)?.$type;
    return this._templates.filter((t) => t.appliesTo.includes(type));
  }

  get(element: any): Template | null {
    const extType = StudyflowElement.fromBusinessObject(element).extensionType;
    if (!extType) return null;
    return this._templates.find((t) => t.extensionType === extType) ?? null;
  }

  getAll(): Template[] {
    return this._templates;
  }

  getBySchemaPrefix(prefix: string): Template[] {
    const normalized = prefix.toLowerCase();
    return this._templates.filter((t) =>
      (t.templateSource === 'schema-template' || t.templateSource === 'schema-type')
      && t.schemaPrefix?.toLowerCase() === normalized,
    );
  }

  createElement(template: Template): any {
    const shape = this._createShape({
      bpmnType: template.bpmnType,
      extensionType: template.extensionType,
      templateAttributes: template.templateAttributes,
      overrideIconClass: template.overrideIconClass,
    });

    if (template.flowElements?.length && template.bpmnType === 'bpmn:SubProcess') {
      shape[TEMPLATE_FLOW_ELEMENTS] = template.flowElements;
    }
    return shape;
  }

  // Required by the plugin contract; replace/remove are not supported.
  applyTemplate(_element: any, _template: Template): void {}
  removeTemplate(_element: any): void {}
}
