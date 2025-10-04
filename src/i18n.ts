import en from './assets/locales/en.json';


export function t(key: string) {
    if (!(key in en)) {
        return key;
    }
    return en[key];
}
