// @ts-check

import { is, getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { executeCommand } from '../commands';
import {
  getProperty,
  getEffectivePropertyDescriptor,
  getExtensionElement,
  getExtensionPropertyDescriptor,
} from '../extensions';

/**
 * True when the schema pins `isDataOperation` for this element's effective
 * type — e.g. types that fix the value (CognitiveTask, VideoGame, Rest,
 * omniprocess:Transform). Users shouldn't be able to toggle it via the
 * popup in those cases.
 */
function isDataOperationPinned(element) {
  const businessObject = getBusinessObject(element);
  const ext = getExtensionElement(businessObject);
  const descriptor =
    (ext && getExtensionPropertyDescriptor(ext, 'isDataOperation'))
    || getEffectivePropertyDescriptor(businessObject, 'isDataOperation');
  return descriptor?.meta?.pinned === true;
}

/**
 * Header entries for bpmn-js's popup replace menu.
 *
 * We don't add any body entries (the built-in replace list is fine); we only
 * contribute a header toggle that flips the `isDataOperation` flag on
 * `bpmn:Activity` shapes.
 */
export default class ReplaceMenuProvider {
  static $inject = ['popupMenu', 'replace', 'injector', 'eventBus'];

  /**
   * @param {any} popupMenu
   * @param {any} replace
   * @param {any} injector  bpmn-js DI container (same `.get(service)` API as the modeler)
   * @param {any} eventBus
   */
  constructor(popupMenu, replace, injector, eventBus) {
    this._popupMenu = popupMenu;
    this._replace = replace;
    this._injector = injector;
    this._eventBus = eventBus;
    popupMenu.registerProvider('bpmn-replace', this);
  }

  /**
   * @param {any} _element
   */
  // eslint-disable-next-line no-unused-vars
  getPopupMenuEntries(_element) {
    return {};
  }

  /**
   * @param {any} element
   */
  getPopupMenuHeaderEntries(element) {
    /** @type {Record<string, any>} */
    const headerEntries = {};

    // isDataOperation is an extends property on bpmn:Activity (lives on the BO).
    // Suppress the toggle for types that pin the value via meta.pinned.
    if (is(element, 'bpmn:Activity') && !isDataOperationPinned(element)) {
      headerEntries['toggle-marker-operation'] = this._getOperationMarkerHeaderEntry(element);
    }

    return headerEntries;
  }

  /**
   * @param {any} element
   */
  _getOperationMarkerHeaderEntry(element) {
    const self = this;

    function toggleDataOperation(/** @type {any} */ _event, /** @type {any} */ entry) {
      const currentState = !!getProperty(element, 'isDataOperation');
      const newState = !currentState;

      executeCommand(self._injector, {
        type: 'update-property',
        element,
        propertyName: 'isDataOperation',
        value: newState,
      });

      entry.active = newState;
    }

    return {
      title: 'Data Operator',
      imageHtml: '<i class="iconify mdi--function"></i>',
      active: !!getProperty(element, 'isDataOperation'),
      action: toggleDataOperation,
    };
  }
}
