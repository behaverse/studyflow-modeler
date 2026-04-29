// @ts-check

import { createExtensionElement, getDefaults, isExtendsType, setAppliedType } from '../extensions';
import { resolveBpmnCreateType } from '../moddle/resolveBpmnType';

const HIDDEN_APPEND_TYPES = new Set(['Study', 'StartEvent', 'EndEvent', 'SequenceFlow']);

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

  /**
   * @param {any} elementFactory
   * @param {any} popupMenu
   * @param {any} create
   * @param {any} autoPlace
   * @param {any} moddle
   * @param {any} rules
   */
  constructor(elementFactory, popupMenu, create, autoPlace, moddle, rules) {
    this._elementFactory = elementFactory;
    this._popupMenu = popupMenu;
    this._create = create;
    this._autoPlace = autoPlace;
    this._moddle = moddle;
    this._rules = rules;

    const entries = Object.entries(moddle.registry.typeMap).filter(([, v]) =>
      !HIDDEN_APPEND_TYPES.has(/** @type {any} */ (v)?.name)
      && !(/** @type {any} */ (v)?.isAbstract)
      && !(/** @type {any} */ (v)?.meta?.exampleScopedType)
      && !((/** @type {any} */ (v)?.superClass?.length === 1) && /** @type {any} */ (v).superClass.includes('String'))
      && resolveBpmnCreateType(moddle, v),
    );

    /** @type {Array<{label:string, actionName:string, imageHtml:string, bpmnType:string, studyflowType:string}>} */
    const elements = [];
    entries.forEach(([k, v]) => {
      const typeDef = /** @type {any} */ (v);
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

  register() {
    this._popupMenu.registerProvider('bpmn-append', this);
  }

  /**
   * @param {any} element
   */
  getPopupMenuEntries(element) {
    if (!this._rules.allowed('shape.append', { element })) {
      return [];
    }
    /** @type {Record<string, any>} */
    const entries = {};

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
   *
   * @param {any} element
   * @param {string} bpmnType
   * @param {string} studyflowType
   */
  _createEntryAction(element, bpmnType, studyflowType) {
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
        if (isExtendsType(studyflowType, moddle)) {
          setAppliedType(bo, studyflowType);
          for (const [key, val] of Object.entries(defaults)) {
            bo.set(key, val);
          }
        } else {
          createExtensionElement(bo, studyflowType, moddle, defaults);
        }
      }

      return newElement;
    };

    const autoPlaceElement = () => {
      const newElement = createShapeWithExtension();
      autoPlace.append(element, newElement);
    };

    const manualPlaceElement = (/** @type {any} */ event) => {
      const newElement = createShapeWithExtension();
      return create.start(event, newElement, { source: element });
    };

    return {
      click: this._canAutoPlaceElement({ type: bpmnType }) ? autoPlaceElement : manualPlaceElement,
      dragstart: manualPlaceElement,
    };
  }

  /**
   * @param {{ type: string, triggeredByEvent?: boolean, eventDefinitionType?: string }} target
   */
  _canAutoPlaceElement(target) {
    const { type } = target;
    if (type === 'bpmn:BoundaryEvent') return false;
    if (type === 'bpmn:SubProcess' && target.triggeredByEvent) return false;
    if (type === 'bpmn:IntermediateCatchEvent' && target.eventDefinitionType === 'bpmn:LinkEventDefinition') return false;
    return true;
  }
}
