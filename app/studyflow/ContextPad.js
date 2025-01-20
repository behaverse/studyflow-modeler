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
  'studyflow:RandomGateway': {
    className: 'bi bi-shuffle',
    title: 'Random Exclusive Gateway'
  },
}

export default class StudyFlowContextPad {

  static $inject = ['config', 'contextPad', 'create', 'elementFactory', 'injector', 'translate'];

  constructor(config, contextPad, create, elementFactory, injector, translate) {
    this.create = create;
    this.elementFactory = elementFactory;
    this.bpmnFactory = elementFactory._bpmnFactory;
    this.translate = translate;

    if (config.autoPlace !== false) {
      this.autoPlace = injector.get('autoPlace', false);
    }

    contextPad.registerProvider(this);
  }

  getContextPadEntries(element) {
    const {
      autoPlace, create, elementFactory, translate, bpmnFactory
    } = this;


    function createShape(element_type) {
      const prefix = element_type.replace('studyflow:', '');
      const el = bpmnFactory._model.create(element_type, {type: element_type});
      el.id = bpmnFactory._model.ids.nextPrefixed(prefix + '_', el)
      const shape = elementFactory.createShape({
        businessObject: el, type: element_type
      });
      return shape;
    }

    function appendElement(type, event, element) {
      // TODO: refactor as StudyFlowFactory.js
      const shape = createShape(type);
      if (event.type.includes('dragstart')) {
        create.start(event, shape, element);
        return
      }

      if (autoPlace) {
        autoPlace.append(element, shape);
      } else {
        create.start(event, shape, element);
      }
    }

    var commands = {};
    for (var studyFlowElement in STUDYFLOW_ELEMENTS) {
      const commandName = 'append.' + studyFlowElement.replace(':', '.');
      const elementInfo = STUDYFLOW_ELEMENTS[studyFlowElement];
      commands[commandName] = {
        group: 'studyflow',
        className: elementInfo.className,
        title: translate('Append ' + elementInfo.title),
        action: {
          click: appendElement.bind(null, studyFlowElement),
          dragstart: appendElement.bind(null, studyFlowElement)
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
