/**
 * I18nContext.tsx — React context provider for locale, translation, and RTL.
 *
 * Wraps the app. Loads the correct dictionary on mount and exposes:
 *   - locale: current compound locale
 *   - t(key, vars?): translation function
 *   - isRTL: boolean for layout direction
 *   - setLocale(locale): change locale (triggers reload)
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  type Locale,
  ALL_LOCALES,
  getSavedLocale, saveLocale, clearLocale,
  loadDictionary, setCurrentDictionary,
  t as _t, isRTL as _isRTL,
} from '../lib/i18n';

// ── URL override: ?lang=en-us forces locale and persists it ─────────────
function getUrlLocaleOverride(): Locale | null {
  try {
    const param = new URLSearchParams(window.location.search).get('lang');
    if (param && ALL_LOCALES.includes(param as Locale)) {
      saveLocale(param as Locale);          // persist so it sticks after reload
      // Strip the ?lang= param from the URL to keep it clean
      const url = new URL(window.location.href);
      url.searchParams.delete('lang');
      window.history.replaceState({}, '', url.toString());
      return param as Locale;
    }
  } catch { /* SSR / restricted */ }
  return null;
}

interface I18nContextValue {
  locale: Locale | null;
  t: typeof _t;
  isRTL: boolean;
  ready: boolean;
  setLocale: (locale: Locale) => void;
  resetLocale: () => void;
}

const I18nContext = createContext<I18nContextValue>({
  locale: null,
  t: _t,
  isRTL: false,
  ready: false,
  setLocale: () => {},
  resetLocale: () => {},
});

export function useI18n() {
  return useContext(I18nContext);
}

interface Props {
  children: ReactNode;
}

export function I18nProvider({ children }: Props) {
  const [locale, setLocaleState] = useState<Locale | null>(getUrlLocaleOverride() ?? getSavedLocale());
  const [ready, setReady] = useState(false);

  // Load dictionary when locale changes
  useEffect(() => {
    if (!locale) {
      setReady(true); // No locale = show LanguageGate
      return;
    }

    let cancelled = false;
    setReady(false);

    loadDictionary(locale).then(dict => {
      if (cancelled) return;
      setCurrentDictionary(dict, locale);
      setReady(true);

      // Apply RTL direction to document
      document.documentElement.dir = _isRTL(locale) ? 'rtl' : 'ltr';
      document.documentElement.lang = locale.split('-')[0];
    }).catch(() => {
      // Fallback: continue without translations (English keys shown)
      if (!cancelled) setReady(true);
    });

    return () => { cancelled = true; };
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    saveLocale(newLocale);
    setLocaleState(newLocale);
  }, []);

  const resetLocale = useCallback(() => {
    clearLocale();
    setLocaleState(null);
    document.documentElement.dir = 'ltr';
    document.documentElement.lang = 'en';
  }, []);

  const value: I18nContextValue = {
    locale,
    t: _t,
    isRTL: locale ? _isRTL(locale) : false,
    ready,
    setLocale,
    resetLocale,
  };

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export default I18nContext;
