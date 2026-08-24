/**
 * data/teamLogos.ts — סמלי המועדונים.
 *
 * ★ מקור אחד, זהה לאופסיידס
 *
 * הסמלים באים מאותה ספרייה מקומית שאופסיידס כבר משתמש בה
 * (`public/logos/<slug>.png`, בסיס luukhopman/football-logos).
 * זו הייתה דרישה מפורשת: לא לבנות מערכת סמלים שנייה.
 *
 * ★ מה קורה כשאין סמל
 *
 * שתי הקבוצות שעלו השנה (מכבי פ״ת, הפועל ר״ג) לא נמצאות בספרייה.
 * במקום לחפש תחליף באינטרנט או להשאיר ריבוע ריק, הן נופלות
 * לחולצה הגנרית של `Jersey` — שהיא ממילא בצבעי המועדון האמיתיים
 * ובטוחה משפטית. המשתמש רואה זהות קבוצתית תקינה בכל מקרה.
 *
 * ★ למה מיפוי מפורש ולא נירמול שם
 *
 * אופסיידס לומד את זה בדרך הקשה ומתעד את זה: "Hapoel Be'er Sheva"
 * מול "hapoel-beer-sheva" — עיצוב מחרוזות נשבר על גרשיים, על
 * תעתיקים, ועל "עולה חדשה" בסוגריים. טבלה מפורשת של 14 שורות
 * לא נשברת אף פעם.
 */

/** מזהה קבוצה → slug בספריית הסמלים. null = אין סמל, ליפול לחולצה. */
const LOGO_SLUG: Record<string, string | null> = {
  T1:  'hapoel-beer-sheva',
  T2:  'hapoel-jerusalem',
  T3:  'maccabi-tel-aviv',
  T4:  'maccabi-haifa',
  T5:  'beitar-jerusalem',
  T6:  'hapoel-tel-aviv',
  T7:  'maccabi-netanya',
  T8:  'ihud-bnei-sakhnin',
  T9:  'hapoel-haifa',
  T10: 'ironi-kiryat-shmona',
  T11: 'ironi-tiberias',
  T12: null,   // מכבי פתח תקווה — עולה חדשה, אין סמל בספרייה
  T13: null,   // הפועל רמת גן  — עולה חדשה, אין סמל בספרייה
  T14: 'hapoel-petah-tikva',
};

/** נתיב לסמל, או null אם אין. */
export function teamLogo(teamId: string): string | null {
  const slug = LOGO_SLUG[teamId];
  return slug ? `/logos/${slug}.png` : null;
}

export function hasLogo(teamId: string): boolean {
  return LOGO_SLUG[teamId] != null;
}

/** כמה מהקבוצות מכוסות. מוצג בדוח איכות הנתונים. */
export function logoCoverage(): { withLogo: number; total: number } {
  const all = Object.values(LOGO_SLUG);
  return { withLogo: all.filter(Boolean).length, total: all.length };
}
