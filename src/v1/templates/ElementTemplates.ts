import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import {
  createStudyflowExtension,
  getStudyflowDefaults,
  getStudyflowExtension,
  isExtendsType
} from '../extensionElements';
import type { ElementTemplate } from './types';

export default class ElementTemplates {

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
  private _templates: ElementTemplate[] = [];

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

  // ── Template registry ──────────────────────────────────────────────

  /**
   * Replace the full set of templates.
   * Called by SchemaTemplateLoader after templates are built.
   */
  set(templates: ElementTemplate[]): void {
    this._templates = templates;
    this._eventBus.fire('elementTemplates.changed');
  }

  // ── API consumed by CreateAppendElementTemplatesModule ─────────────

  /**
   * Return the latest templates.
   *
   * When called with an `element`, returns only templates whose
   * `appliesTo` match the element's BPMN type (used by the replace
   * provider).
   */
  getLatest(element?: any): ElementTemplate[] {
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
  get(element: any): ElementTemplate | null {
    const ext = getStudyflowExtension(element);
    if (!ext) return null;
    const sfType: string | undefined = ext.$type;
    return this._templates.find(t => t.studyflowType === sfType) ?? null;
  }

  /**
   * Get all registered templates.
   */
  getAll(): ElementTemplate[] {
    return this._templates;
  }

  /**
   * Create a new diagram shape for the given template.
   *
   * This is the main factory method used by Create/Append providers
   * from bpmn-js-create-append-anything.
   */
  createElement(template: ElementTemplate): any {
    const { bpmnType, studyflowType } = template;

    // 1. Create the BPMN shape
    const shape = this._elementFactory.create('shape', { type: bpmnType });

    // 2. Attach studyflow extension or set extends-based defaults
    if (studyflowType) {
      const bo = shape.businessObject;
      const defaults = getStudyflowDefaults(studyflowType, this._moddle);

      if (isExtendsType(studyflowType, this._moddle)) {
        for (const [key, val] of Object.entries(defaults)) {
          bo.set(key, val);
        }
      } else {
        createStudyflowExtension(bo, studyflowType, this._moddle, defaults);
      }
    }

    return shape;
  }

  /**
   * Apply a template to an existing element (replace).
   * Stubbed — replace support is not implemented.
   */
  applyTemplate(_element: any, _template: ElementTemplate): void {
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
