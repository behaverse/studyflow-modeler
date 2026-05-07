import { getExtensionElement } from './wrapper';

/**
 * The extension type is the `$type` of the extension element wrapper
 * inside `<bpmn:extensionElements>` (e.g. `studyflow:Instruction`,
 * `behaverse:BehaverseTask`). Wrapper presence is the single source of
 * truth - there is no XML attribute, no inference fallback.
 */
export function getExtensionType(elementOrBusinessObject: any): string | undefined {
  return getExtensionElement(elementOrBusinessObject)?.$type;
}
