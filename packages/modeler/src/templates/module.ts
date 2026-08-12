import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';
import { getCatalog } from '@core/notation';
import Templates from '@modeler/templates/Templates';
import { materializeTemplateFlow } from '@modeler/templates/factory';

const TEMPLATE_FLOW_HINT = '__studyflowCreatingTemplateFlow';

class TemplateFlowElementsBehavior extends CommandInterceptor {

  static $inject = ['eventBus', 'modeling', 'elementTemplates'];

  constructor(eventBus: any, modeling: any, elementTemplates: Templates) {
    super(eventBus);

    this.postExecuted('shape.create', (context: any) => {
      const { shape, hints, newRootElement } = context;
      if (!shape || hints?.[TEMPLATE_FLOW_HINT]) return;

      materializeTemplateFlow({
        modeling,
        templatesService: elementTemplates,
        shape,
        newRootElement,
        hintKey: TEMPLATE_FLOW_HINT,
      });
    }, true);
  }
}

class TemplatesLoader {
  static $inject = ['elementTemplates', 'eventBus'];

  constructor(elementTemplates: any, eventBus: any) {
    eventBus.on('diagram.init', () => {
      elementTemplates.set(getCatalog().allTemplates());
    });
  }
}

export default {
  __init__: ['templatesLoader', 'templateFlowElementsBehavior'],
  // DI token name kept as `elementTemplates` — bpmn-js-create-append-anything resolves it.
  elementTemplates: ['type', Templates],
  templatesLoader: ['type', TemplatesLoader],
  templateFlowElementsBehavior: ['type', TemplateFlowElementsBehavior],
};
