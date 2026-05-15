import { getExtensionElement } from './wrapper';

// Extension type = the `$type` of the wrapper inside `<bpmn:extensionElements>`.
// Wrapper presence is the single source of truth; no XML attribute fallback.
export function getExtensionType(elementOrBO: any): string | undefined {
  return getExtensionElement(elementOrBO)?.$type;
}
