import en from './assets/locales/en.json';

const translations: Record<string, string> = en;

export function t(key: string) {
    if (key in translations) return translations[key];
    const localName = key.includes(':') ? key.slice(key.indexOf(':') + 1) : undefined;
    if (localName && localName in translations) return translations[localName];
    return key;
}
