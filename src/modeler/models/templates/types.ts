// Template types live in the core catalog; re-exported here for the
// bpmn-js-facing modules (elementTemplates, bpmn-js-create-append-anything).
import type {
  TemplateFlowConnection,
  TemplateFlowElement,
  TemplateFlowNode,
} from '@/core/catalog';

export type {
  Template,
  TemplateFlowConnection,
  TemplateFlowElement,
  TemplateFlowNode,
} from '@/core/catalog';

/** Pure discriminators over a template flow element's `kind`. */
export const isFlowNode = (e: TemplateFlowElement): e is TemplateFlowNode => e.kind === 'node';
export const isFlowConnection = (e: TemplateFlowElement): e is TemplateFlowConnection =>
  e.kind === 'connection';
