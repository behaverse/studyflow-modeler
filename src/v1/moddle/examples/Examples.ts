import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { getAppliedStudyflowType } from '../../extensionElements';
import { runCreateExampleConnection } from '../../commands/createExampleConnection';
import { runCreateExampleShape } from '../../commands/createExampleShape';
import type {
  Example,
  ExampleFlowConnection,
  ExampleFlowNode,
} from './types';

export const EXAMPLE_FLOW_ELEMENTS = '__studyflowExampleFlowElements';

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

  private _createExampleShape(
    definition: Pick<ExampleFlowNode, 'bpmnType' | 'studyflowType' | 'overrideIconClass' | 'exampleProperties'> & {
      x?: number;
      y?: number;
      parent?: any;
    },
  ): any {
    return runCreateExampleShape({
      type: 'create-example-shape',
      elementFactory: this._elementFactory,
      moddle: this._moddle,
      bpmnType: definition.bpmnType,
      studyflowType: definition.studyflowType,
      overrideIconClass: definition.overrideIconClass,
      exampleProperties: definition.exampleProperties,
      x: definition.x,
      y: definition.y,
      parent: definition.parent,
    });
  }

  createFlowNodeShape(
    definition: ExampleFlowNode,
    parent: any,
  ): any {
    return this._createExampleShape({
      bpmnType: definition.bpmnType,
      studyflowType: definition.studyflowType,
      overrideIconClass: definition.overrideIconClass,
      exampleProperties: definition.exampleProperties,
      x: definition.x,
      y: definition.y,
      parent,
    });
  }

  createFlowConnection(
    definition: ExampleFlowConnection,
    source: any,
    target: any,
    parent: any,
  ): any {
    return runCreateExampleConnection({
      type: 'create-example-connection',
      elementFactory: this._elementFactory,
      definition,
      source,
      target,
      parent,
    });
  }

  private _attachNestedFlowElements(example: Example, rootShape: any): any {
    if (!example.flowElements?.length || example.bpmnType !== 'bpmn:SubProcess') {
      return rootShape;
    }

    rootShape[EXAMPLE_FLOW_ELEMENTS] = example.flowElements;

    return rootShape;
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
    const sfType = getAppliedStudyflowType(element);
    if (!sfType) return null;
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
    const shape = this._createExampleShape({
      bpmnType: example.bpmnType,
      studyflowType: example.studyflowType,
      exampleProperties: example.exampleProperties,
      overrideIconClass: example.overrideIconClass,
    });

    return this._attachNestedFlowElements(example, shape);
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
