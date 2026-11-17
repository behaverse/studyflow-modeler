import en from '#assets/locales/en.json';
import type { AttributeSpec } from '@core/notation';
import { toLocalName } from '@core/naming';

const translations: Record<string, string> = en;

function humanize(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A key's label; an attribute's is the one its schema gives it (`meta.label`), else the one shared by its name. */
export function t(key: string | AttributeSpec): string {
  if (typeof key !== 'string') return key.meta?.label ?? t(key.ns?.name ?? key.name);
  if (key in translations) return translations[key];
  const localName = toLocalName(key);
  if (!localName) return key;
  if (localName !== key && localName in translations) return translations[localName];
  return humanize(localName);
}
