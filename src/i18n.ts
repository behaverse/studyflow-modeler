import en from './assets/locales/en.json';
import { toLocalName } from '@/lib/core/utils/naming';

const translations: Record<string, string> = en;

export function t(key: string) {
  if (key in translations) return translations[key];
  const localName = toLocalName(key);
  if (localName && localName !== key && localName in translations) return translations[localName];
  return key;
}
