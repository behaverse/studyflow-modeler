// Element Templates module: builds and registers schema-driven templates with bpmn-js-create-append-anything.

import Templates from './Templates';
import TemplateFlowElementsBehavior from './TemplateFlowElementsBehavior';
import TemplatesLoader from './TemplatesLoader';

export default {
  __init__: ['templatesLoader', 'templateFlowElementsBehavior'],
  // DI token name kept unchanged for third-party compatibility.
  elementTemplates: ['type', Templates],
  templatesLoader: ['type', TemplatesLoader],
  templateFlowElementsBehavior: ['type', TemplateFlowElementsBehavior],
};
