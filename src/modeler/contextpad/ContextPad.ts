import { silenceGetPadDeprecationWarning } from './silenceDeprecationWarning';
import type { ContextPad, EventBus } from '../bpmn-js';

/**
 * Studyflow context-pad provider.
 *
 * Registers with bpmn-js's `contextPad` and removes the built-in
 * append entries (we provide our own via `AppendMenuProvider`).
 * Also closes the pad while token simulation is running.
 */
export default class StudyflowContextPad {
  static $inject = ['contextPad', 'eventBus'];

  _contextPad: ContextPad;
  _eventBus: EventBus;
  _disabled: boolean;

  constructor(contextPad: ContextPad, eventBus: EventBus) {
    this._contextPad = contextPad;
    this._eventBus = eventBus;
    this._disabled = false;
    contextPad.registerProvider(this);

    // Close the pad when simulation starts, re-enable when it stops.
    eventBus.on('tokenSimulation.toggle', ({ active }: { active: boolean }) => {
      this._disabled = !!active;
      if (active && typeof contextPad.close === 'function') {
        contextPad.close();
      }
    });

    silenceGetPadDeprecationWarning(contextPad);
  }

  /**
   * Hide the default append/gateway/intermediate-event entries so our
   * custom append menu is the only path.
   */
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
