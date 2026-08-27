/**
 * lib/formation.ts — פריסת המגרש.
 *
 * ★ הבאג שזה מתקן
 *
 * המגרש הקודם סידר שחקנים ברשת CSS: כל עמדה הייתה שורה, וכל
 * שורה הייתה `auto-fit minmax(84px, 1fr)`. התוצאה על מסך צר:
 * ארבעה מגנים נדחסים לשורה אחת שגולשת, הכרטיסים עולים זה על זה,
 * והמגרש "מרחף" כי גובהו נגזר מהתוכן ולא מיחס קבוע.
 *
 * ★ הפתרון
 *
 * המגרש הוא תיבה עם **יחס גובה-רוחב קבוע**, והשחקנים ממוקמים
 * בתוכה באחוזים. אחוזים הם רספונסיביים מעצם הגדרתם: אותה נוסחה
 * נכונה ב-320 פיקסלים וב-1440, בלי media query אחת.
 *
 *     x = (i + 0.5) / n × 100        ← מרכז המשבצת בשורה
 *     y = לפי מספר שורות ההתקפה/הגנה
 *
 * שני שחקנים לא יכולים לחפוף כי כל אחד מקבל בדיוק 1/n מהרוחב,
 * וגודל הכרטיס נגזר מ-n הגדול ביותר במערך. זו אריתמטיקה, לא כיול.
 *
 * ★ למה כאן ולא בקומפוננטה
 *
 * הפריסה נבדקת. `Pitch.tsx` רק מצייר את מה שהקובץ הזה מחשב, ולכן
 * אפשר לוודא ב-CI שאין חפיפה בכל מערך — בלי לפתוח דפדפן.
 */
import type { Position } from './scoring/types.ts';

export interface SlotPosition {
  /** אחוז מרוחב המגרש, 0–100. מרכז הכרטיס. */
  x: number;
  /** אחוז מגובה המגרש, 0–100. מרכז הכרטיס. */
  y: number;
  position: Position;
  /** אינדקס בתוך השורה, לייצוב מפתחות React. */
  indexInRow: number;
  rowSize: number;
}

export interface FormationLayout {
  formation: string;
  slots: SlotPosition[];
  /** השורה הצפופה ביותר. ממנה נגזר גודל הכרטיס. */
  maxRow: number;
  /** סך השחקנים כולל שוער. */
  size: number;
}

/* ------------------------------------------------------------------ */
/* גובה השורות                                                         */
/* ------------------------------------------------------------------ */

/**
 * ★ יחס המגרש — גובה חלקי רוחב.
 *
 * המגרש **חייב** להיות לאורך. זו לא העדפה אסתטית אלא אריתמטיקה:
 * הרכב של 4-2-3-1 הוא חמש שורות (שוער + ארבע), וכרטיס שחקן בגובה
 * ~57 פיקסלים דורש ~285 פיקסלים רק לשורות. במגרש לרוחב על מסך
 * של 296 פיקסלים יש 243 פיקסלים גובה — השורות פשוט לא נכנסות,
 * והשוער נדחף אל מחוץ לקו השער.
 *
 * 1.38 נותן 408 פיקסלים גובה על אותו מסך: מספיק לחמש שורות
 * ולנשימה ביניהן. זה גם המבט הנכון — מאחורי השער, כמו בכל
 * משחק פנטזי.
 */
export const PITCH_RATIO = 1.38;

/**
 * ★ יחס לפי מספר השורות.
 *
 * 4-2-3-1 הוא חמש שורות וצריך את כל הגובה. 2-1-1 הוא ארבע שורות
 * ובאותו יחס הוא נראה ריק — חצי מגרש דשא בלי אף שחקן.
 *
 * מגרש נמוך יותר לפורמט הקטן הוא גם נכון מבחינת המשחק: קט-רגל
 * מתנהל על מגרש קטן, וזה בדיוק הבידול שהברִיף ביקש בין המצבים.
 */
export function ratioForFormation(formation: string): number {
  const rows = parseFormation(formation);
  if (!rows) return PITCH_RATIO;
  return rows.length >= 4 ? PITCH_RATIO : 1.2;
}

/** השוער למטה, במרכז. 90 ולא 96 — לכרטיס יש חצי גובה מתחת למרכז. */
const GK_Y = 90;

/**
 * הגבולות שבין הם נפרשות שורות השדה.
 * 72 משאיר מרווח מהשוער; 14 משאיר מקום לכרטיס מעל קו ההתקפה.
 */
const FIELD_TOP = 14;
const FIELD_BOTTOM = 72;

