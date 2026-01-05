export default class StudyflowPopupMenu {
  static $inject = ['popupMenu', 'elementFactory', 'create', 'moddle'];

  constructor(popupMenu, elementFactory, create, moddle) {
    this.elementFactory = elementFactory;
    this.create = create;
    this.moddle = moddle;
    this.popupMenu = popupMenu;
    this.bpmnFactory = elementFactory._bpmnFactory;

    this.popupMenu.registerProvider("studyflow-create", this);
  }

  getPopupMenuEntries(event) {
    const self = this;
    const entries = {};

    function createShape(element_type) {
      const prefix = element_type.replace('studyflow:', '');
      const el = self.bpmnFactory._model.create(element_type, {type: element_type});
      el.id = self.bpmnFactory._model.ids.nextPrefixed(prefix + '_', el);
      const shape = self.elementFactory.createShape({
        businessObject: el,
        type: element_type
      });
      return shape;
    }

    const moddle = this.bpmnFactory._model;
    const studyflowPackage = moddle.getPackage('studyflow');

    if (studyflowPackage && studyflowPackage.types) {
      studyflowPackage.types.forEach(type => {
        // Skip abstract classes and those that extend other classes
        if (type.isAbstract || type.extends?.length > 0) {
          return;
        }

        // Skip the base Study type
        if (type.name === 'Study') {
          return;
        }

        // Skip types that extend from primitive types
        const primitiveTypes = ['String', 'Boolean', 'Integer', 'Float', 'Double'];
        if (type.superClass && type.superClass.some(sc => primitiveTypes.includes(sc))) {
          return;
        }

        const elementType = `studyflow:${type.name}`;
        const icon = type.icon || `sfi-${type.name}`;
        const label = type.name;

        entries[`create-${type.name}`] = {
          label: label,
          className: `icon ${icon}`,
          group: {
            id: 'studyflow',
            name: 'Studyflow'
          },
          action: {
            click: () => {
              self.popupMenu.close();
              const shape = createShape(elementType);
              self.create.start(event, shape);
            }
          }
        };
      });
    }

    return entries;
  }
}
