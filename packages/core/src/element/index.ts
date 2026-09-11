import { getCatalog, hasCatalog } from '@core/notation';
import {
  CHECKLIST_SPEC,
  definitionsOf,
  getAttributeSpec,
  getRawAttribute,
  isExtensionPrefix,
  toBusinessObject,
} from '@core/element/attributes';
import { StudyflowElement, type AttributeUpdater } from '@core/element/handle';

export {
  CHECKLIST_SPEC,
  definitionsOf,
  getAttributeSpec,
  getRawAttribute,
  isExtensionPrefix,
  toBusinessObject,
  StudyflowElement,
  type AttributeUpdater,
};
export type { ModdleElement } from '@core/element/moddle';

/** Derived, not stored; shared by the canvas marker and the NIDM/Artemis exporters so it cannot drift. */
export function isDataOperationActivity(elementOrBO: any): boolean {
  if (!elementOrBO) return false;
  const extensionType = getExtensionType(elementOrBO);
  if (extensionType && hasCatalog() && getCatalog().hasRole(extensionType, 'instrument')) return false;
  const implementation = getAttribute(elementOrBO, 'implementation');
  return typeof implementation === 'string' && implementation.trim() !== '';
}

export function getDefaults(typeName: string): Record<string, any> {
  return { ...getCatalog().defaultsOf(typeName) };
}

export function getExtensionType(elementOrBO: any): string | undefined {
  return StudyflowElement.fromBusinessObject(elementOrBO).extensionType;
}

export function getAttribute(elementOrBO: any, attributeName: string): any {
  return StudyflowElement.fromBusinessObject(elementOrBO).getAttribute(attributeName);
}

export function getExpressionLanguage(element: any, attributeName: string): string | undefined {
  return StudyflowElement.fromBusinessObject(element).getExpressionLanguage(attributeName);
}

export function setExpressionLanguage(
  element: any,
  attributeName: string,
  language: string | undefined,
  updater?: AttributeUpdater,
): void {
  StudyflowElement.fromBusinessObject(element, updater).setExpressionLanguage(attributeName, language);
}

export function setAttribute(element: any, attributeName: string, value: any, updater?: AttributeUpdater): void {
  StudyflowElement.fromBusinessObject(element, updater).setAttribute(attributeName, value);
}
