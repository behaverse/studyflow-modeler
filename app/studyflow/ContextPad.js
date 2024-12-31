const STUDYFLOW_ELEMENTS = {
  'studyflow:CognitiveTest': {
    className: 'bi bi-puzzle',
    title: 'Cognitive Test'
  },
  'studyflow:VideoGame': {
    className: 'bi bi-controller',
    title: 'Video Game'
  },
  'studyflow:Questionnaire': {
    className: 'bi bi-pencil',
    title: 'Questionnaire'
  },
  'studyflow:Instruction': {
    className: 'bi bi-chat-square-dots',
    title: 'Instruction'
  },
  'studyflow:RandomAssignment': {
    className: 'bi bi-dice-6 rotate-45 context-pad-dice',
    title: 'Random Assignment Gateway'
  },
}

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


    function appendElement(type, event, element) {
      const shape = elementFactory.createShape({ type: type });
      if (autoPlace) {
        autoPlace.append(element, shape);
      } else {
        create.start(event, shape, element);
      }
    }

    function createElement(type, event) {
      const shape = elementFactory.createShape({ type: type });
      create.start(event, shape, element);
    }

    var commands = {};
    for (var studyFlowElement in STUDYFLOW_ELEMENTS) {
      const command_name = 'append.' + studyFlowElement.replace(':', '.');
      const elementInfo = STUDYFLOW_ELEMENTS[studyFlowElement];
      commands[command_name] = {
        group: 'studyflow',
        className: elementInfo.className,
        title: translate('Append ' + name),
        action: {
          click: appendElement.bind(null, studyFlowElement),
          dragstart: createElement.bind(null, studyFlowElement)
        }
      }
    }

    return function (entries) {
      delete entries['append.append-task'];
      delete entries['append.gateway'];
      delete entries['append.intermediate-event'];
      // move append-anything to the last position
      entries = Object.assign({}, entries,
        { append: { ...entries['append'], group: 'studyflow' } });
      const defaultAppend = entries['append'];
      delete entries['append'];
      return {...entries, ...commands, append: defaultAppend};
    };
  }
}
