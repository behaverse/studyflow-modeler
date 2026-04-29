import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { getAppliedType, getExtensionElement, getProperty } from '../extensions';
import { toLocalName } from '../utils/naming';

function resolveDisplayName(element: any): string {
  const businessObject = getBusinessObject(element);
  const extension = getExtensionElement(element);
  const resolvedName = getProperty(element, 'name')
    ?? extension?.get?.('name')
    ?? extension?.name;

  if (typeof resolvedName === 'string' && resolvedName.trim()) {
    return resolvedName;
  }

  const fallbackType = getAppliedType(element) || businessObject?.$type || element?.type;
  if (typeof fallbackType === 'string' && fallbackType.includes(':')) {
    return toLocalName(fallbackType) ?? fallbackType;
  }
  return fallbackType || 'Unknown';
}

function resolveTypeLabel(element: any): string {
  const businessObject = getBusinessObject(element);
  return getAppliedType(element) || businessObject?.$type || element.type;
}

export function Header({ element }: { element: any }) {
  return (
    <>
      <h1 className="pb-0 text-[15px] font-bold p-2 pb-0 text-stone-900">
        {resolveDisplayName(element)}
      </h1>
      <h2 className="text-[10.5px] text-left font-mono px-2 pb-2 text-stone-500">
        {resolveTypeLabel(element)}
      </h2>
    </>
  );
}
