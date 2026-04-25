import { CORE_PREFIXES } from '../constants/bpmn';
import { splitQName } from '../utils/naming';

const APPLIED_TYPE_ATTR_LOCAL_NAME = 'appliedType';

export { CORE_PREFIXES };

export function isExtensionPrefix(prefix: string | undefined): boolean {
  return Boolean(prefix && !CORE_PREFIXES.has(prefix));
}

export function getAttr(
  target: any,
  attrLocalName: string,
  preferredPrefix?: string,
): string | undefined {
  const attrs = target?.$attrs;

  if (!attrs || typeof attrs !== 'object') return undefined;

  if (preferredPrefix) {
    const preferredValue = attrs[`${preferredPrefix}:${attrLocalName}`];
    if (typeof preferredValue === 'string' && preferredValue.trim() !== '') {
      return preferredValue;
    }
  }

  const exactValue = attrs[attrLocalName];
  if (typeof exactValue === 'string' && exactValue.trim() !== '') {
    return exactValue;
  }

  for (const [attrName, value] of Object.entries(attrs)) {
    if (typeof value !== 'string' || value.trim() === '') continue;

    const { prefix, localName } = splitQName(attrName);
    if (!prefix) continue;

    if (localName === attrLocalName && isExtensionPrefix(prefix)) {
      return value;
    }
  }

  return undefined;
}

export function setAttr(target: any, attrName: string, value: any): void {
  if (!target || value === undefined) return;

  if (typeof target.set === 'function') {
    try {
      target.set(attrName, value);
      return;
    } catch {
      // Fall through to direct $attrs mutation when target.set rejects the attr.
    }
  }

  const attrs = target.$attrs;
  if (attrs && typeof attrs === 'object') {
    attrs[attrName] = value;
  }
}

export function setAppliedType(target: any, studyflowType: string | undefined): void {
  if (!studyflowType) return;

  const { prefix } = splitQName(studyflowType);
  if (!prefix) return;
  setAttr(target, `${prefix}:${APPLIED_TYPE_ATTR_LOCAL_NAME}`, studyflowType);
}

export const APPLIED_TYPE_ATTR = APPLIED_TYPE_ATTR_LOCAL_NAME;
