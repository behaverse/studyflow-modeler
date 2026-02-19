import { is } from 'bpmn-js/lib/util/ModelUtil';
import RuleProvider from 'diagram-js/lib/features/rules/RuleProvider';

export default class ResizableTasks extends RuleProvider {
  constructor(bpmnRules, eventBus) {
    super(eventBus);
    this._bpmnRules = bpmnRules;
  }

  init() {
    this.addRule('shape.resize', Infinity, ({ shape, newBounds }) => {
      return is(shape, 'bpmn:Task') ||
             is(shape, 'bpmn:SubProcess') ||
             is(shape, 'bpmn:CallActivity') ||
             this._bpmnRules.canResize(shape, newBounds);
    });
  }
}

ResizableTasks.$inject = ['bpmnRules', 'eventBus'];
