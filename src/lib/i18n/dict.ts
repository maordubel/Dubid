/**
 * i18n/dict.ts — מילון המסכים. מפתח חסר באחת השפות = כשל בבדיקה
 * (tests/i18n.test.ts), לא טקסט ריק במסך.
 * מתרגמים בהדרגה: מפתח שלא עבר לכאן ממשיך להופיע בעברית כמו היום.
 */
import type { Locale } from './locales.ts';

export type Entry = Record<Locale, string>;

import { DICT_SHELL } from './dict.shell.ts';
import { DICT_LINEUP } from './dict.lineup.ts';
import { DICT_BOARD } from './dict.board.ts';
import { DICT_ACCOUNT } from './dict.account.ts';

const CORE = {
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
  'lobby.recommended': { he: 'מומלץ לסיבוב הראשון', en: 'Recommended for your first round', el: 'Προτείνεται για τον πρώτο σου γύρο' },
  'lobby.cta.build5':   { he: 'בנו את החמישייה ›', en: 'Build your five ›', el: 'Φτιάξε την πεντάδα σου ›' },
  'lobby.cta.build11':  { he: 'בנו את ההרכב ›', en: 'Build your eleven ›', el: 'Φτιάξε την ενδεκάδα σου ›' },
  'lobby.cta.continue': { he: 'להמשיך · {filled}/{size} ›', en: 'Continue · {filled}/{size} ›', el: 'Συνέχεια · {filled}/{size} ›' },
  'lobby.cta.submit':   { he: 'לבדוק ולהגיש ›', en: 'Review & submit ›', el: 'Έλεγχος & υποβολή ›' },
  'lobby.cta.review':   { he: 'ההרכב שלי ›', en: 'My lineup ›', el: 'Η ενδεκάδα μου ›' },
  'lobby.cta.follow':   { he: 'לעקוב אחרי המחזור ›', en: 'Follow your round ›', el: 'Παρακολούθησε τον γύρο ›' },
  'lobby.cta.watch':    { he: 'לצפות במחזור ›', en: 'Watch the round ›', el: 'Δες τον γύρο ›' },
  'lobby.cta.recap':    { he: 'הסיכום שלי ›', en: 'My recap ›', el: 'Η σύνοψή μου ›' },
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
  /* ---- מסך בחירת ליגה ---- */
  'gate.title':     { he: 'באיזו ליגה משחקים?', en: 'Pick your league', el: 'Διάλεξε πρωτάθλημα' },
  'gate.sub':       { he: 'כל ליגה היא משחק נפרד: מחזורים, טבלה, דירוג והיסטוריה משלה.', en: 'Each league is its own game: its own rounds, table, ranking and history.', el: 'Κάθε πρωτάθλημα είναι ξεχωριστό παιχνίδι: δικές του αγωνιστικές, βαθμολογία, κατάταξη και ιστορικό.' },
  'gate.loadFail.title': { he: 'לא הצלחנו לטעון את הליגה', en: "Couldn't load this league", el: 'Δεν φορτώθηκε το πρωτάθλημα' },
  'gate.loadFail.sub':   { he: 'הליגה שבחרת נשארת כמו שהיא. בדוק חיבור ונסה שוב, או בחר ליגה אחרת.', en: 'Your league choice is kept. Check your connection and retry, or pick another league.', el: 'Η επιλογή σου διατηρείται. Έλεγξε τη σύνδεση και δοκίμασε ξανά, ή διάλεξε άλλο πρωτάθλημα.' },
  'gate.loadFail.retry': { he: 'נסה שוב', en: 'Retry', el: 'Δοκίμασε ξανά' },
  'gate.loadFail.other': { he: 'בחר ליגה אחרת', en: 'Choose another league', el: 'Διάλεξε άλλο πρωτάθλημα' },
  'gate.onlyFive': { he: 'חמישייה בלבד כרגע', en: 'DUBID 5 only for now', el: 'Μόνο DUBID 5 προς το παρόν' },
  'gate.onlyFull': { he: 'הרכב מלא בלבד כרגע', en: 'DUBID 11 only for now', el: 'Μόνο DUBID 11 προς το παρόν' },
  'gate.delayed':  { he: 'הנתונים מתעכבים', en: 'Data is delayed', el: 'Τα δεδομένα καθυστερούν' },
  'gate.play':      { he: 'כניסה', en: 'Enter', el: 'Είσοδος' },
  'gate.here':      { he: 'אתם כאן', en: "You're here", el: 'Είσαι εδώ' },
  'gate.soon':      { he: 'בקרוב', en: 'Coming soon', el: 'Σύντομα' },
  'gate.soonNote':  { he: 'המחזור הראשון נפתח ביום שני.', en: 'The first round opens on Monday.', el: 'Η πρώτη αγωνιστική ανοίγει τη Δευτέρα.' },
  'gate.round':     { he: 'מחזור {n}', en: 'Round {n}', el: 'Αγωνιστική {n}' },
  'gate.open':      { he: 'פתוח להגשה', en: 'Open', el: 'Ανοιχτό' },
  'gate.locked':    { he: 'נעול', en: 'Locked', el: 'Κλειδωμένο' },
  'gate.live':      { he: 'בשידור חי', en: 'Live', el: 'Ζωντανά' },
  'gate.final':     { he: 'הסתיים', en: 'Final', el: 'Ολοκληρώθηκε' },
  'gate.prep':      { he: 'בהכנה', en: 'Preparing', el: 'Σε προετοιμασία' },
  'gate.locksIn':   { he: 'ננעל בעוד {t}', en: 'Locks in {t}', el: 'Κλειδώνει σε {t}' },
  'gate.entrants':  { he: '{n} משתתפים', en: '{n} players', el: '{n} παίκτες' },
  'gate.close':     { he: 'סגירה', en: 'Close', el: 'Κλείσιμο' },
  'gate.switch':    { he: 'החלפת ליגה', en: 'Switch league', el: 'Αλλαγή πρωταθλήματος' },
  'gate.dur.d':     { he: '{d} י׳ {h} ש׳', en: '{d}d {h}h', el: '{d}μ {h}ω' },
  'gate.dur.h':     { he: '{h} ש׳ {m} ד׳', en: '{h}h {m}m', el: '{h}ω {m}λ' },
  'gate.dur.m':     { he: '{m} ד׳', en: '{m}m', el: '{m}λ' },
} as const satisfies Record<string, Entry>;

/** המילון המלא = ליבה + מודולי אזור (כל אחד בקובץ משלו כדי למנוע התנגשויות). */
export const DICT = { ...CORE, ...DICT_SHELL, ...DICT_LINEUP, ...DICT_BOARD, ...DICT_ACCOUNT } as const;

export type DictKey = keyof typeof DICT;

export function translate(
  key: DictKey, locale: Locale, vars?: Record<string, string | number>,
): string {
  const e = DICT[key] as Entry;
  const raw = e[locale] || e.en || e.he;
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : raw;
}

/* שפה פעילה לקוד שאינו רכיב React (תוויות, כרטיסי שיתוף, הודעות).
   נקבעת ע"י I18nProvider בכל רינדור, ולכן קוד שנקרא בזמן רינדור רואה את השפה הנכונה. */
let active: Locale = 'he';
export const setActiveLocale = (l: Locale) => { active = l; };
export const activeLocale = (): Locale => active;
export const tr = (key: DictKey, vars?: Record<string, string | number>): string =>
  translate(key, active, vars);
