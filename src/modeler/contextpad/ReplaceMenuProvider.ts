import { is, getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { executeCommand } from '../commands';
import {
  getAttribute,
  getAttributeDefinition,
  getExtensionElement,
} from '@/lib/core/extensions';
import type { EventBus, Injector, PopupMenu, Replace } from '../bpmn-js';

/** True when the attribute definition pins `isDataOperation`. */
function isDataOperationPinned(element: any): boolean {
  const bo = getBusinessObject(element);
  const ext = getExtensionElement(bo);
  const attrDef = (ext && getAttributeDefinition(ext, 'isDataOperation'))
    || getAttributeDefinition(bo, 'isDataOperation');
  return attrDef?.meta?.pinned === true;
}

/** Contributes a header toggle for `isDataOperation` to bpmn-js's replace menu. */
export default class ReplaceMenuProvider {
  static $inject = ['popupMenu', 'replace', 'injector', 'eventBus'];

  private _injector: Injector;

  constructor(popupMenu: PopupMenu, _replace: Replace, injector: Injector, _eventBus: EventBus) {
    this._injector = injector;
    popupMenu.registerProvider('bpmn-replace', this);
  }

  getPopupMenuEntries(_element: any) {
    return {};
  }

  getPopupMenuHeaderEntries(element: any): Record<string, any> {
    const headerEntries: Record<string, any> = {};
    if (is(element, 'bpmn:Activity') && !isDataOperationPinned(element)) {
      headerEntries['toggle-marker-operation'] = this._getOperationMarkerHeaderEntry(element);
    }
    return headerEntries;
  }

  private _getOperationMarkerHeaderEntry(element: any) {
    const injector = this._injector;
    const toggleDataOperation = (_e: any, entry: any) => {
      const next = !getAttribute(element, 'isDataOperation');
      executeCommand(injector as any, {
        type: 'update-attribute',
        element,
        attributeName: 'isDataOperation',
        value: next,
      });
      entry.active = next;
    };

    return {
      title: 'Data Operator',
      imageHtml: '<i class="iconify mdi--function"></i>',
      active: !!getAttribute(element, 'isDataOperation'),
      action: toggleDataOperation,
    };
  }
}
