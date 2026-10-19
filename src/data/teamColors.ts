/**
 * data/teamColors.ts — ערכות הצבע של מועדוני ליגת העל, הסופר ליג היוונית, הפרמיירליג ולה ליגה.
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

  /* ───────── הסופר ליג היוונית ─────────
     מזהי הקבוצות = T + מזהה ספק הסגלים (db/41). הצבעים לפי זהות המועדון
     (לא ערכות רשמיות). ★ זמני עד אימות מול ערכות 2026/27: Levadiakos,
     Panetolikos, Kifisia, Volos, Atromitos. */
  // פנתינייקוס — ירוק, שוליים לבנים
  T30200:  { primary: '#00843D', secondary: '#00843D', trim: W, pattern: 'plain' },
  // אולימפיאקוס — פסים אנכיים אדום-לבן
  T28638:  { primary: '#E4032E', secondary: W,         trim: W, pattern: 'stripes' },
  // איי אי קיי — צהוב, שוליים שחורים
  T28563:  { primary: '#FFD100', secondary: '#FFD100', trim: K, pattern: 'plain' },
  // פאוק — פסים שחור-לבן
  T28619:  { primary: '#F2F2F2', secondary: K,         trim: K, pattern: 'stripes' },
  // אריס — צהוב, שוליים שחורים
  T28239:  { primary: '#F7D117', secondary: '#F7D117', trim: K, pattern: 'plain' },
  // אסטראס אקטור — צהוב, שרוולים כחולים
  T100654: { primary: '#F2C800', secondary: '#1B3C8C', trim: '#1B3C8C', pattern: 'sleeves' },
  // אטרומיטוס — כחול כהה, שוליים לבנים
  T30187:  { primary: '#1B3A8A', secondary: '#1B3A8A', trim: W, pattern: 'plain' },
  // אוֹ.אֶף.אִי — לבן, שוליים שחורים
  T27753:  { primary: '#F4F4F4', secondary: '#F4F4F4', trim: K, pattern: 'plain' },
  // איראקליס — תכלת-לבן
  T28675:  { primary: '#2A7BD6', secondary: '#2A7BD6', trim: W, pattern: 'plain' },
  // לבדיאקוס — פסים שחור-אדום
  T24493:  { primary: '#1A1A1A', secondary: '#C8102E', trim: W, pattern: 'stripes' },
  // קלמטה — פסים כחול-לבן
  T21585:  { primary: '#F4F4F4', secondary: '#1B4FA0', trim: '#1B4FA0', pattern: 'stripes' },
  // פנאיטוליקוס — כחול, שוליים צהובים
  T182386: { primary: '#1C4E9C', secondary: '#1C4E9C', trim: '#F5C518', pattern: 'plain' },
  // קיפיסיה — אדום כהה, שוליים לבנים
  T508099: { primary: '#B3122B', secondary: '#B3122B', trim: W, pattern: 'plain' },
  // וולוס — כחול, שוליים אדומים
  T905256: { primary: '#183F8F', secondary: '#183F8F', trim: '#D0103A', pattern: 'plain' },

  /* ───────── פרמיירליג 2026/27 ─────────
     מזהה = T + (20000 + FotMob). צבעי זהות המועדון, לא ערכות רשמיות. */
  T28678: { primary: '#D0102A', secondary: K,         trim: K, pattern: 'stripes' },   // בורנמות'
  T29825: { primary: '#EF0107', secondary: W,         trim: W, pattern: 'sleeves' },   // ארסנל
  T30252: { primary: '#7B003C', secondary: '#95BFE5', trim: '#95BFE5', pattern: 'sleeves' }, // אסטון וילה
  T29937: { primary: '#E30613', secondary: W,         trim: K, pattern: 'stripes' },   // ברנטפורד
  T30204: { primary: '#0057B8', secondary: W,         trim: W, pattern: 'stripes' },   // ברייטון
  T28455: { primary: '#034694', secondary: '#034694', trim: W, pattern: 'plain' },     // צ'לסי
  T28669: { primary: '#59B5E8', secondary: '#59B5E8', trim: W, pattern: 'plain' },     // קובנטרי
  T29826: { primary: '#1B458F', secondary: '#C4122E', trim: '#C4122E', pattern: 'stripes' }, // קריסטל פאלאס
  T28668: { primary: '#003399', secondary: '#003399', trim: W, pattern: 'plain' },     // אברטון
  T29879: { primary: '#F4F4F4', secondary: '#F4F4F4', trim: K, pattern: 'plain' },     // פולהאם
  T28667: { primary: '#F5A12D', secondary: K,         trim: K, pattern: 'stripes' },   // האל סיטי
  T29902: { primary: '#0044AA', secondary: '#0044AA', trim: W, pattern: 'plain' },     // איפסוויץ'
  T28463: { primary: '#F4F4F4', secondary: '#F4F4F4', trim: '#1D428A', pattern: 'plain' }, // לידס
  T28650: { primary: '#C8102E', secondary: '#C8102E', trim: W, pattern: 'plain' },     // ליברפול
  T28456: { primary: '#6CABDD', secondary: '#6CABDD', trim: W, pattern: 'plain' },     // מנצ'סטר סיטי
  T30260: { primary: '#DA291C', secondary: '#DA291C', trim: W, pattern: 'plain' },     // מנצ'סטר יונייטד
  T30261: { primary: '#F2F2F2', secondary: K,         trim: K, pattern: 'stripes' },   // ניוקאסל
  T30203: { primary: '#DD0000', secondary: '#DD0000', trim: W, pattern: 'plain' },     // נוטינגהאם פורסט
  T28472: { primary: '#EB172B', secondary: W,         trim: K, pattern: 'stripes' },   // סנדרלנד
  T28586: { primary: '#F4F4F4', secondary: '#F4F4F4', trim: '#132257', pattern: 'plain' }, // טוטנהאם

  /* ───────── לה ליגה 2026/27 ───────── */
  T28634: { primary: '#A50044', secondary: '#004D98', trim: '#EDBB00', pattern: 'stripes' }, // ברצלונה
  T29906: { primary: '#CB3524', secondary: W,         trim: '#272E61', pattern: 'stripes' }, // אתלטיקו מדריד
  T28633: { primary: '#F4F4F4', secondary: '#F4F4F4', trim: '#C9A24A', pattern: 'plain' },   // ריאל מדריד
  T28603: { primary: '#0BB363', secondary: W,         trim: W, pattern: 'stripes' },   // ריאל בטיס
  T28560: { primary: '#0067B1', secondary: W,         trim: W, pattern: 'stripes' },   // ריאל סוסיאדד
  T28302: { primary: '#F4F4F4', secondary: '#F4F4F4', trim: '#D4021D', pattern: 'plain' }, // סביליה
  T29866: { primary: '#0761AF', secondary: W,         trim: W, pattern: 'stripes' },   // אלאבס
  T29910: { primary: '#8AC3EE', secondary: '#8AC3EE', trim: '#E5254F', pattern: 'plain' }, // סלטה ויגו
  T29783: { primary: '#005CA9', secondary: W,         trim: W, pattern: 'stripes' },   // דפורטיבו
  T28371: { primary: '#D91A21', secondary: '#D91A21', trim: '#0A346F', pattern: 'plain' }, // אוסאסונה
  T28315: { primary: '#EE2523', secondary: W,         trim: K, pattern: 'stripes' },   // אתלטיק בילבאו
  T30205: { primary: '#FBE122', secondary: '#FBE122', trim: '#005187', pattern: 'plain' }, // ויאריאל
  T28558: { primary: '#007FC8', secondary: W,         trim: W, pattern: 'stripes' },   // אספניול
  T28370: { primary: '#F4F4F4', secondary: '#E53027', trim: '#E53027', pattern: 'sash' },  // ראיו ואייקאנו
  T28305: { primary: '#005999', secondary: '#005999', trim: W, pattern: 'plain' },     // חטאפה
  T28696: { primary: '#00A050', secondary: '#00A050', trim: W, pattern: 'plain' },     // ראסינג סנטאנדר
  T28581: { primary: '#B8132D', secondary: '#1D3F8C', trim: W, pattern: 'stripes' },   // לבאנטה
  T30268: { primary: '#F4F4F4', secondary: '#00753B', trim: '#00753B', pattern: 'sash' }, // אלצ'ה
  T30267: { primary: '#F4F4F4', secondary: '#F4F4F4', trim: '#F29F05', pattern: 'plain' }, // ולנסיה
  T29864: { primary: '#2F7DC0', secondary: W,         trim: W, pattern: 'stripes' },   // מלגה
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
