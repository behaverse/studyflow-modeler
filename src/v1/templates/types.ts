/**
 * Template descriptor used by the ElementTemplates service
 * and consumed by CreateAppendElementTemplatesModule.
 */
export interface ElementTemplate {
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
}
