import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import {
  createStudyflowExtension,
  getStudyflowDefaults,
  getStudyflowExtension,
  isExtendsType
} from '../../extensionElements';
import type { Example } from './types';

function setNamespacedAttr(target: any, attrName: string, value: any): void {
  if (!target || value === undefined) {
    return;
  }

  if (typeof target.set === 'function') {
    try {
      target.set(attrName, value);
      return;
    } catch {
      // Fall through to direct $attrs mutation when supported.
    }
  }

  const attrs = target.$attrs;
  if (attrs && typeof attrs === 'object') {
    attrs[attrName] = value;
  }
}

function toFiniteNumber(value: any): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function extractExampleDimensions(properties: Record<string, any>): { width?: number; height?: number } {
  const width = toFiniteNumber(properties['bpmn:width'] ?? properties.width);
  const height = toFiniteNumber(properties['bpmn:height'] ?? properties.height);

  delete properties['bpmn:width'];
  delete properties['bpmn:height'];
  delete properties.width;
  delete properties.height;

  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

export default class Examples {

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
  private _examples: Example[] = [];

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

  // ── Example registry ───────────────────────────────────────────────

  /**
   * Replace the full set of examples.
   * Called by ExamplesLoader after examples are built.
   */
  set(examples: Example[]): void {
    this._examples = examples;
    this._eventBus.fire('elementTemplates.changed');
  }

  // ── API consumed by CreateAppendElementTemplatesModule ─────────────

  /**
  * Return the latest examples.
   *
   * When called with an `element`, returns only examples whose
   * `appliesTo` match the element's BPMN type (used by the replace
   * provider).
   */
  getLatest(element?: any): Example[] {
    if (!element) {
      return this._examples;
    }
    const bo = getBusinessObject(element);
    const type = bo?.$type;
    return this._examples.filter(t =>
      t.appliesTo.includes(type)
    );
  }

  /**
   * Get the example currently applied to `element`, or null.
   */
  get(element: any): Example | null {
    const ext = getStudyflowExtension(element);
    if (!ext) return null;
    const sfType: string | undefined = ext.$type;
    return this._examples.find(t => t.studyflowType === sfType) ?? null;
  }

  /**
   * Get all registered examples.
   */
  getAll(): Example[] {
    return this._examples;
  }

  /**
   * Get schema examples that belong to a specific schema prefix.
   */
  getBySchemaPrefix(prefix: string): Example[] {
    const normalizedPrefix = prefix.toLowerCase();

    return this._examples.filter((example) =>
      example.templateSource === 'schema-example'
      && example.schemaPrefix?.toLowerCase() === normalizedPrefix,
    );
  }

  /**
  * Create a new diagram shape for the given example.
   *
   * This is the main factory method used by Create/Append providers
   * from bpmn-js-create-append-anything.
   */
  createElement(example: Example): any {
    const { bpmnType, studyflowType, exampleProperties, iconClass } = example;

    const defaults = studyflowType
      ? getStudyflowDefaults(studyflowType, this._moddle)
      : {};

    // Merge defaults first, then example overrides.
    const properties: Record<string, any> = {
      ...defaults,
      ...(exampleProperties || {}),
    };
    const size = extractExampleDimensions(properties);

    // 1. Create the BPMN shape (optionally with example-driven dimensions)
    const shape = this._elementFactory.create('shape', {
      type: bpmnType,
      ...size,
    });

    // 2. Attach studyflow extension or set extends-based defaults
    if (studyflowType) {
      const bo = shape.businessObject;

      const bpmnName = properties['bpmn:name'];
      if (bpmnName !== undefined) {
        delete properties['bpmn:name'];
        bo.set('name', bpmnName);
      }

      if (isExtendsType(studyflowType, this._moddle)) {
        for (const [key, val] of Object.entries(properties)) {
          bo.set(key, val);
        }

        if (iconClass) {
          const schemaPrefix = studyflowType.split(':')[0];
          const iconAttrName = `${schemaPrefix}:icon`;
          setNamespacedAttr(bo, iconAttrName, iconClass);
        }
      } else {
        const ext = createStudyflowExtension(bo, studyflowType, this._moddle, properties);

        if (iconClass) {
          const schemaPrefix = studyflowType.split(':')[0];
          const iconAttrName = `${schemaPrefix}:icon`;
          setNamespacedAttr(ext, iconAttrName, iconClass);
        }
      }
    }

    return shape;
  }

  /**
  * Apply an example to an existing element (replace).
   * Stubbed — replace support is not implemented.
   */
  applyTemplate(_element: any, _example: Example): void {
    // no-op
  }

  /**
  * Remove an example from an element.
   * Stubbed — remove support is not implemented.
   */
  removeTemplate(_element: any): void {
    // no-op
  }
}
