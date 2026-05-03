import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';
import { runMaterializeTemplateFlow } from '../../commands/templates';
import { TEMPLATE_FLOW_ELEMENTS } from './Templates';
import type Templates from './Templates';

const TEMPLATE_FLOW_HINT = '__studyflowCreatingTemplateFlow';

export default class TemplateFlowElementsBehavior extends CommandInterceptor {

  static $inject = ['eventBus', 'modeling', 'elementTemplates'];

  private _modeling: any;
  private _templates: Templates;

  constructor(eventBus: any, modeling: any, elementTemplates: Templates) {
    super(eventBus);

    this._modeling = modeling;
    this._templates = elementTemplates;

    this.postExecuted('shape.create', (context: any) => {
      this._createNestedFlowElements(context);
    }, true);
  }

  private _createNestedFlowElements(context: any): void {
    const { shape, hints } = context;

    if (!shape || hints?.[TEMPLATE_FLOW_HINT]) {
      return;
    }

    runMaterializeTemplateFlow({
      type: 'materialize-template-flow',
      modeling: this._modeling,
      templatesService: this._templates,
      shape,
      newRootElement: context.newRootElement,
      hintKey: TEMPLATE_FLOW_HINT,
    });
  }
}
