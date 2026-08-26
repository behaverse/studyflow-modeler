import { getCatalog, isImageIcon } from '@core/notation';
import { buildBusinessObject } from '@modeler/shape/buildBusinessObject';
import { createEditorModel } from '@modeler/editor/bpmnAdapter';
import { isAppendable } from '@modeler/popup/entries';
import type { AutoPlace, Create, ElementFactory, Injector, PopupMenu, Rules } from '@modeler/bpmn/types';

type AppendableType = {
  label: string;
  actionName: string;
  imageHtml: string;
  bpmnType: string;
  extensionType: string;
};

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

    this._appendableTypes = getCatalog().allTypes()
      .filter(isAppendable)
      .map((type) => {
        const icon = type.iconClass;
        return {
        label: type.paletteLabel,
        actionName: type.ns.localName,
        imageHtml: !icon ? ''
          : isImageIcon(icon)
            ? `<img src="${icon}" style="width: 18px; height: 18px;" alt="" />`
            : `<span class="${icon}" style="font-size: 18px;"></span>`,
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
      const bo = buildBusinessObject(createEditorModel(_injector), bpmnType, { extensionType });
      return _elementFactory.create('shape', { type: bpmnType, businessObject: bo });
    };

    const dragStart = (e: any) => _create.start(e, createShape(), { source: element });
    // A BoundaryEvent needs an explicit host, so it can never be auto-placed.
    const autoPlace = bpmnType === 'bpmn:BoundaryEvent'
      ? dragStart
      : () => _autoPlace.append(element, createShape());

    return { click: autoPlace, dragstart: dragStart };
  }
}
