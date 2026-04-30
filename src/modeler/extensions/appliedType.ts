import { getExtensionElement } from './wrapper';

/**
 * The applied studyflow type is the `$type` of the extension element wrapper
 * inside `<bpmn:extensionElements>`. Wrapper presence is the single source of
 * truth — there is no `appliedType` attribute, no inference fallback.
 */
export function getAppliedType(elementOrBusinessObject: any): string | undefined {
  return getExtensionElement(elementOrBusinessObject)?.$type;
}
