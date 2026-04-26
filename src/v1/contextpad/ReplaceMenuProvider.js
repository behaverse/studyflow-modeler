// @ts-check

import { is } from 'bpmn-js/lib/util/ModelUtil';
import { executeCommand } from '../commands';
import { getProperty } from '../extensions';

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
    if (is(element, 'bpmn:Activity')) {
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
