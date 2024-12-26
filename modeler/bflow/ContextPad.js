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
      const shape = elementFactory.createShape({ type: 'bflow:Activity' });
      if (autoPlace) {
        autoPlace.append(element, shape);
      } else {
        create.start(event, shape, element);
      }
    }

    function createActivity(event) {
      const shape = elementFactory.createShape({ type: 'bflow:Activity' });
      create.start(event, shape, element);
    }

    function appendRandomAssignment(event, element) {
      const shape = elementFactory.createShape({
        type: 'bflow:RandomAssignment'
      });
      if (autoPlace) {
        autoPlace.append(element, shape);
      } else {
        create.start(event, shape, element);
      }
    }

    return {
      'append.bflow-activity': {
        group: 'bflow',
        className: 'bi bi-puzzle',
        title: translate('Append Cognitive Test'),
        action: {
          click: appendActivity,
          dragstart: createActivity
        }
      },
      'append.bflow-random-assignment': {
        group: 'bflow',
        className: 'bi bi-dice-6',
        title: translate('Append BFlow Random Assignment Gateway'),
        action: {
          click: appendRandomAssignment
        }
      }
    };
  }
}
