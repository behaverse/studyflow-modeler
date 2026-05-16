import { getExtensionElement } from './wrapper';

/** `$type` of the wrapper inside `<bpmn:extensionElements>`; the wrapper is the single source of truth. */
export function getExtensionType(elementOrBO: any): string | undefined {
  return getExtensionElement(elementOrBO)?.$type;
}
