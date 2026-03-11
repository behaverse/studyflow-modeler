import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil';
import { executeCommand } from '../commands';
import { getExtensionElement } from '../extensionElements';

export default class ReplaceMenuProvider {
  static $inject = ['popupMenu', 'replace', 'modeling', 'eventBus'];

  constructor(popupMenu, replace, modeling, eventBus) {
    this._popupMenu = popupMenu;
    this._replace = replace;
    this._modeling = modeling;
    this._eventBus = eventBus;
    popupMenu.registerProvider('bpmn-replace', this);
  }

  // eslint-disable-next-line no-unused-vars
  getPopupMenuEntries(element) {
    return {};
  }

  getPopupMenuHeaderEntries(element) {
    const headerEntries = {};

    // isDataOperation is an extends property on bpmn:Activity (lives on the BO)
    if (is(element, 'bpmn:Activity')) {
      headerEntries['toggle-marker-operation'] = this._getOperationMarkerHeaderEntry(element);
    }

    return headerEntries;
  }

  _getOperationMarkerHeaderEntry(element) {
    const self = this;
    const ext = getExtensionElement(element) ?? getBusinessObject(element);

    function toggleDataOperation(event, entry) {
      const currentState = !!ext.get('isDataOperation');
      const newState = !currentState;

      executeCommand(self._modeling, {
        type: 'update-property',
        element,
        propertyName: 'isDataOperation',
        value: newState
      });

      entry.active = newState;
    }

    return {
      title: 'Data Operator',
      imageHtml: '<i class="iconify mdi--function"></i>',
      active: !!ext.get('isDataOperation'),
      action: toggleDataOperation
    };
  }
}
