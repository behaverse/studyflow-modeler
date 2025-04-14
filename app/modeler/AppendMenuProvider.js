

export default class AppendMenuProvider {

    static $inject = [
        'elementFactory',
        'popupMenu',
        'create',
        'autoPlace',
        'moddle',
        'rules'
    ];

    constructor(elementFactory, popupMenu, create, autoPlace, moddle, rules) {
        this._elementFactory = elementFactory;
        this._popupMenu = popupMenu;
        this._create = create;
        this._autoPlace = autoPlace;
        this._rules = rules;

        var entries = Object.entries(moddle.registry.typeMap).filter(([k,v]) => 
            k.startsWith("studyflow:")
            && !v?.isAbstract
            && !(v?.superClass.length === 1 && v.superClass.includes("String"))
            && !v.extends?.includes("bpmn:StartEvent")
            && !v.extends?.includes("bpmn:EndEvent")
            && !k.includes("studyflow:Dataset")
        );
        
        var elements = [];
        entries.forEach(([k, v]) => {
            elements.push({
                label: v.name.split(":")[1],
                actionName: k.split(":")[1],
                className: "icon sfi-" + (k.includes("Gateway") ? "Diamond" : "") + k.split(":")[1],
                target: {
                    type: v.name
                }
            });
        });
        this._elements = elements;

        this.register();
    }

    register() {
        this._popupMenu.registerProvider('bpmn-append', this);
    }

    getPopupMenuEntries(element) {

        const rules = this._rules;
            
        if (!rules.allowed('shape.append', { element: element })) {
          return [];
        }
        const entries = {};

        // map options to menu entries
        this._elements.forEach(option => {
            const {
                actionName,
                className,
                label,
                target,
                description,
                search,
                rank
            } = option;

            entries[`append-${actionName}`] = {
                label: label,
                className,
                description,
                group: {
                    id: 'studyflow',
                    name: 'Studyflow'
                },
                search,
                rank,
                action: this._createEntryAction(element, target)
            };
        });

        return entries;
    };

    _createEntryAction(element, target) {

        const elementFactory = this._elementFactory;
        const autoPlace = this._autoPlace;
        const create = this._create;
        const mouse = this._mouse;
      
      
        const autoPlaceElement = () => {
          const newElement = elementFactory.create('shape', target);
          autoPlace.append(element, newElement);
        };
      
        const manualPlaceElement = (event) => {
          const newElement = elementFactory.create('shape', target);
      
          if (event instanceof KeyboardEvent) {
            event = mouse.getLastMoveEvent();
          }
      
          return create.start(event, newElement, {
            source: element
          });
        };
      
        return {
          click: this._canAutoPlaceElement(target) ? autoPlaceElement : manualPlaceElement,
          dragstart: manualPlaceElement
        };
    };

    _canAutoPlaceElement(target) {
        const { type } = target;
      
        if (type === 'bpmn:BoundaryEvent') {
          return false;
        }
      
        if (type === 'bpmn:SubProcess' && target.triggeredByEvent) {
          return false;
        }
      
        if (type === 'bpmn:IntermediateCatchEvent' && target.eventDefinitionType === 'bpmn:LinkEventDefinition') {
          return false;
        }
      
        return true;
      };
}

