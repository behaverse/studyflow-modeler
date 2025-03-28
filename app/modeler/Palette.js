export default class StudyflowPalette {

  static $inject = ['create', 'elementFactory', 'palette', 'translate'];

  constructor(create, elementFactory, palette, translate) {
    this.create = create;
    this.elementFactory = elementFactory;
    this.translate = translate;
    this.bpmnFactory = elementFactory._bpmnFactory;

    palette.registerProvider(this);
  }

  getPaletteEntries(element) {  // eslint-disable-line no-unused-vars
    const {
      create,
      elementFactory,
      bpmnFactory
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

    function createElement(type, event) {
      const shape = createShape(type);
      create.start(event, shape);
    }

    //TODO: use the same reusable pattern asin ContextPad.js to create commands
    const commands = {
      'sep': {
        separator: true
      },
      'create.studyflow-cognitive-test': {
        group: 'studyflow',
        className: 'sfi-CognitiveTest',
        title: 'Create Cognitive Test or Video Game',
        action: {
          dragstart: createElement.bind(null, 'studyflow:CognitiveTest'),
          click: createElement.bind(null, 'studyflow:CognitiveTest'),
        }
      },
      'create.studyflow-questionnaire': {
        group: 'studyflow',
        className: 'sfi-Questionnaire',
        title: 'Create Questionnaire',
        action: {
          dragstart: createElement.bind(null, 'studyflow:Questionnaire'),
          click: createElement.bind(null, 'studyflow:Questionnaire'),
        }
      },
      'create.studyflow-instruction': {
        group: 'studyflow',
        className: 'sfi-Instruction',
        title: 'Create Instruction',
        action: {
          dragstart: createElement.bind(null, 'studyflow:Instruction'),
          click: createElement.bind(null, 'studyflow:Instruction'),
        }
      },
      'create.studyflow-random-gateway': {
        group: 'studyflow',
        className: 'sfi-RandomGatewayDiamond',
        title: 'Create Random Gateway',
        action: {
          dragstart: createElement.bind(null, 'studyflow:RandomGateway'),
          click: createElement.bind(null, 'studyflow:RandomGateway'),
        }
      },
    }

    return function (entries) {
      delete entries['space-tool'];
      delete entries['create.exclusive-gateway'];
      delete entries['create.data-store'];
      delete entries['create.task'];
      delete entries['create.subprocess-expanded'];
      delete entries['create.group'];
      delete entries['create.data-object'];
      delete entries['create.intermediate-event'];
      delete entries['create.participant-expanded'];
      return { ...entries, ...commands };
    };
  }
}
