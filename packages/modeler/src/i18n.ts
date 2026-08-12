import en from '#assets/locales/en.json';
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

export function t(key: string) {
  if (key in translations) return translations[key];
  const localName = toLocalName(key);
  if (!localName) return key;
  if (localName !== key && localName in translations) return translations[localName];
  return humanize(localName);
}
