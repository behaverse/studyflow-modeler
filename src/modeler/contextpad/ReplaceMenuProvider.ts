import { is, getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { executeCommand } from '../commands';
import {
  getProperty,
  getEffectivePropertyDescriptor,
  getExtensionElement,
  getExtensionPropertyDescriptor,
} from '@/lib/core/extensions';
import type { EventBus, Injector, PopupMenu, Replace } from '../bpmn-js';

/**
 * True when the schema pins `isDataOperation` for this element's effective
 * type - e.g. types that fix the value (CognitiveTask, VideoGame, Rest,
 * omniprocess:Transform). Users shouldn't be able to toggle it via the
 * popup in those cases.
 */
function isDataOperationPinned(element: any): boolean {
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

  _popupMenu: PopupMenu;
  _replace: Replace;
  _injector: Injector;
  _eventBus: EventBus;

  constructor(popupMenu: PopupMenu, replace: Replace, injector: Injector, eventBus: EventBus) {
    this._popupMenu = popupMenu;
    this._replace = replace;
    this._injector = injector;
    this._eventBus = eventBus;
    popupMenu.registerProvider('bpmn-replace', this);
  }

  getPopupMenuEntries(_element: any) {
    return {};
  }

  getPopupMenuHeaderEntries(element: any): Record<string, any> {
    const headerEntries: Record<string, any> = {};

    // isDataOperation is an extends property on bpmn:Activity (lives on the BO).
    // Suppress the toggle for types that pin the value via meta.pinned.
    if (is(element, 'bpmn:Activity') && !isDataOperationPinned(element)) {
      headerEntries['toggle-marker-operation'] = this._getOperationMarkerHeaderEntry(element);
    }

    return headerEntries;
  }

  _getOperationMarkerHeaderEntry(element: any) {
    const self = this;

    function toggleDataOperation(_event: any, entry: any) {
      const currentState = !!getProperty(element, 'isDataOperation');
      const newState = !currentState;

      executeCommand(self._injector as any, {
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
