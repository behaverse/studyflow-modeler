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

    function createBFlowActivity(event) {
      const shape = elementFactory.createShape({ type: 'bflow:Activity' });

      create.start(event, shape);
    }

    return {
      'create.bflow-activity': {
        group: 'bflow',
        className: 'bpmn-icon-user-task',
        title: 'Create BFlow Activity',
        action: {
          dragstart: createBFlowActivity,
          click: createBFlowActivity
        }
      }
    }
  }
}
