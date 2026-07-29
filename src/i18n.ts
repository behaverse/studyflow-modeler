import en from '@/assets/locales/en.json';
import { toLocalName } from '@/core/naming';

/**
 * Field labels.
 *
 * A schema-declared attribute gets a readable label without anyone adding a
 * translation for it: the fallback humanizes its own name (`samplingRate` ->
 * "Sampling Rate"). The locale file is the *override*, for the labels
 * humanizing gets wrong — acronyms (`uri` -> "URI"), domain spellings
 * (`bdmDataLevel` -> "BDM Data Level"), names that read better rephrased
 * (`redirectTo` -> "Redirect URL") — and for translations.
 *
 * So adding an attribute to a schema stays one edit, and a missing entry costs
 * a nicety rather than leaking `studyflow:samplingRate` into the panel.
 */

const translations: Record<string, string> = en;

/** `samplingRate` -> `Sampling Rate`, `categories` -> `Categories`. */
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
