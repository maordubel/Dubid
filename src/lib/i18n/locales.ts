/**
 * i18n/locales.ts — השפות הנתמכות, כיוון הכתיבה ופורמט תאריכים.
 * אנגלית היא ברירת המחדל לביקור ראשון; מי שבחר שפה — הבחירה נשמרת ב-`ui.locale`.
 */
export const LOCALES = ['he', 'en', 'el'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_META: Record<Locale, { dir: 'rtl' | 'ltr'; native: string; intl: string }> = {
  he: { dir: 'rtl', native: 'עברית', intl: 'he-IL' },
  en: { dir: 'ltr', native: 'English', intl: 'en-GB' },
  el: { dir: 'ltr', native: 'Ελληνικά', intl: 'el-GR' },
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

export const dirOf = (l: Locale): 'rtl' | 'ltr' => LOCALE_META[l].dir;

/** מחרוזת שמורה לפי שפה, עם נפילה לאנגלית ואז לעברית. */
export function pickName(
  names: Partial<Record<Locale, string>> | null | undefined,
  locale: Locale,
): string {
  return names?.[locale] ?? names?.en ?? names?.he ?? '';
}

/** תאריך/שעה לפי אזור הזמן של הליגה — לא לפי המכשיר. */
export function formatKickoff(iso: string, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE_META[locale].intl, {
    timeZone, weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
}
