/**
 * Example descriptor used by the element templates service
 * and consumed by CreateAppendElementTemplatesModule.
 */
export interface ExampleFlowNode {
  id: string;
  kind: 'node';
  studyflowType?: string;
  bpmnType: string;
  iconClass?: string;
  overrideIconClass?: string;
  exampleProperties?: Record<string, any>;
  x?: number;
  y?: number;
}

export interface ExampleFlowConnection {
  id?: string;
  kind: 'connection';
  bpmnType: string;
  sourceRef: string;
  targetRef: string;
  exampleProperties?: Record<string, any>;
}

export type ExampleFlowElement = ExampleFlowNode | ExampleFlowConnection;

export interface Example {
  /** Unique template identifier */
  id: string;
  /** Optional version number */
  version?: number;
  /** Human-readable name shown in menus */
  name: string;
  /** Short description shown in menus */
  description?: string;
  /** URL to documentation */
  documentationRef?: string;
  /** BPMN types this template can be applied to */
  appliesTo: string[];
  /** Optional icon descriptor */
  icon?: { contents?: string };
  /** Menu group */
  category?: { id: string; name: string };
  /** Search keywords */
  keywords?: string[];
  /** The underlying BPMN type to create (e.g., "bpmn:Task") */
  elementType?: { value: string };
  /** Template properties (simplified – we use studyflow extensions) */
  properties?: Array<{
    label: string;
    type: string;
    value?: any;
    binding: { type: string; name: string };
  }>;

  // ── Studyflow-specific fields ──

  /** The studyflow moddle type name (e.g., "studyflow:CognitiveTask") */
  studyflowType: string;
  /** The BPMN base type resolved from the schema hierarchy */
  bpmnType: string;
  /** Icon class string from the schema (e.g., "iconify bi--puzzle") */
  iconClass?: string;
  /** Explicit icon override declared directly on the example object */
  overrideIconClass?: string;
  /** Property values from the LinkML example object */
  exampleProperties?: Record<string, any>;
  /** Optional nested subprocess content normalized from schema examples */
  flowElements?: ExampleFlowElement[];
  /** Source marker used to route template visibility in popup menus */
  templateSource?: 'schema-example';
  /** Lowercase schema prefix (e.g., "behaverse") that owns this template */
  schemaPrefix?: string;
}
