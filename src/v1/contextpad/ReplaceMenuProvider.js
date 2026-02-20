import { is } from 'bpmn-js/lib/util/ModelUtil';

export default class ReplaceMenuProvider {
  static $inject = ['popupMenu', 'replace', 'modeling', 'eventBus'];

  constructor(popupMenu, replace, modeling, eventBus) {
    this._popupMenu = popupMenu;
    this._replace = replace;
    this._modeling = modeling;
    this._eventBus = eventBus;
    popupMenu.registerProvider('bpmn-replace', this);
  }

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
    const businessObject = element.businessObject;

    function toggleDataOperation(event, entry) {
      const currentState = !!businessObject.get('isDataOperation');
      const newState = !currentState;

      self._modeling.updateProperties(element, {
        isDataOperation: newState
      });

      entry.active = newState;
    }

    return {
      title: 'Data Operator',
      imageHtml: '<i class="iconify mdi--function"></i>',
      active: !!businessObject.get('isDataOperation'),
      action: toggleDataOperation
    };
  }
}
