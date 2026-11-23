import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DICTIONARIES,
  LOCALE_OPTIONS,
  LOCALE_STORAGE_KEY,
  detectInitialLocale,
  resolveLocaleFromLanguage,
  translate,
  type Locale,
  type TranslationDict,
  type TranslationKey,
} from './core';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh-TW',
  setLocale: () => {},
  t: (key, params) => translate('zh-TW', key, params),
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectInitialLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Ignore storage access errors
    }
  }, []);

  useEffect(() => {
    const opt = LOCALE_OPTIONS.find((o) => o.id === locale);
    if (opt && typeof document !== 'undefined') {
      document.documentElement.lang = opt.htmlLang;
      document.title = translate(locale, 'app.title');
    }
  }, [locale]);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export {
  DICTIONARIES,
  LOCALE_OPTIONS,
  LOCALE_STORAGE_KEY,
  detectInitialLocale,
  resolveLocaleFromLanguage,
  translate,
};
export type { Locale, TranslationKey, TranslationDict };
