import en from '../assets/locales/en.json';


export function t(key) {
    if (!(key in en)) {
        return key;
    }
    return en[key];
}
