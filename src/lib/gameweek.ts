/**
 * lib/gameweek.ts — מחזור המשחק כמכונת מצבים.
 *
 *   DRAFT → OPEN → LOCKED → LIVE → SCORING → PUBLISHED → ARCHIVED
 *
 * ★ למה הקובץ הזה טהור לחלוטין
 *
 * אף פונקציה כאן לא קוראת ל-`Date.now()`. הזמן תמיד מגיע כפרמטר.
 * זה נשמע קטנוני והוא הדבר הכי חשוב בקובץ:
 *
 *   · אותה פונקציה בדיוק רצה בדפדפן (כדי להציג "נעול בעוד 2 שעות")
 *     וב-Edge Function (כדי לאכוף).
 *   · אפשר לבדוק "מה קורה שנייה לפני הדדליין" בלי לחכות.
 *   · הקליינט מזין שעון מסונכרן-שרת, השרת מזין `now()` של המסד.
 *     שניהם מקבלים את אותה תשובה.
 *
 * ★ מה הקובץ הזה *לא*
 *
 * זו לא שכבת אבטחה. הקליינט מריץ אותה כדי לא להפתיע את המשתמש;
 * האכיפה האמיתית היא ב-`game.submit_lineup` במסד (מיגרציה 05).
 * לקוח שיעקוף את הקוד הזה ייתקל בחומה בשרת.
 */

export const GameweekStatus = {
  /** האדמין עדיין מרכיב את המחזור. לא גלוי למשתמשים. */
  Draft: 'draft',
  /** פתוח להגשות. */
  Open: 'open',
  /** הדדליין עבר. אין הגשות ואין עריכות. */
  Locked: 'locked',
  /** משחקים מתנהלים. */
  Live: 'live',
  /** כל המשחקים הסתיימו, הניקוד מחושב. */
  Scoring: 'scoring',
  /** התוצאות פורסמו. הדירוג גלוי. */
  Published: 'published',
  /** נסגר להיסטוריה. */
  Archived: 'archived',
} as const;
export type GameweekStatusValue = (typeof GameweekStatus)[keyof typeof GameweekStatus];

/**
 * מעברים מותרים. מפה מפורשת ולא `if` מפוזרים —
 * כך "אי אפשר לחזור מ-PUBLISHED ל-OPEN" הוא עובדה בקוד ולא נוהל.
 */
const TRANSITIONS: Record<GameweekStatusValue, readonly GameweekStatusValue[]> = {
  draft:     ['open'],
  open:      ['locked', 'draft'],       // חזרה לטיוטה רק לפני שנפתחו הגשות
  locked:    ['live', 'open'],          // פתיחה מחדש = החלטת אדמין מתועדת
  live:      ['scoring'],
  scoring:   ['published', 'live'],     // חזרה ל-live אם התגלה משחק שלא הסתיים
  published: ['archived', 'scoring'],   // חזרה ל-scoring אם נדרש תיקון
  archived:  [],
};

export function canTransition(
  from: GameweekStatusValue,
  to: GameweekStatusValue,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: GameweekStatusValue): readonly GameweekStatusValue[] {
  return TRANSITIONS[from] ?? [];
}

/* =================================================================== */
/* המחזור עצמו                                                          */
/* =================================================================== */

export interface Gameweek {
  id: string;
  number: number;
  label: string;
  status: GameweekStatusValue;
  /** ISO-8601. הרגע שאחריו אין הגשות. */
  deadlineAt: string;
  /** בעיטת הפתיחה הראשונה במחזור. ISO-8601. */
  firstKickoffAt?: string;
}

/**
 * ★ שאלת האמת: מותר להגיש עכשיו?
 *
 * שני תנאים, ושניהם חייבים להתקיים:
 *   1. הסטטוס הוא OPEN
 *   2. הזמן עוד לא הגיע לדדליין
 *
 * הסטטוס לבדו לא מספיק — cron שמעביר ל-LOCKED יכול לאחר בדקה,
 * ובדקה הזו מישהו יגיש אחרי הדדליין. הדדליין לבדו לא מספיק —
 * אדמין יכול לנעול מוקדם. לכן: שניהם.
 */
export function isSubmissionOpen(gw: Gameweek, nowMs: number): boolean {
  if (gw.status !== GameweekStatus.Open) return false;
  return nowMs < Date.parse(gw.deadlineAt);
}

/** מילישניות עד הנעילה. 0 = נעול. */
export function msUntilDeadline(gw: Gameweek, nowMs: number): number {
  const deadline = Date.parse(gw.deadlineAt);
  if (!Number.isFinite(deadline)) return 0;
  return Math.max(0, deadline - nowMs);
}

/**
 * הסטטוס ש*אמור* לחול לפי השעון.
 *
 * מחזיר `null` כשאין שינוי. משמש את ה-cron בשרת, ומאפשר ל-UI
 * לזהות מחזור "תקוע" — סטטוס OPEN שהדדליין שלו עבר לפני שעה
 * הוא סימן שהאוטומציה נפלה, ועדיף להראות את זה מאשר להסתיר.
 */
export function dueStatus(gw: Gameweek, nowMs: number): GameweekStatusValue | null {
  if (gw.status === GameweekStatus.Open && nowMs >= Date.parse(gw.deadlineAt)) {
    return GameweekStatus.Locked;
  }
  if (
    gw.status === GameweekStatus.Locked &&
    gw.firstKickoffAt &&
    nowMs >= Date.parse(gw.firstKickoffAt)
  ) {
    return GameweekStatus.Live;
  }
  return null;
}

/** האם הדירוג והתוצאות גלויים למשתמשים. */
export function areResultsVisible(gw: Gameweek): boolean {
  return gw.status === GameweekStatus.Published || gw.status === GameweekStatus.Archived;
}

/** האם המחזור גלוי בכלל למשתמש רגיל. */
export function isVisibleToUsers(gw: Gameweek): boolean {
  return gw.status !== GameweekStatus.Draft;
}

/* =================================================================== */
/* תצוגה                                                               */
/* =================================================================== */

export const STATUS_LABEL_HE: Record<GameweekStatusValue, string> = {
  draft:     'בהכנה',
  open:      'פתוח',
  locked:    'ננעל',
  live:      'בשידור חי',
  scoring:   'מחשבים ניקוד',
  published: 'פורסם',
  archived:  'ארכיון',
};

/**
 * הפעולה הראשית שהמשתמש אמור לעשות עכשיו.
 * הברִיף: "לכל מסך חשוב פעולה ראשית אחת ברורה".
 */
export const STATUS_CTA_HE: Record<GameweekStatusValue, string> = {
  draft:     'המחזור עוד לא נפתח',
  open:      'בניית ההרכב',
  locked:    'ההרכב נעול',
  live:      'המשחקים בעיצומם',
  scoring:   'מחשבים את הניקוד',
  published: 'צפייה בתוצאות',
  archived:  'צפייה בהיסטוריה',
};

/**
 * ספירה לאחור קריאה. תמיד LTR, תמיד שתי ספרות.
 * מחזירה מחרוזת ולא אובייקט כי זה מה שהמסך צריך, ו-`num`
 * ב-CSS כבר מטפל בכיווניות.
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return days > 0
    ? `${days}ד ${pad(h)}:${pad(m)}:${pad(s)}`
    : `${pad(h)}:${pad(m)}:${pad(s)}`;
}
