/**
 * lib/teamNames.ts — הצעות לשם הקבוצה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה הצעות ולא שדה ריק
 * ═══════════════════════════════════════════════════════════════
 *
 * שדה ריק שכתוב מעליו "שם הקבוצה" הוא מטלה. רוב האנשים יקלידו
 * את שמם הפרטי או ידלגו, ואז הטבלה מלאה ב"מאור" ו"שחר" — כלומר
 * בדיוק המצב שממנו רצינו לצאת.
 *
 * כפתור שמגריל שם מצחיק הופך מטלה למשחק. מי שיש לו שם מוכן
 * מקליד אותו; מי שאין לו לוחץ פעמיים ובוחר את זה שהצחיק אותו.
 * בשני המקרים הטבלה מקבלת שם אמיתי.
 *
 * ★ המילון: שכונה, לא ספורט
 *
 * "אלופי הליגה" הוא שם משעמם כי הוא מנסה להישמע רציני. "נבחרת
 * הפלאפל" מצחיק כי הוא לא מנסה. הבריף אמר "קצת שכונה, הרבה
 * כדורגל" — וזה בדיוק המשלב.
 *
 * ★ הקובץ טהור: אין DOM, אין רשת, אין `Math.random` בזמן רינדור.
 *   ההגרלה מקבלת מספר מבחוץ (ראו `pickName`), כדי שרינדור חוזר
 *   לא יחליף את ההצעה שהמשתמש בדיוק קרא.
 */

import { activeLocale } from './i18n/dict.ts';

/** התחילית — "מי". */
const HEADS: readonly string[] = [
  'שכונת', 'מכבי', 'הפועל', 'בני', 'נבחרת', 'אלופי', 'גיבורי',
  'ועד', 'מועדון', 'אחוזת', 'יוניון', 'ליגת',
] as const;

/** הסיומת — "של מה". כאן נמצא כל ההומור. */
const TAILS: readonly string[] = [
  'התקווה', 'הסמטה', 'המרכזייה', 'הקיוסק', 'הפלאפל', 'המרפסת',
  'החניון', 'הספסל', 'בית הקפה', 'הצהריים', 'הדשא', 'הפנימייה',
  'המכולת', 'הגינה', 'התחנה', 'השוק', 'הגג', 'המדרכה',
  'הסופר', 'המגרש', 'הרחוב', 'הבלוק',
] as const;

/**
 * שמות שלמים — אלה שלא נבנים מהרכבה.
 * ★ הם קיימים כי החזקים ביותר הם תמיד היוצאים מן הכלל.
 */
const WHOLE: readonly string[] = [
  'הכדור לא נכנס', 'עוד רגע מחליף', 'קבוצת הנגד',
  'תשעים דקות של סבל', 'החלוץ שלא בעט', 'ריאל מדריך',
  'שוער בלי כפפות', 'אלופי הפרשנות', 'הקהל תמיד צודק',
  'מי שרץ מנצח', 'הרזרבה של הרזרבה',
] as const;

/* ★ אותם גדלי מאגרים בכל השפות (12 · 22 · 11), וכל שם נכנס ב-TEAM_NAME_MAX. */
const HEADS_EN: readonly string[] = [
  'Dynamo', 'Real', 'Sporting', 'Inter', 'Athletic', 'United',
  'Club', 'Union', 'Olympic', 'Racing', 'Atletico', 'Borough',
];
const TAILS_EN: readonly string[] = [
  'Kiosk', 'Car Park', 'Bus Stop', 'Corner Shop', 'Rooftop', 'Café',
  'Playground', 'Bench', 'Market', 'Pavement', 'Backyard', 'Supermarket',
  'Pitch', 'Block', 'Balcony', 'Falafel', 'Hope', 'Alley',
  'Noon', 'Courtyard', 'Street', 'Garden',
];
const WHOLE_EN: readonly string[] = [
  'The Ball Never Went In', 'Back In A Minute', 'The Other Team',
  'Ninety Minutes Of Pain', 'Striker Who Never Shot', 'Real Mediocre',
  'Goalie Without Gloves', 'Champions Of Opinions', 'Crowd Is Always Right',
  'Whoever Runs Wins', 'Reserves Of The Reserves',
];
const HEADS_EL: readonly string[] = [
  'Ντιναμό', 'Ρεάλ', 'Σπόρτινγκ', 'Ίντερ', 'Ατλέτικο', 'Γιουνάιτεντ',
  'Ένωση', 'Σύλλογος', 'Ράσινγκ', 'Αθλητική', 'Ολυμπικός', 'Νέοι',
];
const TAILS_EL: readonly string[] = [
  'Περίπτερο', 'Καφενείο', 'Πάρκινγκ', 'Μπαλκόνι', 'Ταράτσα', 'Παγκάκι',
  'Λαϊκή', 'Πλατεία', 'Σουβλάκι', 'Αλάνα', 'Γήπεδο', 'Στέκι',
  'Μπλοκ', 'Ελπίδα', 'Σοκάκι', 'Μεσημέρι', 'Αυλή', 'Κήπος',
  'Σταθμός', 'Μανάβικο', 'Δρόμος', 'Πεζοδρόμιο',
];
const WHOLE_EL: readonly string[] = [
  'Η μπάλα δεν μπήκε', 'Έρχομαι σε λίγο', 'Η αντίπαλη ομάδα',
  'Ενενήντα λεπτά πόνου', 'Ο φορ που δεν σούταρε', 'Ρεάλ Μετριότητα',
  'Γκολκίπερ χωρίς γάντια', 'Πρωταθλητές σχολίων', 'Το κοινό έχει δίκιο',
  'Όποιος τρέχει νικά', 'Η εφεδρεία της εφεδρείας',
];

function poolsFor(): { heads: readonly string[]; tails: readonly string[]; whole: readonly string[] } {
  const l = activeLocale();
  if (l === 'en') return { heads: HEADS_EN, tails: TAILS_EN, whole: WHOLE_EN };
  if (l === 'el') return { heads: HEADS_EL, tails: TAILS_EL, whole: WHOLE_EL };
  return { heads: HEADS, tails: TAILS, whole: WHOLE };
}

export const TEAM_NAME_MAX = 24;

/**
 * שם לפי מספר.
 *
 * ★ `seed` ולא `Math.random()`: הפונקציה נקראת מתוך רינדור,
 *   ואקראיות שם מחליפה את ההצעה בכל פעימת שעון — כלומר כל
 *   שנייה, בזמן שהמשתמש קורא אותה.
 *
 * ★ ואחד מכל חמישה הוא שם שלם. תערובת בלי יוצאים מן הכלל
 *   מתחילה להישמע כמו מחולל אחרי שלוש לחיצות.
 */
export function pickName(seed: number): string {
  const n = Math.abs(Math.trunc(seed || 0));
  const { heads, tails, whole } = poolsFor();
  if (n % 5 === 0) return whole[n % whole.length];
  const head = heads[n % heads.length];
  const tail = tails[Math.floor(n / heads.length) % tails.length];
  return `${head} ${tail}`;
}

/** ניקוי קלט: רווחים מיותרים ותקרת אורך. אותה תקרה כמו בשרת. */
export function cleanTeamName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trimStart().slice(0, TEAM_NAME_MAX);
}

export const TEAM_NAME_POOL_SIZE =
  HEADS.length * TAILS.length + WHOLE.length;
