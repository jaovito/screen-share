export const locales = ['pt-BR', 'es', 'en'] as const;
export type Locale = (typeof locales)[number];
export type Messages = Record<string, string>;
export type Translations<T extends Messages> = Record<Locale, { [K in keyof T]: string }>;
export const localeStorageKey = 'screen-share.locale';

export function isLocale(value: string): value is Locale {
  return locales.some((locale) => locale === value);
}

export function readLocale(): Locale {
  try {
    const stored = localStorage.getItem(localeStorageKey);
    return stored && isLocale(stored) ? stored : 'pt-BR';
  } catch {
    return 'pt-BR';
  }
}

export const common = {
  'pt-BR': { language: 'Idioma' },
  es: { language: 'Idioma' },
  en: { language: 'Language' },
};
