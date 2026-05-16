import { CORE_PREFIXES } from '../constants';
import { splitQName } from '../utils/naming';

export function isExtensionPrefix(prefix: string | undefined): boolean {
  return !!prefix && !CORE_PREFIXES.has(prefix);
}

export function getRawAttribute(target: any, localName: string, preferredPrefix?: string): string | undefined {
  const rawAttributes = target?.$attrs;
  if (!rawAttributes || typeof rawAttributes !== 'object') return undefined;

  const pick = (value: any) => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

  if (preferredPrefix) {
    const value = pick(rawAttributes[`${preferredPrefix}:${localName}`]);
    if (value) return value;
  }

  const exact = pick(rawAttributes[localName]);
  if (exact) return exact;

  for (const [name, rawValue] of Object.entries(rawAttributes)) {
    const value = pick(rawValue);
    if (!value) continue;
    const { prefix, localName: candidateLocalName } = splitQName(name);
    if (candidateLocalName === localName && isExtensionPrefix(prefix)) return value;
  }

  return undefined;
}

export function setRawAttribute(target: any, attributeName: string, value: any): void {
  if (!target || value === undefined) return;

  if (typeof target.set === 'function') {
    try {
      target.set(attributeName, value);
      return;
    } catch {
      // fall through to direct $attrs mutation
    }
  }

  if (target.$attrs && typeof target.$attrs === 'object') {
    target.$attrs[attributeName] = value;
  }
}
