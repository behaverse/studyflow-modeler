import { createExtensionElement, getDefaults } from '@/lib/core/extensions';
import { resolveBpmnCreateType } from '../moddle/resolveBpmnType';
import type { AutoPlace, Create, ElementFactory, Moddle, PopupMenu, Rules } from '../bpmn-js';

const HIDDEN_APPEND_TYPES = new Set(['Study', 'StartEvent', 'EndEvent', 'SequenceFlow']);

type AppendEntry = {
  label: string;
  actionName: string;
  imageHtml: string;
  bpmnType: string;
  studyflowType: string;
};

/**
 * Append-menu provider that lists studyflow-extension types the user can
 * append after an existing element.
 *
 * On construction it filters the moddle registry for creatable, non-abstract,
 * non-hidden types and caches a menu-entry payload per type. Each entry, when
 * clicked, either auto-places a new shape or starts a drag-create, and in
 * both cases attaches the studyflow extension (or sets the applied type for
 * extends-based types).
 */
export default class AppendMenuProvider {
  static $inject = [
    'elementFactory',
    'popupMenu',
    'create',
    'autoPlace',
    'moddle',
    'rules',
  ];

  _elementFactory: ElementFactory;
  _popupMenu: PopupMenu;
  _create: Create;
  _autoPlace: AutoPlace;
  _moddle: Moddle;
  _rules: Rules;
  _elements: AppendEntry[];

  constructor(
    elementFactory: ElementFactory,
    popupMenu: PopupMenu,
    create: Create,
    autoPlace: AutoPlace,
    moddle: Moddle,
    rules: Rules,
  ) {
    this._elementFactory = elementFactory;
    this._popupMenu = popupMenu;
    this._create = create;
    this._autoPlace = autoPlace;
    this._moddle = moddle;
    this._rules = rules;

    const entries = Object.entries(moddle.registry.typeMap).filter(([, v]) => {
      const t = v as any;
      return !HIDDEN_APPEND_TYPES.has(t?.name)
        && !t?.isAbstract
        && !t?.meta?.templateScopedType
        && !(t?.superClass?.length === 1 && t.superClass.includes('String'))
        && resolveBpmnCreateType(moddle, t);
    });

    const elements: AppendEntry[] = [];
    entries.forEach(([k, v]) => {
      const typeDef = v as any;
      const bpmnType = resolveBpmnCreateType(moddle, typeDef);
      if (!bpmnType) return;

      elements.push({
        label: typeDef.name.split(':')[1],
        actionName: k.split(':')[1],
        imageHtml: typeDef.icon ? `<span class="${typeDef.icon}" style="font-size: 18px;"></span>` : '',
        bpmnType,
        studyflowType: k,
      });
    });
    this._elements = elements;

    this.register();
  }

  register(): void {
    this._popupMenu.registerProvider('bpmn-append', this);
  }

  getPopupMenuEntries(element: any) {
    if (!this._rules.allowed('shape.append', { element })) {
      return [];
    }
    const entries: Record<string, any> = {};

    this._elements.forEach((option) => {
      const { actionName, imageHtml, label, bpmnType, studyflowType } = option;
      entries[`append-${actionName}`] = {
        label,
        imageHtml,
        group: { id: 'studyflow', name: 'Studyflow' },
        action: this._createEntryAction(element, bpmnType, studyflowType),
      };
    });

    return entries;
  }

  /**
   * Build the click/drag action for a single append entry. Attaches the
   * studyflow extension element (or applied-type attribute for extends-based
   * types) before auto-placing or starting a drag.
   */
  _createEntryAction(element: any, bpmnType: string, studyflowType: string) {
    const elementFactory = this._elementFactory;
    const autoPlace = this._autoPlace;
    const create = this._create;
    const moddle = this._moddle;

    const createShapeWithExtension = () => {
      const target = { type: bpmnType };
      const newElement = elementFactory.create('shape', target);

      if (studyflowType) {
        const bo = newElement.businessObject;
        const defaults = getDefaults(studyflowType, moddle);
        createExtensionElement(bo, studyflowType, moddle, defaults);
      }

      return newElement;
    };

    const autoPlaceElement = () => {
      const newElement = createShapeWithExtension();
      autoPlace.append(element, newElement);
    };

    const manualPlaceElement = (event: any) => {
      const newElement = createShapeWithExtension();
      return create.start(event, newElement, { source: element });
    };

    return {
      click: this._canAutoPlaceElement({ type: bpmnType }) ? autoPlaceElement : manualPlaceElement,
      dragstart: manualPlaceElement,
    };
  }

  _canAutoPlaceElement(target: { type: string; triggeredByEvent?: boolean; eventDefinitionType?: string }): boolean {
    const { type } = target;
    if (type === 'bpmn:BoundaryEvent') return false;
    if (type === 'bpmn:SubProcess' && target.triggeredByEvent) return false;
    if (type === 'bpmn:IntermediateCatchEvent' && target.eventDefinitionType === 'bpmn:LinkEventDefinition') return false;
    return true;
  }
}
