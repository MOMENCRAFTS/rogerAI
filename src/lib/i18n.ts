/**
 * i18n.ts — Core internationalization engine for RogerAI
 *
 * Provides locale types, helpers, and the `t()` translation function.
 * All UI strings flow through this system.
 */

// ── Locale Types ────────────────────────────────────────────────────────────

export type BaseLanguage = 'en' | 'ar' | 'fr' | 'es';

export type Locale =
  | 'en-us' | 'en-gb'
  | 'ar-gulf' | 'ar-egypt' | 'ar-levant'
  | 'fr-fr' | 'fr-ca'
  | 'es-es' | 'es-latam';

export const ALL_LOCALES: Locale[] = [
  'en-us', 'en-gb',
  'ar-gulf', 'ar-egypt', 'ar-levant',
  'fr-fr', 'fr-ca',
  'es-es', 'es-latam',
];

export const LOCALE_STORAGE_KEY = 'roger_locale';

// ── Helpers ─────────────────────────────────────────────────────────────────

export function getBaseLanguage(locale: Locale): BaseLanguage {
  return locale.split('-')[0] as BaseLanguage;
}

export function isRTL(locale: Locale): boolean {
  return getBaseLanguage(locale) === 'ar';
}

export function getLocaleFlag(locale: Locale): string {
  const flags: Record<Locale, string> = {
    'en-us': '🇺🇸', 'en-gb': '🇬🇧',
    'ar-gulf': '🇸🇦', 'ar-egypt': '🇪🇬', 'ar-levant': '🇯🇴',
    'fr-fr': '🇫🇷', 'fr-ca': '🇨🇦',
    'es-es': '🇪🇸', 'es-latam': '🇲🇽',
  };
  return flags[locale];
}

export function getLocaleName(locale: Locale): string {
  const names: Record<Locale, string> = {
    'en-us': 'American English', 'en-gb': 'British English',
    'ar-gulf': 'العربية (خليجي)', 'ar-egypt': 'العربية (مصري)', 'ar-levant': 'العربية (شامي)',
    'fr-fr': 'Français (France)', 'fr-ca': 'Français (Québec)',
    'es-es': 'Español (España)', 'es-latam': 'Español (Latinoamérica)',
  };
  return names[locale];
}

// ── Persistence ─────────────────────────────────────────────────────────────

export function getSavedLocale(): Locale | null {
  try {
    const val = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (val && ALL_LOCALES.includes(val as Locale)) return val as Locale;
  } catch { /* SSR / restricted storage */ }
  return null;
}

export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch { /* restricted storage */ }
}

export function clearLocale(): void {
  try {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch { /* restricted storage */ }
}

// ── Translation Function ────────────────────────────────────────────────────

export type TranslationDict = Record<string, string>;

let _currentDict: TranslationDict = {};
let _currentLocale: Locale = 'en-us';

// Lazy-load dictionaries to avoid bundling all languages upfront
const DICT_LOADERS: Record<BaseLanguage, () => Promise<{ default: TranslationDict }>> = {
  en: () => import('./translations/en'),
  ar: () => import('./translations/ar'),
  fr: () => import('./translations/fr'),
  es: () => import('./translations/es'),
};

export async function loadDictionary(locale: Locale): Promise<TranslationDict> {
  const base = getBaseLanguage(locale);
  const mod = await DICT_LOADERS[base]();
  return mod.default;
}

export function setCurrentDictionary(dict: TranslationDict, locale: Locale): void {
  _currentDict = dict;
  _currentLocale = locale;
}

export function getCurrentLocale(): Locale {
  return _currentLocale;
}

/**
 * Translate a key. Supports simple interpolation:
 *   t('greeting', { name: 'Ahmad' })  →  "Welcome, Ahmad"
 *
 * Falls back to the key itself if not found (dev-friendly).
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let str = _currentDict[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}
