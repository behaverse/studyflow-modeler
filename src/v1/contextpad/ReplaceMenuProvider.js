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

    if (is(element, 'studyflow:Activity')) {
      headerEntries['toggle-operator-marker'] = this._getOperatorMarkerHeaderEntry(element);
    }

    return headerEntries;
  }

  _getOperatorMarkerHeaderEntry(element) {
    const self = this;
    const businessObject = element.businessObject;

    function toggleDataOperator(event, entry) {
      // Use the businessObject as source of truth; popup header entry state may be stale
      // until the menu re-renders on element change.
      const currentState = !!businessObject.get('isOperator');
      const newState = !currentState;

      self._modeling.updateProperties(element, {
        isOperator: newState
      });

      entry.active = newState;
    }

    return {
      title: 'Data Operator',
      imageHtml: '<i class="data-operator-marker"></i>',
      active: !!businessObject.get('isOperator'),
      action: toggleDataOperator
    };
  }
}
