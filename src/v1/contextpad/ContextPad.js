export default class StudyflowContextPad {

  static $inject = ['config', 'contextPad', 'create', 'elementFactory', 'injector'];

  constructor(config, contextPad, create, elementFactory, injector) {
    this.create = create;
    this.elementFactory = elementFactory;
    this.bpmnFactory = elementFactory._bpmnFactory;

    if (config.autoPlace !== false) {
      this.autoPlace = injector.get('autoPlace', false);
    }

    contextPad.registerProvider(this);
  }

  getContextPadEntries(element) {
    return function (entries) {
      delete entries['append.append-task'];
      delete entries['append.gateway'];
      delete entries['append.intermediate-event'];
      return entries;
    };
  }
}