/** גובה השורה ה-i מתוך n שורות שדה. */
function rowY(i: number, n: number): number {
  if (n <= 1) return (FIELD_TOP + FIELD_BOTTOM) / 2;
  // i=0 היא ההגנה (הכי נמוכה), i=n-1 היא ההתקפה (הכי גבוהה)
  const t = i / (n - 1);
  return FIELD_BOTTOM - t * (FIELD_BOTTOM - FIELD_TOP);
}

/**
 * מיקום אופקי של השחקן ה-i מתוך שורה של n.
 *
 * ★ הנוסחה מבטיחה אי-חפיפה: כל שחקן מקבל בדיוק 100/n אחוז,
 *   והוא ממוקם במרכז המשבצת שלו. כל עוד רוחב הכרטיס קטן
 *   מרוחב המשבצת — אין התנגשות. אף פעם.
 */
function colX(i: number, n: number): number {
  return ((i + 0.5) / n) * 100;
}

/* ------------------------------------------------------------------ */
/* פירוק מערך                                                          */
/* ------------------------------------------------------------------ */

/**
 * "4-3-3" → [4,3,3]. השוער לא מופיע במחרוזת, כמו בכדורגל אמיתי.
 * מחזיר null למערך לא תקין — הקורא מחליט מה לעשות, לא אנחנו.
 */
export function parseFormation(formation: string): number[] | null {
  const parts = formation.split('-').map((p) => Number(p.trim()));
  if (parts.length < 2 || parts.length > 5) return null;
  if (parts.some((p) => !Number.isInteger(p) || p < 1 || p > 6)) return null;
  return parts;
}

/**
 * לאיזו עמדה שייכת שורה מסוימת.
 *
 * שלוש שורות = הגנה/קישור/התקפה. ארבע שורות (4-2-3-1) = שתי
 * שורות קישור, כי "קשר אחורי" ו"קשר התקפי" הם שניהם MID לצורך
 * הניקוד. המנוע לא מכיר עמדות ביניים, ולכן גם הפריסה לא ממציאה.
 */
function positionForRow(rowIndex: number, rowCount: number): Position {
  if (rowIndex === 0) return 'DEF';
  if (rowIndex === rowCount - 1) return 'FWD';
  return 'MID';
}

/* ------------------------------------------------------------------ */

/**
 * הפריסה המלאה של מערך.
 * הסדר בפלט: שוער ראשון, ואז מהגנה להתקפה, ובכל שורה מימין לשמאל
 * (הצופה רואה RTL, אבל x הוא גאומטרי ולא תלוי כיוון).
 */
export function layoutFormation(formation: string): FormationLayout | null {
  const rows = parseFormation(formation);
  if (!rows) return null;

  const slots: SlotPosition[] = [
    { x: 50, y: GK_Y, position: 'GK', indexInRow: 0, rowSize: 1 },
  ];

  rows.forEach((count, rowIndex) => {
    const position = positionForRow(rowIndex, rows.length);
    const y = rowY(rowIndex, rows.length);
    for (let i = 0; i < count; i++) {
      slots.push({ x: colX(i, count), y, position, indexInRow: i, rowSize: count });
    }
  });

  return {
    formation,
    slots,
    maxRow: Math.max(...rows),
    size: rows.reduce((a, b) => a + b, 0) + 1,
  };
}

/**
 * ספירת עמדות שהמערך דורש — הקלט של ולידציית ההרכב.
 */
export function positionCounts(formation: string): Record<Position, number> | null {
  const layout = layoutFormation(formation);
  if (!layout) return null;
  const counts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const s of layout.slots) counts[s.position] += 1;
  return counts;
}

/* ------------------------------------------------------------------ */
/* גודל הכרטיס                                                         */
/* ------------------------------------------------------------------ */

/**
 * ★ רוחב הכרטיס בפיקסלים, לפי רוחב המגרש והשורה הצפופה ביותר.
 *
 * זו הפונקציה שמונעת את הבאג המקורי. במקום גודל קבוע שנשבר
 * במסכים צרים, הגודל **נגזר** מהמקום שבאמת קיים:
 *
 *     משבצת = רוחב המגרש / השורה הצפופה
 *     כרטיס = משבצת פחות מרווח נשימה
 *
 * החסם התחתון 44 הוא לא אסתטי אלא נגיש: יעד מגע קטן מזה
 * לא עומד בהנחיות ולא ניתן ללחיצה אמינה באגודל.
 */
/**
 * גובה כרטיס שחקן ביחס לרוחבו.
 * סמל (62% מהרוחב) + שורת שם + שורת מחיר + מרווחים.
 * משמש לבדיקת חפיפה אנכית — אותה נוסחה שה-CSS מייצר בפועל.
 */
