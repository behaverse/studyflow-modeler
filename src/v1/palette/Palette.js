export default class Palette {

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

    // Get studyflow types from the moddle schema
    const studyflowEntries = {
    };

    // Access the moddle packages - the schema is stored in the moddle instance
    try {
      const moddle = bpmnFactory._model;
      let studyflowPackage = moddle.getPackage('studyflow');
      if (studyflowPackage && studyflowPackage.types) {
        studyflowPackage.types.forEach(type => {

          // Skip abstract classes and those that extend other classes but not sub-class them
          if (type.isAbstract || type.extends?.length > 0) {
            return;
          }
          
          // Skip the base Study type
          if (type.name === 'Study') {
            return;
          }

          // Skip types that extend from primitive types (like String, Boolean, etc.)
          const primitiveTypes = ['String', 'Boolean', 'Integer', 'Float', 'Double'];
          if (type.superClass && type.superClass.some(sc => primitiveTypes.includes(sc))) {
            return;
          }

          const elementType = `studyflow:${type.name}`;
          const kebabName = type.name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
          const icon = type.icon || `sfi-${type.name}`;
          const title = type.description || `Create ${type.name}`;

          studyflowEntries[`create.studyflow-${kebabName}`] = {
            group: 'studyflow',
            className: icon,
            title: title,
            action: {
              dragstart: createElement.bind(null, elementType),
              click: createElement.bind(null, elementType),
            }
          };
        });
      }
    } catch (e) {
      console.warn('Could not load studyflow types dynamically from schema:', e);
    }

    return function (entries) {
      delete entries['space-tool'];
      delete entries['create.exclusive-gateway'];
      entries['create.data-store'].group = 'studyflow';
      entries['create.data-store'].className = 'bi bi-database';
      // delete entries['create.data-store'];
      delete entries['create.task'];
      delete entries['create.subprocess-expanded'];

      // delete entries['create.group'];
      entries['create.group'].group = 'tools';
      entries['create.group'].title = 'Create BPMN group';

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
