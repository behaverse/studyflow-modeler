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
    const studyflowEntries = {
      'sep-studyflow': {
        separator: true
      },
      'create.studyflow-cognitive-test': {
        group: 'studyflow',
        className: 'sfi-CognitiveTest',
        title: 'Create cognitive test (or video game)',
        action: {
          dragstart: createElement.bind(null, 'studyflow:CognitiveTest'),
          click: createElement.bind(null, 'studyflow:CognitiveTest'),
        }
      },
      'create.studyflow-questionnaire': {
        group: 'studyflow',
        className: 'sfi-Questionnaire',
        title: 'Create questionnaire',
        action: {
          dragstart: createElement.bind(null, 'studyflow:Questionnaire'),
          click: createElement.bind(null, 'studyflow:Questionnaire'),
        }
      },
      'create.studyflow-instruction': {
        group: 'studyflow',
        className: 'sfi-Instruction',
        title: 'Create instruction',
        action: {
          dragstart: createElement.bind(null, 'studyflow:Instruction'),
          click: createElement.bind(null, 'studyflow:Instruction'),
        }
      },
      'create.studyflow-random-gateway': {
        group: 'studyflow',
        className: 'sfi-DiamondRandomGateway',
        title: 'Create random gateway',
        action: {
          dragstart: createElement.bind(null, 'studyflow:RandomGateway'),
          click: createElement.bind(null, 'studyflow:RandomGateway'),
        }
      }
    }

    return function (entries) {
      delete entries['space-tool'];
      delete entries['create.exclusive-gateway'];
      // delete entries['create.data-store'];
      entries['create.data-store'].group = 'studyflow';
      entries['create.data-store'].className = 'bi bi-database';
      delete entries['create.task'];
      delete entries['create.subprocess-expanded'];

      // delete entries['create.group'];
      entries['create.group'].group = 'tools';
      entries['create.group'].title = 'Create BPMN Group';

      delete entries['create.data-object'];
      delete entries['create.intermediate-event'];
      delete entries['create.participant-expanded'];

      // HACK move create.group to the top of the palette
      const keys = Object.keys(entries);
      const sortedEntries = keys.reduce((acc, key) => {
        if (key === "tool-separator") {
          acc["create.group"] = entries["create.group"];
        }
        acc[key] = entries[key];
        return acc;
      }, {});
      //

      return { ...sortedEntries, ...studyflowEntries };
    };
  }
}
