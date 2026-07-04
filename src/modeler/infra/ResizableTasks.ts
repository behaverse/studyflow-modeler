import { is } from 'bpmn-js/lib/util/ModelUtil';
import RuleProvider from 'diagram-js/lib/features/rules/RuleProvider';

/** Allow resize on Task / SubProcess / CallActivity; otherwise defer to bpmn-rules. */
export default class ResizableTasks extends RuleProvider {
  static $inject = ['bpmnRules', 'eventBus'];

  private _bpmnRules: any;

  constructor(bpmnRules: any, eventBus: any) {
    super(eventBus);
    this._bpmnRules = bpmnRules;
  }

  init() {
    this.addRule('shape.resize', Infinity, ({ shape, newBounds }: any) => {
      return is(shape, 'bpmn:Task')
        || is(shape, 'bpmn:SubProcess')
        || is(shape, 'bpmn:CallActivity')
        || is(shape, 'bpmn:ChoreographyTask')
        || this._bpmnRules.canResize(shape, newBounds);
    });
  }
}
