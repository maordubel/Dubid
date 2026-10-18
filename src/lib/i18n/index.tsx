/**
 * i18n/index.tsx — ספק שפה אחד לכל האפליקציה.
 *  · השפה נשמרת במכשיר (העדפת תצוגה בלבד, לא דאטת משחק).
 *  · <html lang dir> מתעדכן יחד איתה — כיוון הכתיבה נגזר מהשפה.
 *  · ברירת מחדל: עברית, כלומר שום שינוי למי שלא בחר.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, dirOf, isLocale, type Locale } from './locales.ts';
import { translate, type DictKey } from './dict.ts';

// ★ בלי הקידומת `dubid.` — purgeLocalGameData מוחק כל מפתח כזה בכל החלפת epoch.
const KEY = 'ui.locale';

function readStored(): Locale {
  try {
    const v = localStorage.getItem(KEY);
    return isLocale(v) ? v : DEFAULT_LOCALE;
  } catch { return DEFAULT_LOCALE; }
}

interface Ctx {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  setLocale: (l: Locale) => void;
  t: (key: DictKey) => string;
}

const I18nContext = createContext<Ctx>({
  locale: DEFAULT_LOCALE, dir: dirOf(DEFAULT_LOCALE), setLocale: () => {},
  t: (k) => translate(k, DEFAULT_LOCALE),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, set] = useState<Locale>(readStored);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dirOf(locale);
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    set(l);
    try { localStorage.setItem(KEY, l); } catch { /* מצב פרטי — נשארים בזיכרון */ }
  }, []);

  const value = useMemo<Ctx>(() => ({
    locale, dir: dirOf(locale), setLocale, t: (k) => translate(k, locale),
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