export const CARD_ASPECT = 1.3;

export function cardHeight(width: number): number {
  return Math.round(width * CARD_ASPECT);
}

export const MIN_CARD = 44;
export const MAX_CARD = 76;
export const GUTTER_PX = 6;
const GUTTER = GUTTER_PX;


/**
 * ★ המרווח האנכי הצפוף ביותר שיכול להיווצר, באחוזי גובה.
 *
 * תמיד בין השוער לקו ההגנה (90 → 72). שורות השדה פרושות רחב
 * יותר. מחושב ולא מוקלד, כדי שעריכה של GK_Y לא תשבור את החישוב
 * בשקט.
 */
const MIN_ROW_GAP_PCT = Math.min(
  GK_Y - FIELD_BOTTOM,
  (FIELD_BOTTOM - FIELD_TOP) / 3,   // המקרה של ארבע שורות שדה
);

/**
 * החסם האנכי כמקדם של **רוחב** המגרש.
 *
 * ★ תלוי ביחס, ולכן תלוי במערך.
 *
 * באג שנתפס: כשהוספתי מגרש נמוך יותר למערכים קצרים, החסם נשאר
 * מחושב לפי `PITCH_RATIO` הקבוע. התוצאה — כרטיס גדול מדי למגרש
 * נמוך, והשוער שוב נדחף החוצה. הבדיקה תפסה את זה מיד.
 *
 * מבוטא כמקדם של **רוחב** כדי שאפשר יהיה להשתמש בו גם ב-CSS
 * (`100cqw × var(--vcap)`) בלי להכיר את הגובה.
 */
export function verticalCap(ratio: number): number {
  // ★ שולי ביטחון של 4%.
  //   `CARD_ASPECT` הוא הערכה של גובה הכרטיס, וגם העיגול שלו
  //   לפיקסלים שלמים יכול להוסיף שבר. בלי השוליים האלה חישוב
  //   "מדויק" גלש ב-0.06 פיקסל — וכרטיס נגע בשכן שלו.
  //   עדיף כרטיס קטן בפיקסל מאשר חפיפה.
  return (MIN_ROW_GAP_PCT / 100) * ratio / (CARD_ASPECT * 1.04);
}

/** נשמר לתאימות — החסם של המגרש המלא. */
export const VERTICAL_CAP = verticalCap(PITCH_RATIO);

/**
 * ★ רוחב הכרטיס נחסם משני כיוונים, לא רק אחד.
 *
 * הבאג שנתפס בבדיקה: חסימה אופקית בלבד נתנה כרטיס של 68 פיקסלים
 * במסך של 296, אבל המרווח האנכי בין השוער להגנה הוא 74 פיקסלים
 * בלבד — והכרטיס בגובה 88 דחף את השוער אל מחוץ לקו השער.
 *
 * לכן:
 *   אופקי — משבצת השורה פחות מרווח נשימה
 *   אנכי  — המרווח בין שתי שורות סמוכות, חלקי יחס הכרטיס
 * והקטן מביניהם מנצח.
 */
export function cardWidth(
  pitchWidth: number,
  maxRow: number,
  ratio: number = PITCH_RATIO,
): number {
  const byWidth = pitchWidth / maxRow - GUTTER;
  const byHeight = pitchWidth * verticalCap(ratio);
  return Math.max(MIN_CARD, Math.min(MAX_CARD, Math.floor(Math.min(byWidth, byHeight))));
}

/* ------------------------------------------------------------------ */
/* חלון התקציב המרחף                                                   */
/* ------------------------------------------------------------------ */

/**
 * ★ למה הגאומטריה של חלון התקציב יושבת **כאן**.
 *
 * החלון מרחף מעל המגרש בפינה התחתונה (בעברית — שמאלית). אם הוא
 * ייגע בכרטיס שחקן, הוא מסתיר את הבחירה שהמשתמש בדיוק עשה —
 * וזה בדיוק מה שקורה בשוער, שיושב במרכז התחתון.
 *
 * "בדקתי במסך שלי וזה נראה בסדר" אינו תשובה: רוחב המגרש נגזר
 * מהגובה הפנוי, שמשתנה עם גובה המכשיר, עם סרגל הכתובות של
 * הדפדפן, ועם כל מערך. הגבול הזה חייב להיות **אריתמטיקה**, כמו
 * חסם רוחב הכרטיס — ולכן הוא כאן, ליד שאר החישוב, עם בדיקה
 * שרצה על כל מערך בכל רוחב.
 *
 * המידות תואמות ל-`BudgetHud` ב-`components/SquadPicker.tsx`.
 * אם שורה כאן משתנה, גם שם — ויש בדיקה שמוודאת שהשתיים לא
 * נפרדות.
 */
