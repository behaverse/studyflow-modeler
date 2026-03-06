import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';
import { runMaterializeExampleFlow } from '../../commands/materializeExampleFlow';
import { EXAMPLE_FLOW_ELEMENTS } from './Examples';
import type Examples from './Examples';

const EXAMPLE_FLOW_HINT = '__studyflowCreatingExampleFlow';

export default class ExampleFlowElementsBehavior extends CommandInterceptor {

  static $inject = ['eventBus', 'modeling', 'elementTemplates'];

  private _modeling: any;
  private _examples: Examples;

  constructor(eventBus: any, modeling: any, elementTemplates: Examples) {
    super(eventBus);

    this._modeling = modeling;
    this._examples = elementTemplates;

    this.postExecuted('shape.create', (context: any) => {
      this._createNestedFlowElements(context);
    }, true);
  }

  private _createNestedFlowElements(context: any): void {
    const { shape, hints } = context;

    if (!shape || hints?.[EXAMPLE_FLOW_HINT]) {
      return;
    }

    runMaterializeExampleFlow({
      type: 'materialize-example-flow',
      modeling: this._modeling,
      examplesService: this._examples,
      shape,
      newRootElement: context.newRootElement,
      hintKey: EXAMPLE_FLOW_HINT,
    });
  }
}