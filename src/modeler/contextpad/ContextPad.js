// @ts-check

import { silenceGetPadDeprecationWarning } from './silenceDeprecationWarning';

/**
 * Studyflow context-pad provider.
 *
 * Registers with bpmn-js's `contextPad` and removes the built-in
 * append entries (we provide our own via `AppendMenuProvider`).
 * Also closes the pad while token simulation is running.
 */
export default class StudyflowContextPad {
  static $inject = ['contextPad', 'eventBus'];

  /**
   * @param {any} contextPad bpmn-js context pad service
   * @param {any} eventBus   bpmn-js event bus
   */
  constructor(contextPad, eventBus) {
    this._contextPad = contextPad;
    this._eventBus = eventBus;
    this._disabled = false;
    contextPad.registerProvider(this);

    // Close the pad when simulation starts, re-enable when it stops.
    eventBus.on('tokenSimulation.toggle', ({ active }) => {
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
   *
   * @param {any} _element
   */
  // eslint-disable-next-line no-unused-vars
  getContextPadEntries(_element) {
    return (/** @type {Record<string, any>} */ entries) => {
      if (this._disabled) return {};
      delete entries['append.append-task'];
      delete entries['append.gateway'];
      delete entries['append.intermediate-event'];
      return entries;
    };
  }
}
