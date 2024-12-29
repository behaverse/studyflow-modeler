export default class StudyFlowPalette {

  static $inject = ['create', 'elementFactory', 'palette', 'translate'];

  constructor(create, elementFactory, palette, translate) {
    this.create = create;
    this.elementFactory = elementFactory;
    this.translate = translate;

    palette.registerProvider(this);
  }

  getPaletteEntries(element) {  // eslint-disable-line no-unused-vars
    const {
      create,
      elementFactory
    } = this;

    function createElement(type, event) {
      const shape = elementFactory.createShape({ type: type });
      create.start(event, shape);
    }

    return {
      'sep': {
        separator: true
      },
      'create.studyflow-cognitive-test': {
        group: 'studyflow',
        className: 'bi bi-puzzle',
        title: 'Create Cognitive Test',
        action: {
          dragstart: createElement.bind(null, 'studyflow:CognitiveTest'),
          click: createElement.bind(null, 'studyflow:CognitiveTest'),
        }
      },
      'create.studyflow-video-game': {
        group: 'studyflow',
        className: 'bi bi-controller',
        title: 'Create Video Game',
        action: {
          dragstart: createElement.bind(null, 'studyflow:VideoGame'),
          click: createElement.bind(null, 'studyflow:VideoGame'),
        }
      },
      'create.studyflow-questionnaire': {
        group: 'studyflow',
        className: 'bi bi-pencil',
        title: 'Create Questionnaire',
        action: {
          dragstart: createElement.bind(null, 'studyflow:Questionnaire'),
          click: createElement.bind(null, 'studyflow:Questionnaire'),
        }
      },
      'create.studyflow-instruction': {
        group: 'studyflow',
        className: 'bi bi-chat-square-dots',
        title: 'Create Instruction',
        action: {
          dragstart: createElement.bind(null, 'studyflow:Instruction'),
          click: createElement.bind(null, 'studyflow:Instruction'),
        }
      },
      'create.studyflow-random-assignment': {
        group: 'studyflow',
        className: 'bi bi-dice-6 palette-dice rotate-45',
        style: 'width:41px',
        title: 'Create Random Assignment Gateway',
        action: {
          dragstart: createElement.bind(null, 'studyflow:RandomAssignment'),
          click: createElement.bind(null, 'studyflow:RandomAssignment'),
        }
      },
    }
  }
}
