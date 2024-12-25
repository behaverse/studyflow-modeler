export default class BFlowContextPad {

  static $inject = ['config', 'contextPad', 'create', 'elementFactory', 'injector', 'translate'];

  constructor(config, contextPad, create, elementFactory, injector, translate) {
    this.create = create;
    this.elementFactory = elementFactory;
    this.translate = translate;

    if (config.autoPlace !== false) {
      this.autoPlace = injector.get('autoPlace', false);
    }

    contextPad.registerProvider(this);
  }

  getContextPadEntries(element) {
    const {
      autoPlace, create, elementFactory, translate
    } = this;

    function appendActivity(event, element) {
      if (autoPlace) {
        const shape = elementFactory.createShape({ type: 'bflow:Activity' });
        autoPlace.append(element, shape);
      } else {
        createActivity(event, element);
      }
    }

    function createActivity(event) {
      const shape = elementFactory.createShape({ type: 'bflow:Activity' });
      create.start(event, shape, element);
    }

    return {
      'append.bflow-activity': {
        group: 'bflow',
        className: 'bpmn-icon-user-task',
        title: translate('Append BFlow Activity'),
        action: {
          click: appendActivity,
          dragstart: createActivity
        }
      }
    };
  }
}
