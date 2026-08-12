import { StudyflowElement, getAttribute } from '@core/element';
import { toLocalName } from '@core/naming';

/** How the inspected element names itself: the studyflow extension type when it has one, else its BPMN type. */
export function getTypeName(element: any): string {
  return StudyflowElement.fromBusinessObject(element).extensionType
    || element?.businessObject?.$type
    || element.type;
}

export function resolveDisplayName(element: any): string {
  const ext = StudyflowElement.fromBusinessObject(element).extension;
  const name = getAttribute(element, 'name') ?? ext?.get?.('name') ?? ext?.name;
  if (typeof name === 'string' && name.trim()) return name;

  const type = getTypeName(element);
  if (typeof type === 'string' && type.includes(':')) return toLocalName(type) ?? type;
  return type || 'Unknown';
}

/** A React key for "this inspected element" that survives its own edits. */
const tokens = new WeakMap<object, number>();
let nextToken = 0;

export function elementKey(element: object | null | undefined): string {
  if (!element || typeof element !== 'object') return 'none';
  let token = tokens.get(element);
  if (token === undefined) {
    nextToken += 1;
    token = nextToken;
    tokens.set(element, token);
  }
  return `el${token}`;
}
