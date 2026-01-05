
export default class CreateMenuProvider {

    static $inject = [
        'elementFactory',
        'popupMenu',
        'create',
        'autoPlace',
        'moddle'
    ];

    constructor(elementFactory, popupMenu, create, autoPlace, moddle) {
        this._elementFactory = elementFactory;
        this._popupMenu = popupMenu;
        this._create = create;
        this._autoPlace = autoPlace;

        var entries = Object.entries(moddle.registry.typeMap).filter(([k,v]) => 
            k.startsWith("studyflow:")
            && !v?.isAbstract
            && !(v?.superClass.length === 1 && v.superClass.includes("String"))
            && !v.extends?.includes("bpmn:StartEvent")
            && !v.extends?.includes("bpmn:EndEvent")
        );
        
        var elements = [];
        entries.forEach(([k, v]) => {
            elements.push({
                label: v.name.split(":")[1],
                actionName: k.split(":")[1],
                className: "icon " + v.icon,
                target: {
                    type: v.name
                }
            });
        });
        this._elements = elements;

        // register self as provider
        this._popupMenu.registerProvider('bpmn-create', this);
    }

    getPopupMenuEntries() {

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

            const targetAction = this._createEntryAction(target);

            entries[`create-${actionName}`] = {
                label: label,
                className,
                description,
                group: {
                    id: 'studyflow',
                    name: 'Studyflow'
                },
                search,
                rank,
                action: {
                    click: targetAction,
                    dragstart: targetAction
                }
            };
        });

        return entries;
    };

    _createEntryAction(target) {

        const create = this._create;
        const mouse = this._mouse;
        const popupMenu = this._popupMenu;
        const elementFactory = this._elementFactory;

        let newElement;

        return (event) => {
            popupMenu.close();
            newElement = elementFactory.create('shape', target);

            // use last mouse event if triggered via keyboard
            if (event instanceof KeyboardEvent) {
                event = mouse.getLastMoveEvent();
            }

            return create.start(event, newElement);
        };
    };
}
