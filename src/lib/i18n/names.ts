/**
 * i18n/names.ts — שם תצוגה של קבוצה/שחקן לפי שפה.
 * ★ «TBD» ושם ריק אינם שם: ב-IL חלק משמות השחקנים באנגלית הם placeholder,
 *   ואסור שיופיעו במסך אנגלי. נפילה: שפה → אנגלית → עברית.
 */
import type { Locale } from './locales.ts';

const usable = (s: string | null | undefined): s is string =>
  !!s && s.trim() !== '' && s.trim().toUpperCase() !== 'TBD';

export function displayName(
  n: { he?: string | null; en?: string | null; el?: string | null },
  locale: Locale,
): string {
  const order: Array<string | null | undefined> =
    locale === 'el' ? [n.el, n.en, n.he]
    : locale === 'en' ? [n.en, n.he, n.el]
    : [n.he, n.en, n.el];
  return order.find(usable) ?? '';
}
