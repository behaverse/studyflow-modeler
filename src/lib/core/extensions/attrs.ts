import { CORE_PREFIXES } from '../constants';
import { splitQName } from '../utils/naming';

export { CORE_PREFIXES };

export function isExtensionPrefix(prefix: string | undefined): boolean {
  return !!prefix && !CORE_PREFIXES.has(prefix);
}

export function getAttr(target: any, localName: string, preferredPrefix?: string): string | undefined {
  const attrs = target?.$attrs;
  if (!attrs || typeof attrs !== 'object') return undefined;

  const pick = (val: any) => (typeof val === 'string' && val.trim() !== '' ? val : undefined);

  if (preferredPrefix) {
    const v = pick(attrs[`${preferredPrefix}:${localName}`]);
    if (v) return v;
  }

  const exact = pick(attrs[localName]);
  if (exact) return exact;

  for (const [name, value] of Object.entries(attrs)) {
    const v = pick(value);
    if (!v) continue;
    const { prefix, localName: ln } = splitQName(name);
    if (ln === localName && isExtensionPrefix(prefix)) return v;
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
      // fall through to direct $attrs mutation
    }
  }

  if (target.$attrs && typeof target.$attrs === 'object') {
    target.$attrs[attrName] = value;
  }
}