/**
 * ★ המידות נגזרו מהאריתמטיקה, לא נבחרו לפי איך שזה נראה במסך אחד.
 *
 * חישוב על כל המערכים ובכל רוחב מגרש סביר הראה שהאזור הפנוי
 * בפינה התחתונה הוא **38% מרוחב המגרש** — ורק אם החלון נמוך
 * מספיק כדי לא להגיע לשורת השוער. חלון בגובה 74 פיקסלים נגע
 * בכרטיס השוער בכל מגרש צר מ-400 פיקסלים, כלומר כמעט בכל טלפון.
 *
 * לכן: גובה 48, שוליים 8, ורוחב `min(122px, 32cqw)` — 32% ולא
 * 38%, כדי להשאיר שוליים לעיגול פיקסלים ולגדילת טקסט.
 */
export const HUD_W_PX = 122;
/** הרוחב כשבר מרוחב המגרש. המחמיר מבין השניים מנצח. */
export const HUD_W_CQW = 0.32;
export const HUD_H = 48;
export const HUD_INSET = 8;

export function hudWidth(pitchWidth: number): number {
  return Math.min(HUD_W_PX, pitchWidth * HUD_W_CQW);
}

export interface Box { left: number; top: number; right: number; bottom: number }

/** תיבת החלון, בפיקסלים, ביחס לפינה השמאלית־עליונה של המגרש. */
export function hudBox(pitchWidth: number, pitchHeight: number): Box {
  return {
    left: HUD_INSET,
    right: HUD_INSET + hudWidth(pitchWidth),
    bottom: pitchHeight - HUD_INSET,
    top: pitchHeight - HUD_INSET - HUD_H,
  };
}

/** תיבות כל כרטיסי השחקנים, באותן יחידות. */
export function slotBoxes(
  formation: string, pitchWidth: number, ratio?: number,
): Box[] {
  const layout = layoutFormation(formation);
  if (!layout) return [];
  const r = ratio ?? ratioForFormation(formation);
  const pitchHeight = pitchWidth * r;
  const w = cardWidth(pitchWidth, layout.maxRow, r);
  const h = cardHeight(w);

  return layout.slots.map((s) => {
    const cx = (s.x / 100) * pitchWidth;
    const cy = (s.y / 100) * pitchHeight;
    return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
  });
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

export function hudCollides(formation: string, pitchWidth: number, ratio?: number): boolean {
  const r = ratio ?? ratioForFormation(formation);
  const hud = hudBox(pitchWidth, pitchWidth * r);
  return slotBoxes(formation, pitchWidth, r).some((b) => boxesOverlap(hud, b));
}

/**
 * הרוחב המינימלי שהמגרש חייב כדי שהמערך ייכנס בלי חפיפה.
 * אם המסך צר מזה — צריך להקטין את הכרטיס מתחת ל-44, וזה כבר
 * לא מצב שמותר להציג. הקורא יכול לגלול אופקית או לשנות מערך.
 */
export function minPitchWidth(maxRow: number): number {
  return maxRow * (MIN_CARD + GUTTER);
}

/* ------------------------------------------------------------------ */
/* המערכים שהמוצר מכיר                                                 */
/* ------------------------------------------------------------------ */

export interface FormationOption {
  id: string;
  /** תיאור קצר של האופי הטקטי. מופיע בבורר. */
  hintHe: string;
}

/** דוביד 11. */
export const FORMATIONS_11: readonly FormationOption[] = [
  { id: '4-3-3',   hintHe: 'מאוזן והתקפי' },
  { id: '4-4-2',   hintHe: 'קלאסי' },
  { id: '3-5-2',   hintHe: 'שליטה בקישור' },
  { id: '4-2-3-1', hintHe: 'קשר אחורי כפול' },
  { id: '5-3-2',   hintHe: 'הגנתי' },
  { id: '3-4-3',   hintHe: 'התקפי' },
];

/**
 * דוביד 5.
 * ★ הברִיף: "אל תתייחס ל-5×5 כאל גרסה קטנה של 11".
 *   שני המערכים כאן הם שתי פילוסופיות שונות ולא שתי וריאציות:
 *   2-1-1 קונה יציבות בהגנה, 1-2-1 קונה נוכחות בקישור.
 */
export const FORMATIONS_5: readonly FormationOption[] = [
  { id: '2-1-1', hintHe: 'בסיס הגנתי' },
  { id: '1-2-1', hintHe: 'שליטה בקישור' },
];

export function formationsFor(size: number): readonly FormationOption[] {
  return size <= 5 ? FORMATIONS_5 : FORMATIONS_11;
}
