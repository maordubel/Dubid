/**
 * i18n/dict.ts — מילון המסכים. מפתח חסר באחת השפות = כשל בבדיקה
 * (tests/i18n.test.ts), לא טקסט ריק במסך.
 * מתרגמים בהדרגה: מפתח שלא עבר לכאן ממשיך להופיע בעברית כמו היום.
 */
import type { Locale } from './locales.ts';

type Entry = Record<Locale, string>;

export const DICT = {
  'nav.home':        { he: 'בית',    en: 'Home',     el: 'Αρχική' },
  'nav.lineup':      { he: 'ההרכב',  en: 'Lineup',   el: 'Ενδεκάδα' },
  'nav.ranking':     { he: 'דירוג',  en: 'Ranking',  el: 'Κατάταξη' },
  'nav.arena':       { he: 'הזירה',  en: 'Arena',    el: 'Αρένα' },
  'nav.rules':       { he: 'חוקים',  en: 'Rules',    el: 'Κανόνες' },
  'nav.aria':        { he: 'ניווט ראשי', en: 'Main navigation', el: 'Κύρια πλοήγηση' },
  'lang.label':      { he: 'שפה',    en: 'Language', el: 'Γλώσσα' },
  'lang.aria':       { he: 'בחירת שפה', en: 'Choose language', el: 'Επιλογή γλώσσας' },
  'common.players':  { he: 'שחקנים', en: 'Players',  el: 'Παίκτες' },
  'common.points':   { he: 'נקודות', en: 'Points',   el: 'Βαθμοί' },
  'common.round':    { he: 'מחזור',  en: 'Round',    el: 'Αγωνιστική' },
  'league.pick':     { he: 'בחרו ליגה', en: 'Choose a league', el: 'Επιλέξτε πρωτάθλημα' },
  'league.il':       { he: 'ליגת העל (ישראל)', en: 'Israeli Premier League', el: 'Ισραηλινή Premier League' },
  'league.gr':       { he: 'סופר ליג (יוון)', en: 'Greek Super League', el: 'Super League Ελλάδας' },
} as const satisfies Record<string, Entry>;

export type DictKey = keyof typeof DICT;

export function translate(key: DictKey, locale: Locale): string {
  const e = DICT[key] as Entry;
  return e[locale] || e.en || e.he;
}
