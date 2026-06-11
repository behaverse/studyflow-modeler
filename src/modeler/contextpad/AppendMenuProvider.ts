import { getActiveCatalog, HIDDEN_SCHEMA_TYPES, type TypeEntry } from '@/lib/core/catalog';
import { buildBusinessObject } from '../commands/shape';
import type { AutoPlace, Create, ElementFactory, Injector, PopupMenu, Rules } from '../bpmn-js';

type AppendableType = {
  label: string;
  actionName: string;
  imageHtml: string;
  bpmnType: string;
  extensionType: string;
};

/** Concrete schema types offered in the append menu. */
function isAppendable(type: TypeEntry): boolean {
  return !type.isAbstract
    && !HIDDEN_SCHEMA_TYPES.has(type.ns.localName)
    && !type.meta?.templateScopedType
    && type.bpmnType !== null;
}

/** Append-menu entries for every creatable studyflow type. */
export default class AppendMenuProvider {
  static $inject = [
    'elementFactory',
    'popupMenu',
    'create',
    'autoPlace',
    'rules',
    'injector',
  ];

  private _elementFactory: ElementFactory;
  private _create: Create;
  private _autoPlace: AutoPlace;
  private _rules: Rules;
  private _injector: Injector;
  private _appendableTypes: AppendableType[];

  constructor(
    elementFactory: ElementFactory,
    popupMenu: PopupMenu,
    create: Create,
    autoPlace: AutoPlace,
    rules: Rules,
    injector: Injector,
  ) {
    this._elementFactory = elementFactory;
    this._create = create;
    this._autoPlace = autoPlace;
    this._rules = rules;
    this._injector = injector;

    this._appendableTypes = getActiveCatalog().allTypes()
      .filter(isAppendable)
      .map((type) => {
        const icon = typeof type.meta?.icon === 'string' ? type.meta.icon : type.icon;
        return {
        label: type.ns.localName,
        actionName: type.ns.localName,
        imageHtml: icon
          ? `<span class="${icon}" style="font-size: 18px;"></span>`
          : '',
        bpmnType: type.bpmnType!,
        extensionType: type.name,
        };
      });

    popupMenu.registerProvider('bpmn-append', this);
  }

  getPopupMenuEntries(element: any) {
    if (!this._rules.allowed('shape.append', { element })) return [];

    const entries: Record<string, any> = {};
    for (const { actionName, imageHtml, label, bpmnType, extensionType } of this._appendableTypes) {
      entries[`append-${actionName}`] = {
        label,
        imageHtml,
        group: { id: 'studyflow', name: 'Studyflow' },
        action: this._buildAppendAction(element, bpmnType, extensionType),
      };
    }
    return entries;
  }

  private _buildAppendAction(element: any, bpmnType: string, extensionType: string) {
    const { _elementFactory, _autoPlace, _create, _injector } = this;

    const createShape = () => {
      const bo = buildBusinessObject(_injector, bpmnType, { extensionType });
      return _elementFactory.create('shape', { type: bpmnType, businessObject: bo });
    };

    const dragStart = (e: any) => _create.start(e, createShape(), { source: element });
    // BoundaryEvents need an explicit host; never auto-place.
    const autoPlace = bpmnType === 'bpmn:BoundaryEvent'
      ? dragStart
      : () => _autoPlace.append(element, createShape());

    return { click: autoPlace, dragstart: dragStart };
  }
}
