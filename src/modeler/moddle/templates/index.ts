/**
 * Studyflow Element Templates Core Module.
 *
 * Provides the `elementTemplates` DI service expected by
 * CreateAppendElementTemplatesModule from bpmn-js-create-append-anything.
 *
 * Templates are built from schema-level `templates:` metadata.
 */

import Templates from './Templates';
import TemplateFlowElementsBehavior from './TemplateFlowElementsBehavior';
import TemplatesLoader from './TemplatesLoader';

export default {
  __init__: ['templatesLoader', 'templateFlowElementsBehavior'],
  // Keep DI token unchanged for third-party compatibility.
  elementTemplates: ['type', Templates],
  templatesLoader: ['type', TemplatesLoader],
  templateFlowElementsBehavior: ['type', TemplateFlowElementsBehavior],
};

export type { Template } from './types';
