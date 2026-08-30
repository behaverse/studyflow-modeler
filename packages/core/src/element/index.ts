import { getCatalog } from '@core/notation';
import {
  CHECKLIST_SPEC,
  getAttributeSpec,
  getRawAttribute,
  isExtensionPrefix,
  toBusinessObject,
} from '@core/element/attributes';
import { StudyflowElement, type AttributeUpdater } from '@core/element/handle';

export {
  CHECKLIST_SPEC,
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
  if (getAttribute(elementOrBO, 'instrument')) return false;
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
  const handle = updater
    ? StudyflowElement.fromElement(element, updater)
    : StudyflowElement.fromBusinessObject(element);
  handle.setExpressionLanguage(attributeName, language);
}

export function setAttribute(element: any, attributeName: string, value: any, updater?: AttributeUpdater): void {
  const handle = updater
    ? StudyflowElement.fromElement(element, updater)
    : StudyflowElement.fromBusinessObject(element);
  handle.setAttribute(attributeName, value);
}
