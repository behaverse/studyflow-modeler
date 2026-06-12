import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { getExtensionType, getExtensionElement, getAttribute } from '@/lib/core/extensions';
import { toLocalName } from '@/lib/core/naming';
import { inspector as s } from '../styles';

/** Effective `$type`: extension type -> BO type -> raw element type. */
function getTypeName(element: any): string {
  return getExtensionType(element) || getBusinessObject(element)?.$type || element.type;
}

function resolveDisplayName(element: any): string {
  const ext = getExtensionElement(element);
  const name = getAttribute(element, 'name') ?? ext?.get?.('name') ?? ext?.name;
  if (typeof name === 'string' && name.trim()) return name;

  const type = getTypeName(element);
  if (typeof type === 'string' && type.includes(':')) return toLocalName(type) ?? type;
  return type || 'Unknown';
}

export function Header({ element }: { element: any }) {
  return (
    <>
      <h1 className={s.headerTitle}>{resolveDisplayName(element)}</h1>
      <h2 className={s.headerSubtitle}>{getTypeName(element)}</h2>
    </>
  );
}
