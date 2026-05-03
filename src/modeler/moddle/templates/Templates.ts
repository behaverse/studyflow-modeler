import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { getAppliedType } from '../../extensions';
import { runCreateTemplateConnection, runCreateTemplateShape } from '../../commands/shape';
import type {
  Template,
  TemplateFlowConnection,
  TemplateFlowNode,
} from './types';

export const TEMPLATE_FLOW_ELEMENTS = '__studyflowTemplateFlowElements';

export default class Templates {

  static $inject = [
    'elementFactory',
    'bpmnFactory',
    'moddle',
    'eventBus'
  ];

  private _elementFactory: any;
  private _bpmnFactory: any;
  private _moddle: any;
  private _eventBus: any;
  private _templates: Template[] = [];

  constructor(
    elementFactory: any,
    bpmnFactory: any,
    moddle: any,
    eventBus: any,
  ) {
    this._elementFactory = elementFactory;
    this._bpmnFactory = bpmnFactory;
    this._moddle = moddle;
    this._eventBus = eventBus;
  }

  private _createTemplateShape(
    definition: Pick<TemplateFlowNode, 'bpmnType' | 'studyflowType' | 'overrideIconClass' | 'templateProperties'> & {
      x?: number;
      y?: number;
      parent?: any;
    },
  ): any {
    return runCreateTemplateShape({
      type: 'create-template-shape',
      elementFactory: this._elementFactory,
      moddle: this._moddle,
      bpmnType: definition.bpmnType,
      studyflowType: definition.studyflowType,
      overrideIconClass: definition.overrideIconClass,
      templateProperties: definition.templateProperties,
      x: definition.x,
      y: definition.y,
      parent: definition.parent,
    });
  }

  createFlowNodeShape(
    definition: TemplateFlowNode,
    parent: any,
  ): any {
    return this._createTemplateShape({
      bpmnType: definition.bpmnType,
      studyflowType: definition.studyflowType,
      overrideIconClass: definition.overrideIconClass,
      templateProperties: definition.templateProperties,
      x: definition.x,
      y: definition.y,
      parent,
    });
  }

  createFlowConnection(
    definition: TemplateFlowConnection,
    source: any,
    target: any,
    parent: any,
  ): any {
    return runCreateTemplateConnection({
      type: 'create-template-connection',
      elementFactory: this._elementFactory,
      definition,
      source,
      target,
      parent,
    });
  }

  private _attachNestedFlowElements(template: Template, rootShape: any): any {
    if (!template.flowElements?.length || template.bpmnType !== 'bpmn:SubProcess') {
      return rootShape;
    }

    rootShape[TEMPLATE_FLOW_ELEMENTS] = template.flowElements;

    return rootShape;
  }

  /**
   * Replace the full set of templates.
   * Called by TemplatesLoader after templates are built.
   */
  set(templates: Template[]): void {
    this._templates = templates;
    this._eventBus.fire('elementTemplates.changed');
  }

  // --- API consumed by CreateAppendElementTemplatesModule

  /**
   * Return the latest templates.
   *
   * When called with an `element`, returns only templates whose
   * `appliesTo` match the element's BPMN type (used by the replace
   * provider).
   */
  getLatest(element?: any): Template[] {
    if (!element) {
      return this._templates;
    }
    const bo = getBusinessObject(element);
    const type = bo?.$type;
    return this._templates.filter(t =>
      t.appliesTo.includes(type)
    );
  }

  /**
   * Get the template currently applied to `element`, or null.
   */
  get(element: any): Template | null {
    const sfType = getAppliedType(element);
    if (!sfType) return null;
    return this._templates.find(t => t.studyflowType === sfType) ?? null;
  }

  /**
   * Get all registered templates.
   */
  getAll(): Template[] {
    return this._templates;
  }

  /**
   * Get schema templates that belong to a specific schema prefix.
   */
  getBySchemaPrefix(prefix: string): Template[] {
    const normalizedPrefix = prefix.toLowerCase();

    return this._templates.filter((template) =>
      (template.templateSource === 'schema-template' || template.templateSource === 'schema-type')
      && template.schemaPrefix?.toLowerCase() === normalizedPrefix,
    );
  }

  /**
   * Create a new diagram shape for the given template.
   *
   * This is the main factory method used by Create/Append providers
   * from bpmn-js-create-append-anything.
   */
  createElement(template: Template): any {
    const shape = this._createTemplateShape({
      bpmnType: template.bpmnType,
      studyflowType: template.studyflowType,
      templateProperties: template.templateProperties,
      overrideIconClass: template.overrideIconClass,
    });

    return this._attachNestedFlowElements(template, shape);
  }

  /**
   * Apply a template to an existing element (replace).
   * Stubbed — replace support is not implemented.
   */
  applyTemplate(_element: any, _template: Template): void {
    // no-op
  }

  /**
   * Remove a template from an element.
   * Stubbed — remove support is not implemented.
   */
  removeTemplate(_element: any): void {
    // no-op
  }
}
