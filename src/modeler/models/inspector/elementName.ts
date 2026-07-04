import { StudyflowElement, getAttribute } from '@/core/extensions';
import { toLocalName } from '@/core/naming';

/** Effective `$type`: extension type -> business-object type -> raw element type. */
export function getTypeName(element: any): string {
  return StudyflowElement.fromBusinessObject(element).extensionType
    || element?.businessObject?.$type
    || element.type;
}

/** Human display name: explicit `name`, else the local part of the type. */
export function resolveDisplayName(element: any): string {
  const ext = StudyflowElement.fromBusinessObject(element).extension;
  const name = getAttribute(element, 'name') ?? ext?.get?.('name') ?? ext?.name;
  if (typeof name === 'string' && name.trim()) return name;

  const type = getTypeName(element);
  if (typeof type === 'string' && type.includes(':')) return toLocalName(type) ?? type;
  return type || 'Unknown';
}
