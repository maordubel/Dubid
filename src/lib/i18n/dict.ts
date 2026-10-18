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

  /* ---- לובי ---- */
  'lobby.edition':    { he: 'שנה ב׳ · גיליון', en: 'Year 2 · Issue', el: 'Έτος 2 · Τεύχος' },
  'lobby.entrants':   { he: 'משתתפים', en: 'players', el: 'παίκτες' },
  'lobby.brand':      { he: 'דוביד', en: 'DUBID', el: 'DUBID' },
  'lobby.edition2':   { he: 'מהדורת המחזור', en: 'Gameweek edition', el: 'Έκδοση αγωνιστικής' },
  'lobby.modes.aria': { he: 'בחירת מצב משחק', en: 'Choose a game mode', el: 'Επιλογή τρόπου παιχνιδιού' },
  'lobby.myResults':  { he: 'התוצאות שלי', en: 'My results', el: 'Τα αποτελέσματά μου' },
  'lobby.round':      { he: 'מחזור', en: 'Round', el: 'Αγωνιστική' },
  'lobby.points':     { he: 'נקודות', en: 'Points', el: 'Βαθμοί' },
  'lobby.rank':       { he: 'מקום', en: 'Rank', el: 'Θέση' },
  'lobby.leagues':    { he: 'ליגות', en: 'Leagues', el: 'Λίγκες' },
  'lobby.fixtures':   { he: 'לוח המשחקים', en: 'Fixtures', el: 'Πρόγραμμα' },
  'lobby.noFixtures': { he: 'הלוח טרם פורסם.', en: 'Fixtures not published yet.', el: 'Το πρόγραμμα δεν έχει ανακοινωθεί.' },
  'lobby.private':    { he: 'ליגות פרטיות', en: 'Private leagues', el: 'Ιδιωτικές λίγκες' },
  'lobby.privateHint':{ he: 'שחקו מול חברים', en: 'Play your friends', el: 'Παίξτε με φίλους' },
  'lobby.leaguesN':   { he: 'ליגות', en: 'leagues', el: 'λίγκες' },
  'lobby.ranking':    { he: 'הדירוג', en: 'Ranking', el: 'Κατάταξη' },
  'lobby.rankingHint':{ he: 'מי מוביל', en: "Who's leading", el: 'Ποιος προηγείται' },
  'lobby.page':       { he: 'עמוד', en: 'Page', el: 'Σελίδα' },
  'lobby.locksIn':    { he: 'ננעל בעוד', en: 'Locks in', el: 'Κλειδώνει σε' },
  'lobby.lineupsLockIn': { he: 'ההרכבים ננעלים בעוד', en: 'Lineups lock in', el: 'Οι ενδεκάδες κλειδώνουν σε' },
  'lobby.resultsOut': { he: 'התוצאות פורסמו', en: 'Results are out', el: 'Τα αποτελέσματα βγήκαν' },
  'lobby.lineupsLocked': { he: 'ההרכבים נעולים', en: 'Lineups locked', el: 'Οι ενδεκάδες κλείδωσαν' },
  'lobby.caption':    { he: 'מי שמכיר את הליגה — יודע מה קורה בשבת.', en: 'If you know the league, you know what Saturday brings.', el: 'Όποιος ξέρει το πρωτάθλημα, ξέρει τι γίνεται το Σάββατο.' },
  'lobby.photo':      { he: 'צילום: ארכיון', en: 'Photo: archive', el: 'Φωτό: αρχείο' },
  'lobby.view':       { he: 'לצפייה ›', en: 'View ›', el: 'Προβολή ›' },
  'lobby.playNow':    { he: 'שחק עכשיו ›', en: 'Play now ›', el: 'Παίξε τώρα ›' },
  'lobby.locked':     { he: 'נעול', en: 'Locked', el: 'Κλειδωμένο' },
  'mode.five.title':  { he: 'דוביד 5', en: 'DUBID 5', el: 'DUBID 5' },
  'mode.full.title':  { he: 'דוביד 11', en: 'DUBID 11', el: 'DUBID 11' },
  'mode.five.tag':    { he: 'בחרו 5. נצחו את כולם.', en: 'Pick 5. Beat everyone.', el: 'Διάλεξε 5. Νίκησέ τους όλους.' },
  'mode.full.tag':    { he: 'בנו הרכב. שלטו בליגה.', en: 'Build a lineup. Rule the league.', el: 'Φτιάξε ενδεκάδα. Κυρίευσε τη λίγκα.' },
  'status.submittedPts': { he: 'הוגש · {pts} נק׳', en: 'Submitted · {pts} pts', el: 'Υποβλήθηκε · {pts} β.' },
  'status.submittedPtsRank': { he: 'הוגש · {pts} נק׳ · מקום {rank}', en: 'Submitted · {pts} pts · rank {rank}', el: 'Υποβλήθηκε · {pts} β. · θέση {rank}' },
  'status.lineupLocked': { he: 'ההרכב נעול', en: 'Lineup locked', el: 'Η ενδεκάδα κλείδωσε' },
  'status.closed':    { he: 'ההגשות סגורות', en: 'Submissions closed', el: 'Οι υποβολές έκλεισαν' },
  'status.draft':     { he: 'בטיוטה · {filled}/{size}', en: 'Draft · {filled}/{size}', el: 'Πρόχειρο · {filled}/{size}' },
  'status.notStarted':{ he: 'טרם התחלת', en: 'Not started', el: 'Δεν ξεκίνησες' },
  /* ---- שעון מועד ---- */
  'deadline.locked':  { he: 'ההרכבים נעולים', en: 'Lineups locked', el: 'Οι ενδεκάδες κλείδωσαν' },
  'deadline.lockedFlash': { he: 'נעול', en: 'Locked', el: 'Κλειδωμένο' },
  'deadline.lockedNote': { he: 'הכדור כבר מתגלגל.', en: 'The ball is already rolling.', el: 'Η μπάλα κυλάει ήδη.' },
  'deadline.flashFar':{ he: 'מבזק', en: 'Bulletin', el: 'Έκτακτο' },
  'deadline.farNote': { he: 'אחרי זה אין שינויים.', en: 'No changes after that.', el: 'Μετά δεν γίνονται αλλαγές.' },
  'deadline.lastDay': { he: 'היום האחרון', en: 'Last day', el: 'Τελευταία μέρα' },
  'deadline.todayNote': { he: 'השעון רץ.', en: 'The clock is ticking.', el: 'Το ρολόι τρέχει.' },
  'deadline.lastHour':{ he: 'שעה אחרונה', en: 'Final hour', el: 'Τελευταία ώρα' },
  'deadline.urgentNote': { he: 'אחרי זה אי אפשר לשנות כלום.', en: 'After that you can change nothing.', el: 'Μετά δεν αλλάζει τίποτα.' },
  'deadline.inDay':   { he: 'בעוד יום', en: 'in 1 day', el: 'σε 1 μέρα' },
  'deadline.inDays2': { he: 'בעוד יומיים', en: 'in 2 days', el: 'σε 2 μέρες' },
  'deadline.inDaysN': { he: 'בעוד {n} ימים', en: 'in {n} days', el: 'σε {n} μέρες' },
  'gw.status.draft':     { he: 'בהכנה', en: 'In preparation', el: 'Σε προετοιμασία' },
  'gw.status.open':      { he: 'פתוח', en: 'Open', el: 'Ανοιχτό' },
  'gw.status.locked':    { he: 'ננעל', en: 'Locked', el: 'Κλειδωμένο' },
  'gw.status.live':      { he: 'בשידור חי', en: 'Live', el: 'Ζωντανά' },
  'gw.status.scoring':   { he: 'מחשבים ניקוד', en: 'Scoring', el: 'Υπολογισμός βαθμών' },
  'gw.status.published': { he: 'פורסם', en: 'Final', el: 'Οριστικό' },
  'gw.status.archived':  { he: 'ארכיון', en: 'Archive', el: 'Αρχείο' },
  'mode.five.code':      { he: 'הרחוב', en: 'The Street', el: 'Ο Δρόμος' },
  'mode.full.code':      { he: 'הליגה', en: 'The League', el: 'Η Λίγκα' },
  'lobby.leagueRound':   { he: '{league} · מחזור', en: '{league} · Round', el: '{league} · Αγωνιστική' },
} as const satisfies Record<string, Entry>;

export type DictKey = keyof typeof DICT;

export function translate(
  key: DictKey, locale: Locale, vars?: Record<string, string | number>,
): string {
  const e = DICT[key] as Entry;
  const raw = e[locale] || e.en || e.he;
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : raw;
}
