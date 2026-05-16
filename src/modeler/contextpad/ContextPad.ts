import { silenceGetPadDeprecationWarning } from './silenceDeprecationWarning';
import { TOGGLE_SIMULATION_EVENT } from '../simulation/TokenSimulator';
import type { ContextPad, EventBus } from '../bpmn-js';

/** Filters bpmn-js's contextPad: hides built-in append entries and closes during simulation. */
export default class StudyflowContextPad {
  static $inject = ['contextPad', 'eventBus'];

  private _disabled = false;

  constructor(contextPad: ContextPad, eventBus: EventBus) {
    contextPad.registerProvider(this);

    eventBus.on(TOGGLE_SIMULATION_EVENT, ({ active }: { active: boolean }) => {
      this._disabled = !!active;
      if (active) contextPad.close?.();
    });

    silenceGetPadDeprecationWarning(contextPad);
  }

  getContextPadEntries(_element: any) {
    return (entries: Record<string, any>) => {
      if (this._disabled) return {};
      delete entries['append.append-task'];
      delete entries['append.gateway'];
      delete entries['append.intermediate-event'];
      return entries;
    };
  }
}
