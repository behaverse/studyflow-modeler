import { toLocalName } from '@/lib/core/utils/naming';
import { resolveBpmnCreateType } from '../moddle/resolveBpmnType';
import { HIDDEN_SCHEMA_TYPES } from '../constants';
import { buildBusinessObject } from '../commands/shape';
import type { AutoPlace, Create, ElementFactory, Injector, Moddle, PopupMenu, Rules } from '../bpmn-js';

type AppendableType = {
  label: string;
  actionName: string;
  imageHtml: string;
  bpmnType: string;
  extensionType: string;
};

/** Append-menu entries for every creatable studyflow type. */
export default class AppendMenuProvider {
  static $inject = [
    'elementFactory',
    'popupMenu',
    'create',
    'autoPlace',
    'moddle',
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
    moddle: Moddle,
    rules: Rules,
    injector: Injector,
  ) {
    this._elementFactory = elementFactory;
    this._create = create;
    this._autoPlace = autoPlace;
    this._rules = rules;
    this._injector = injector;

    this._appendableTypes = Object.entries(moddle.registry.typeMap).flatMap(([qualifiedName, type]) => {
      const typeDef = type as any;
      if (HIDDEN_SCHEMA_TYPES.has(typeDef?.name)) return [];
      if (typeDef?.isAbstract || typeDef?.meta?.templateScopedType) return [];
      if (typeDef?.superClass?.length === 1
          && typeDef.superClass.includes('String')) return [];

      const bpmnType = resolveBpmnCreateType(moddle, typeDef);
      if (!bpmnType) return [];

      return [{
        label: toLocalName(typeDef.name) ?? typeDef.name,
        actionName: toLocalName(qualifiedName) ?? qualifiedName,
        imageHtml: typeDef.icon
          ? `<span class="${typeDef.icon}" style="font-size: 18px;"></span>`
          : '',
        bpmnType,
        extensionType: qualifiedName,
      }];
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
