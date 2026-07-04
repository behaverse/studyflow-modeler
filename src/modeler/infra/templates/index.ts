// Element Templates module: builds and registers schema-driven templates with bpmn-js-create-append-anything.

import Templates from '@/modeler/controllers/templates/Templates';
import TemplateFlowElementsBehavior from '@/modeler/controllers/templates/TemplateFlowElementsBehavior';
import TemplatesLoader from '@/modeler/infra/templates/TemplatesLoader';

export default {
  __init__: ['templatesLoader', 'templateFlowElementsBehavior'],
  // DI token name kept unchanged for third-party compatibility.
  elementTemplates: ['type', Templates],
  templatesLoader: ['type', TemplatesLoader],
  templateFlowElementsBehavior: ['type', TemplateFlowElementsBehavior],
};
