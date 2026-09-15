/**
 * src/lib/ingest/derive.ts — גזירות משותפות לכל המתאמים.
 *
 * ★ למה זה לא יושב בתוך המתאם
 *
 * "כמה ספג בזמן שהיה על המגרש" הוא חוק של המשחק, לא של הספק.
 * אם כל מתאם היה מחשב אותו בעצמו, שני מקורות היו נותנים שתי
 * תשובות לאותו משחק — וזו בדיוק הקטגוריה של באגים שמתגלים
 * דרך משתמש שסופר נקודות ידנית.
 *
 * המתאם מחלץ עובדות גולמיות (מי נכנס בדקה כמה, מתי נכנס שער).
 * החישוב קורה פעם אחת, כאן.
 */
import type { Position } from './types.ts';

/** חלון הימצאות על המגרש, בדקות משחק. */
export interface OnPitch {
  from: number;
  /** דקת יציאה. null = סיים את המשחק. */
  to: number | null;
}

/**
 * ספיגות בזמן שהיה על המגרש.
 *
 * ★ שער בדקה 45 לשחקן שהוחלף בדקה 45 — נספר.
 *   הגבול סגור משני הצדדים בכוונה: ספק שמדווח שער והחלפה
 *   באותה דקה אינו מבחין ביניהם, וחלוקה לטובת "לא ספג"
 *   הייתה נותנת שער נקי למי שהיה על המגרש כשספגו.
 */
export function concededWhileOn(window: OnPitch, opponentGoalMinutes: number[]): number {
  if (window.from < 0) return 0;
  const to = window.to ?? Number.POSITIVE_INFINITY;
  return opponentGoalMinutes.filter((m) => m >= window.from && m <= to).length;
}

/** דקות ששוחקו לפי החלון — גיבוי כשהספק לא מדווח. */
export function minutesFromWindow(window: OnPitch, fullTime = 90): number {
  const to = window.to ?? fullTime;
  return Math.max(0, Math.min(to, fullTime) - Math.max(0, window.from));
}

const POSITION_MAP: Record<string, Position> = {
  G: 'GK', GK: 'GK', GOALKEEPER: 'GK', 'שוער': 'GK',
  D: 'DEF', DF: 'DEF', DEF: 'DEF', DEFENDER: 'DEF', 'מגן': 'DEF',
  M: 'MID', MF: 'MID', MID: 'MID', MIDFIELDER: 'MID', 'קשר': 'MID',
  F: 'FWD', FW: 'FWD', FWD: 'FWD', A: 'FWD', ATT: 'FWD',
  FORWARD: 'FWD', STRIKER: 'FWD', 'חלוץ': 'FWD',
};

/**
 * עמדה.
 *
 * ★ מחזיר `null` ולא ניחוש. עמדה שגויה משנה את ערך השער
 *   (שוער 6 · חלוץ 4) ואת הבדיקה מול המערך — וזה נזק שקט.
 *   `null` פשוט אומר "אל תשתמש בעמדה כראיה במיפוי".
 */
export function toPosition(raw: unknown): Position | null {
  if (typeof raw !== 'string') return null;
  return POSITION_MAP[raw.trim().toUpperCase()] ?? null;
}

/** מספר חולצה — רק מספר שלם סביר. '' ו-0 אינם מספרי חולצה. */
export function toShirt(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
}

/** מספר לא שלילי, בלי NaN ובלי undefined שמחליק ל-0 בטעות. */
export function num(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** ISO-8601 מ-unix seconds. null נשאר null — שעה לא ממציאים. */
export function isoFromUnix(seconds: unknown): string | null {
  const n = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}
