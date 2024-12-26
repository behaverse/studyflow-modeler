export default class BFlowPalette {

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

    function createActivity(event) {
      const shape = elementFactory.createShape({ type: 'bflow:Activity' });
      create.start(event, shape);
    }

    function createRandomAssignment(event) {
      const shape = elementFactory.createShape({ type: 'bflow:RandomAssignment' });
      create.start(event, shape);
    }

    return {
      'sep': {
        separator: true
      },
      'create.bflow-cognitive-test': {
        group: 'bflow',
        className: 'bi bi-puzzle',
        title: 'Create Cognitive Test',
        action: {
          dragstart: createActivity,
          click: createActivity
        }
      },
      'create.bflow-game': {
        group: 'bflow',
        className: 'bi bi-controller',
        title: 'Create Video Game',
        action: {
          dragstart: createActivity,
          click: createActivity
        }
      },
      'create.bflow-questionnaire': {
        group: 'bflow',
        className: 'bi bi-pencil',
        title: 'Create Questionnaire',
        action: {
          dragstart: createActivity,
          click: createActivity
        }
      },
      'create.bflow-instruction': {
        group: 'bflow',
        className: 'bi bi-chat-square-text',
        title: 'Create Instruction',
        action: {
          dragstart: createActivity,
          click: createActivity
        }
      },
      'create.bflow-random-assignment': {
        group: 'bflow',
        className: 'bi bi-dice-6',
        title: 'Create Random Assignment Gateway',
        action: {
          dragstart: createRandomAssignment,
          click: createRandomAssignment
        }
      },
    }
  }
}
