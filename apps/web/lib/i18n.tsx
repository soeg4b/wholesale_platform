'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { dictionary } from './dictionary';

export type Locale = 'id' | 'en';
const KEY = 'wnmp_locale';

interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  // Picks the active language from bilingual DB content { id, en }
  tr: (value: unknown) => string;
}

const Ctx = createContext<I18n>(null as never);
export const useI18n = () => useContext(Ctx);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('id');

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY) as Locale | null;
    if (saved === 'id' || saved === 'en') setLocaleState(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    window.localStorage.setItem(KEY, l);
    setLocaleState(l);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => {
        let s = dictionary[key]?.[locale] ?? dictionary[key]?.en ?? key;
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
        return s;
      },
      tr: (value) => {
        if (typeof value === 'string') return value;
        const v = value as { id?: string; en?: string } | null;
        return v?.[locale] ?? v?.en ?? v?.id ?? '';
      },
    }),
    [locale, setLocale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
