import { createInstance } from 'i18next';
import { type PropsWithChildren, useEffect, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import {
  common,
  isLocale,
  type Locale,
  localeStorageKey,
  locales,
  type Messages,
  readLocale,
  type Translations,
} from './locales';

export { type Locale, localeStorageKey, locales, type Translations } from './locales';

type ProviderProps<T extends Messages> = PropsWithChildren<{
  translations: Translations<T>;
  titleKey: Extract<keyof T, string>;
}>;

export function LocaleProvider<T extends Messages>({
  translations,
  titleKey,
  children,
}: ProviderProps<T>) {
  const [instance] = useState(() => {
    const i18n = createInstance();
    void i18n.init({
      lng: readLocale(),
      fallbackLng: 'pt-BR',
      supportedLngs: [...locales],
      load: 'currentOnly',
      ns: ['common', 'screen'],
      defaultNS: 'screen',
      resources: Object.fromEntries(
        locales.map((locale) => [locale, { common: common[locale], screen: translations[locale] }]),
      ),
      initAsync: false,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
    return i18n;
  });

  useEffect(() => {
    const updateDocument = () => {
      const locale = instance.resolvedLanguage ?? 'pt-BR';
      document.documentElement.lang = locale;
      document.title = instance.t(titleKey);
      try {
        localStorage.setItem(localeStorageKey, locale);
      } catch {
        // Translation remains usable when browser storage is unavailable.
      }
    };
    updateDocument();
    instance.on('languageChanged', updateDocument);
    return () => {
      instance.off('languageChanged', updateDocument);
    };
  }, [instance, titleKey]);

  return (
    <I18nextProvider i18n={instance} defaultNS="screen">
      {children}
    </I18nextProvider>
  );
}

export function useMessages<T extends Messages>() {
  const { t } = useTranslation('screen');
  return (key: Extract<keyof T, string>, values: Record<string, string | number> = {}) =>
    t(String(key), values);
}

const languageNames: Record<Locale, string> = {
  'pt-BR': 'Português (Brasil)',
  es: 'Español',
  en: 'English',
};

export function LanguageSelector() {
  const { t, i18n } = useTranslation('common');
  return (
    <label className="locale-selector">
      <span>{t('language')}</span>
      <select
        value={i18n.resolvedLanguage}
        onChange={(event) => {
          if (isLocale(event.target.value)) void i18n.changeLanguage(event.target.value);
        }}
      >
        {locales.map((locale) => (
          <option key={locale} value={locale} lang={locale}>
            {languageNames[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}
