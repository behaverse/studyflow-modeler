export default class StudyFlowContextPad {

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
      const shape = elementFactory.createShape({ type: 'studyflow:Activity' });
      if (autoPlace) {
        autoPlace.append(element, shape);
      } else {
        create.start(event, shape, element);
      }
    }

    function createActivity(event) {
      const shape = elementFactory.createShape({ type: 'studyflow:Activity' });
      create.start(event, shape, element);
    }

    function appendRandomAssignment(event, element) {
      const shape = elementFactory.createShape({
        type: 'studyflow:RandomAssignment'
      });
      if (autoPlace) {
        autoPlace.append(element, shape);
      } else {
        create.start(event, shape, element);
      }
    }

    return {
      'append.studyflow-activity': {
        group: 'studyflow',
        className: 'bi bi-person-gear',
        title: translate('Append StudyFlow Activity'),
        action: {
          click: appendActivity,
          dragstart: createActivity
        }
      },
      'append.studyflow-random-assignment': {
        group: 'studyflow',
        className: 'bi bi-dice-6',
        title: translate('Append Random Assignment'),
        action: {
          click: appendRandomAssignment
        }
      }
    };
  }
}
