

import { createStudyflowExtension, getStudyflowDefaults, isExtendsType } from '../extensionElements';

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
        this._moddle = moddle;
        this._rules = rules;

        var entries = Object.entries(moddle.registry.typeMap).filter(([k,v]) => 
            !k.includes(":Study")  // Exclude studyflow:Study
            && !v?.isAbstract      // Exclude abstract types
            && !(v?.superClass?.length === 1 && v.superClass.includes("String"))
            // Exclude extends-based types (handled by BPMN)
            && !v?.extends?.length
            // Must have a BPMN type to be creatable
            && v?.meta?.bpmnType
        );
        var elements = [];
        entries.forEach(([k, v]) => {
          elements.push({
            label: v.name.split(":")[1],
            actionName: k.split(":")[1],
            imageHtml: v.icon ? `<span class="${v.icon}" style="font-size: 18px;"></span>` : '',
            bpmnType: v.meta.bpmnType,
            studyflowType: k,
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
                imageHtml,
                label,
                bpmnType,
                studyflowType,
                description,
                search,
                rank
            } = option;

            entries[`append-${actionName}`] = {
                label: label,
                imageHtml: imageHtml,
                description,
                group: {
                    id: 'studyflow',
                    name: 'Studyflow'
                },
                search,
                rank,
                action: this._createEntryAction(element, bpmnType, studyflowType)
            };
        });

        return entries;
    };

    _createEntryAction(element, bpmnType, studyflowType) {

        const elementFactory = this._elementFactory;
        const autoPlace = this._autoPlace;
        const create = this._create;
        const mouse = this._mouse;
        const moddle = this._moddle;

        const createShapeWithExtension = () => {
          const target = { type: bpmnType };
          const newElement = elementFactory.create('shape', target);

          // Attach studyflow extension element or set extends-based defaults
          if (studyflowType) {
            const bo = newElement.businessObject;
            const defaults = getStudyflowDefaults(studyflowType, moddle);
            if (isExtendsType(studyflowType, moddle)) {
              for (const [key, val] of Object.entries(defaults)) {
                bo.set(key, val);
              }
            } else {
              createStudyflowExtension(bo, studyflowType, moddle, defaults);
            }
          }

          return newElement;
        };
      
        const autoPlaceElement = () => {
          const newElement = createShapeWithExtension();
          autoPlace.append(element, newElement);
        };
      
        const manualPlaceElement = (event) => {
          const newElement = createShapeWithExtension();
      
          if (event instanceof KeyboardEvent) {
            event = mouse.getLastMoveEvent();
          }
      
          return create.start(event, newElement, {
            source: element
          });
        };
      
        return {
          click: this._canAutoPlaceElement({ type: bpmnType }) ? autoPlaceElement : manualPlaceElement,
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

