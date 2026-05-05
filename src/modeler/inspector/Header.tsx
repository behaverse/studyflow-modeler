import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { getExtensionType, getExtensionElement, getProperty } from '../extensions';
import { toLocalName } from '../utils/naming';
import { inspector as s } from '../styles';

function resolveDisplayName(element: any): string {
  const businessObject = getBusinessObject(element);
  const extension = getExtensionElement(element);
  const resolvedName = getProperty(element, 'name')
    ?? extension?.get?.('name')
    ?? extension?.name;

  if (typeof resolvedName === 'string' && resolvedName.trim()) {
    return resolvedName;
  }

  const fallbackType = getExtensionType(element) || businessObject?.$type || element?.type;
  if (typeof fallbackType === 'string' && fallbackType.includes(':')) {
    return toLocalName(fallbackType) ?? fallbackType;
  }
  return fallbackType || 'Unknown';
}

function resolveTypeLabel(element: any): string {
  const businessObject = getBusinessObject(element);
  return getExtensionType(element) || businessObject?.$type || element.type;
}

export function Header({ element }: { element: any }) {
  return (
    <>
      <h1 className={s.headerTitle}>{resolveDisplayName(element)}</h1>
      <h2 className={s.headerSubtitle}>{resolveTypeLabel(element)}</h2>
    </>
  );
}
