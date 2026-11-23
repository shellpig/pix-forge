import { zhTW, type TranslationDict, type TranslationKey } from './zh-TW';
import { en } from './en';
import { ja } from './ja';

export type Locale = 'zh-TW' | 'en' | 'ja';

export const LOCALE_STORAGE_KEY = 'pixforge:locale';

export const LOCALE_OPTIONS: Array<{ id: Locale; label: string; htmlLang: string }> = [
  { id: 'zh-TW', label: '繁體中文', htmlLang: 'zh-Hant' },
  { id: 'en', label: 'English', htmlLang: 'en' },
  { id: 'ja', label: '日本語', htmlLang: 'ja' },
];

export const DICTIONARIES: Record<Locale, TranslationDict> = {
  'zh-TW': zhTW,
  en,
  ja,
};

export function resolveLocaleFromLanguage(lang: string | null | undefined): Locale {
  if (!lang) return 'en';
  const normalized = lang.trim().toLowerCase();
  if (normalized.startsWith('zh')) return 'zh-TW';
  if (normalized.startsWith('ja')) return 'ja';
  return 'en';
}

export function detectInitialLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'zh-TW' || saved === 'en' || saved === 'ja') {
      return saved;
    }
  } catch {
    // Ignore storage access errors
  }
  if (typeof navigator !== 'undefined') {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const lang of langs) {
      if (!lang) continue;
      const lower = lang.toLowerCase();
      if (lower.startsWith('zh')) return 'zh-TW';
      if (lower.startsWith('ja')) return 'ja';
      if (lower.startsWith('en')) return 'en';
    }
    return resolveLocaleFromLanguage(navigator.language);
  }
  return 'en';
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  const dict = DICTIONARIES[locale] ?? zhTW;
  let text = dict[key] ?? zhTW[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export type { TranslationKey, TranslationDict };
