/**
 * data/teamColors.ts — ערכות הצבע של מועדוני ליגת העל.
 *
 * ★ למה זה חשוב מספיק בשביל קובץ משלו
 *
 * במשחק פנטזי המשתמש לא קורא שמות — הוא סורק צבעים. חולצה צהובה
 * ושחורה היא בית"ר לפני שהעין הגיעה לטקסט. ערכה שגויה לא "פחות
 * יפה", היא שקר קטן שמאט כל בחירה.
 *
 * המקור: טבלת צבעי המועדונים של RSSSF + ארכיון הערכות. אלה **לא**
 * ערכות רשמיות מועתקות ולא לוגואים — רק זהות הצבע והתבנית, ברוח
 * המועדון, בשפה הגרפית שלנו.
 *
 * ★ `ink` לא נכתב ביד
 *
 * צבע הטקסט על החולצה מחושב מהבהירות של `primary`. חולצה צהובה
 * מקבלת דיו כהה, חולצה כחולה מקבלת דיו בהיר — אוטומטית. כך אי אפשר
 * להוסיף קבוצה חדשה ולקבל בטעות טקסט לבן על צהוב.
 */

/** תבנית הערכה. משפיעה על הרינדור ב-`Jersey`, לא רק על צבע. */
export type KitPattern =
  | 'plain'    // חולצה אחידה
  | 'stripes'  // פסים אנכיים
  | 'sleeves'  // גוף בצבע אחד, שרוולים באחר
  | 'sash';    // אלכסון על החזה

export interface TeamKit {
  /** גוף החולצה. */
  primary: string;
  /** פסים / שרוולים / אלכסון — לפי `pattern`. */
  secondary: string;
  /** צווארון ומחשופי שרוול. */
  trim: string;
  pattern: KitPattern;
}

/** מה שהקוד צורך בפועל — כולל הדיו המחושב. */
export interface TeamColor extends TeamKit {
  /** צבע טקסט קריא על `primary`. מחושב, לא מוקלד. */
  ink: string;
}

const W = '#FFFFFF';
const K = '#111111';

/**
 * הערכות. `secondary` שווה ל-`primary` בערכה אחידה — כך `Jersey`
 * לא צריך תנאי מיוחד ל-plain.
 */
const KITS: Record<string, TeamKit> = {
  // אדום עם שוליים לבנים
  T1:  { primary: '#E1121C', secondary: '#E1121C', trim: W, pattern: 'plain' },
  // לבן ושחור, פסים אנכיים
  T2:  { primary: '#F2F2F2', secondary: K,         trim: K, pattern: 'stripes' },
  // צהוב עם שוליים כחולים
  T3:  { primary: '#FFDD00', secondary: '#FFDD00', trim: '#0B3D91', pattern: 'plain' },
  // ירוק עם שוליים לבנים
  T4:  { primary: '#00693E', secondary: '#00693E', trim: W, pattern: 'plain' },
  // צהוב עם שוליים שחורים
  T5:  { primary: '#FFD100', secondary: '#FFD100', trim: K, pattern: 'plain' },
  // אדום עם שוליים לבנים
  T6:  { primary: '#E4032E', secondary: '#E4032E', trim: W, pattern: 'plain' },
  // צהוב, שרוולים לבנים
  T7:  { primary: '#F5C518', secondary: W,         trim: K, pattern: 'sleeves' },
  // לבן עם שוליים אדומים
  T8:  { primary: '#F4F4F4', secondary: '#F4F4F4', trim: '#D0103A', pattern: 'plain' },
  // שחור ואדום, פסים אנכיים
  T9:  { primary: '#1A1A1A', secondary: '#C8102E', trim: W, pattern: 'stripes' },
  // כחול עם שוליים לבנים
  T10: { primary: '#1C4E9C', secondary: '#1C4E9C', trim: W, pattern: 'plain' },
  // כחול ולבן
  T11: { primary: '#1B65B3', secondary: '#1B65B3', trim: W, pattern: 'plain' },
  // תכלת עם שוליים לבנים
  T12: { primary: '#4FA3DC', secondary: '#4FA3DC', trim: W, pattern: 'plain' },
  // אדום עם שוליים שחורים
  T13: { primary: '#C8102E', secondary: '#C8102E', trim: K, pattern: 'plain' },
  // לבן, שרוולים כחולים
  T14: { primary: '#F4F4F4', secondary: '#1C4E9C', trim: '#1C4E9C', pattern: 'sleeves' },
};

const DEFAULT_KIT: TeamKit = {
  primary: '#3A3F4B', secondary: '#3A3F4B', trim: '#C9CDD6', pattern: 'plain',
};

/* =================================================================== */
/* ניגודיות                                                            */
/* =================================================================== */

/** בהירות יחסית לפי sRGB (WCAG 2.1). 0 = שחור, 1 = לבן. */
export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const channel = (i: number) => {
    const v = parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** שני הדיו האפשריים. אין שלישי — עקביות חשובה מדיוק. */
export const INK_DARK = '#14120F';
export const INK_LIGHT = '#FFFFFF';

/**
 * דיו קריא על רקע נתון.
 *
 * ★ בוחרים לפי ניגודיות בפועל, לא לפי סף בהירות שרירותי.
 *   סף קבוע נכשל בדיוק על הצבעים הבינוניים — תכלת של מכבי פ״ת נפל
 *   ל-2.8:1 מול לבן, מתחת לכל תקן. השוואה ישירה לא יכולה להיכשל ככה.
 */
export function inkOn(background: string): string {
  return contrastRatio(background, INK_DARK) >= contrastRatio(background, INK_LIGHT)
    ? INK_DARK
    : INK_LIGHT;
}

/** יחס ניגודיות בין שני צבעים. 4.5 ומעלה = תקין לטקסט רגיל. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* =================================================================== */

export function teamColor(teamId: string): TeamColor {
  const kit = KITS[teamId] ?? DEFAULT_KIT;
  return { ...kit, ink: inkOn(kit.primary) };
}

/** ערכת השוער — תמיד שונה מכל ערכת שדה, כמו במגרש אמיתי. */
export const GK_KIT: TeamColor = {
  primary: '#2B2F38', secondary: '#2B2F38', trim: '#E8B23B',
  pattern: 'plain', ink: '#FFFFFF',
};

export const TEAM_COLORS = KITS;
export const DEFAULT_TEAM_COLOR: TeamColor = { ...DEFAULT_KIT, ink: inkOn(DEFAULT_KIT.primary) };
