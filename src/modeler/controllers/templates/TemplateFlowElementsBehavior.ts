import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';
import { runMaterializeTemplateFlow } from '@/modeler/controllers/templates/materializeTemplateFlow';
import { TEMPLATE_FLOW_ELEMENTS } from '@/modeler/controllers/templates/Templates';
import type Templates from '@/modeler/controllers/templates/Templates';

const TEMPLATE_FLOW_HINT = '__studyflowCreatingTemplateFlow';

export default class TemplateFlowElementsBehavior extends CommandInterceptor {

  static $inject = ['eventBus', 'modeling', 'elementTemplates'];

  constructor(eventBus: any, modeling: any, elementTemplates: Templates) {
    super(eventBus);

    this.postExecuted('shape.create', (context: any) => {
      const { shape, hints, newRootElement } = context;
      if (!shape || hints?.[TEMPLATE_FLOW_HINT]) return;

      runMaterializeTemplateFlow({
        type: 'materialize-template-flow',
        modeling,
        templatesService: elementTemplates,
        shape,
        newRootElement,
        hintKey: TEMPLATE_FLOW_HINT,
      });
    }, true);
  }
}
