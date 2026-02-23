export default class StudyflowContextPad {
  static $inject = ['contextPad', 'eventBus'];

  constructor(contextPad, eventBus) {
    this._contextPad = contextPad;
    this._eventBus = eventBus;
    this._disabled = false;
    contextPad.registerProvider(this);

    // Listen for simulation toggle event
    eventBus.on('tokenSimulation.toggle', ({ active }) => {
      this._disabled = !!active;
      if (active && typeof contextPad.close === 'function') {
        contextPad.close();
      }
    });

    // HACK Silence ContextPad#getPad deprecation warning (diagram-js 15.x vs bpmn-js 18.x compat issue). Warning is suppressed until bpmn-js ships a fix. See https://github.com/bpmn-io/diagram-js/pull/888
    if (typeof contextPad.getPad === 'function') {
      const originalGetPad = contextPad.getPad.bind(contextPad);
      contextPad.getPad = function(target) {
        const originalWarn = console.warn;
        console.warn = (...args) => {
          if (args[0]?.message?.includes?.('ContextPad#getPad is deprecated')) return;
          originalWarn.apply(console, args);
        };
        try {
          return originalGetPad(target);
        } finally {
          console.warn = originalWarn;
        }
      };
    }
  }

  // eslint-disable-next-line no-unused-vars
  getContextPadEntries(element) {
    return (entries) => {
      if (this._disabled) return {};
      delete entries['append.append-task'];
      delete entries['append.gateway'];
      delete entries['append.intermediate-event'];
      return entries;
    };
  }
}
