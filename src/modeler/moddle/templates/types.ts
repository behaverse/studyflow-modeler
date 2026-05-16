// Template types consumed by elementTemplates and bpmn-js-create-append-anything.

export interface TemplateFlowNode {
  id: string;
  kind: 'node';
  extensionType?: string;
  bpmnType: string;
  iconClass?: string;
  overrideIconClass?: string;
  templateAttributes?: Record<string, any>;
  x?: number;
  y?: number;
}

export interface TemplateFlowConnection {
  id?: string;
  kind: 'connection';
  bpmnType: string;
  sourceRef: string;
  targetRef: string;
  templateAttributes?: Record<string, any>;
}

export type TemplateFlowElement = TemplateFlowNode | TemplateFlowConnection;

export interface Template {
  // bpmn-js-create-append-anything plugin contract
  id: string;
  name: string;
  description?: string;
  appliesTo: string[];
  elementType?: { value: string };
  category?: { id: string; name: string };
  keywords?: string[];

  // Studyflow-specific
  extensionType: string;
  bpmnType: string;
  iconClass?: string;
  overrideIconClass?: string;
  templateAttributes?: Record<string, any>;
  flowElements?: TemplateFlowElement[];
  templateSource?: 'schema-template' | 'schema-type';
  schemaPrefix?: string;
}
