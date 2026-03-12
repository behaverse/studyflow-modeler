import { is } from 'bpmn-js/lib/util/ModelUtil';
import { executeCommand } from '../commands';
import { getProperty } from '../extensionElements';

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

    function toggleDataOperation(event, entry) {
      const currentState = !!getProperty(element, 'isDataOperation');
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
      active: !!getProperty(element, 'isDataOperation'),
      action: toggleDataOperation
    };
  }
}
