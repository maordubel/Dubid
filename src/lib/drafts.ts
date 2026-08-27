/**
 * lib/drafts.ts — הטיוטה יושבת בשרת.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה השתנה, ולמה זה לא "עוד תכונה"
 * ═══════════════════════════════════════════════════════════════
 *
 * הטיוטה — ההרכב שבבנייה, לפני שלוחצים "הגש" — חיה ב-
 * `localStorage`. משמעות מעשית:
 *
 *   · מי שהתחיל בטלפון והמשיך במחשב התחיל מאפס.
 *   · מי שניקה דפדפן איבד את העבודה.
 *   · גלישה פרטית = הטיוטה נעלמת עם סגירת הטאב.
 *
 * זו לא הייתה בעיה כשהכל היה מקומי. ברגע שהזהות היא של אדם ולא
 * של דפדפן, טיוטה שנשארת על מכשיר אחד היא סתירה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הטיוטה **אינה** ההגשה, ולכן היא לא בטבלה של ההגשות
 * ═══════════════════════════════════════════════════════════════
 *
 * `game.lineup_drafts` היא טבלה נפרדת (ראו `db/13` §5). הפיתוי
 * היה לשמור טיוטה ב-`game.user_lineups` עם `status='draft'` —
 * ושם יש `UNIQUE (user_id, gameweek_id, mode)`, כלומר כל הקלדה
 * בטיוטה הייתה מורידה הגשה חתומה חזרה ל-'draft'.
 *
 * ★ טיוטה גם לא נאכפת. אין בה בדיקת תקציב, אין "שחקן אחד מכל
 *   קבוצה", ואין קפטן חובה — כי היא באמצע עריכה. **כל אילוץ
 *   תחרותי נאכף ב-`submit_entry`, ורק שם.**
 */
import { supabase } from './supabase.ts';
import { toWire, fromWire, type Mode, type WireDraft } from './draftWire.ts';
import type { Lineup } from './scoring/types.ts';

export type { Mode };

/* ================================================================== */
/* קריאה וכתיבה                                                        */
/* ================================================================== */

export type DraftLoad = 'ok' | 'error';

/** הגלם האחרון שחזר, לפי (משתמש, מחזור). פרט פנימי של המודול. */
const rawCache = new Map<string, Record<string, WireDraft>>();

/**
 * שתי הטיוטות של המחזור, בקריאה אחת.
 *
 * ★ קריאה אחת ולא אחת למצב: המשתמש מגיע ללובי ושני הכרטיסים
 *   צריכים להראות "טיוטה · 7/11" מיד. שתי קריאות היו נותנות שני
 *   מצבי טעינה על אותו מסך.
 *
 * ★★ מחזירה `'error'` ולא `{}` — וזה כל ההבדל. ★★
 *
 * קודם כל כישלון נבלע והוחזר `{}`, כלומר "אין טיוטה". הקורא
 * (`useLineup`) סימן `loaded = true` והתחיל לשמור — ולכן תקלת
 * רשת חולפת במחשב **מחקה את הטיוטה שנבנתה בטלפון**: המסך הראה
 * הרכב ריק, המשתמש נגע במשבצת אחת, והשמירה דרסה אחת־עשרה
 * בחירות באחת.
 *
 * "אין טיוטה" ו"לא הצלחתי לקרוא" נראים אותו דבר על המסך, והם
 * הפוכים לחלוטין במה שמותר לעשות אחריהם.
 */
export async function fetchDrafts(userId: string, gameweekId: string): Promise<DraftLoad> {
  const key = cacheKey(userId, gameweekId);
  try {
    const { data, error } = await supabase.rpc('my_drafts', { p_gw_code: gameweekId });
    if (error) return 'error';

    /* ★ הצלחה מנקה קודם. תשובה ריקה **היא** תשובה: המשתמש מחק
       את הטיוטה, ואסור שהערך הישן ישרוד במטמון. */
    rawCache.set(key, (data ?? {}) as Record<string, WireDraft>);
    return 'ok';
  } catch {
    return 'error';
  }
}

/**
 * ★ המפתח כולל את המשתמש, ולא רק את המחזור.
 *
 * בלי זה: אורח בנה טיוטה, המטמון החזיק אותה תחת `'gw-3'`, ואז
 * הוא נכנס לחשבון. הקריאה החדשה נכשלה — והשחזור הגיש לו את
 * הטיוטה של **הזהות הקודמת**, שנשמרה אחר כך לחשבון החדש.
 */
function cacheKey(userId: string, gameweekId: string): string {
  return `${userId || 'anon'}|${gameweekId}`;
}

/**
 * המערך שנשמר בטיוטה, או `null`.
 *
 * ★ נקרא **לפני** `draftInto`, ובכוונה.
 *
 * `draftInto` מזריק שחקנים לתוך משבצות של הרכב ריק קיים. אם
 * המשתמש שמר 3-5-2 במכשיר אחר וההרכב הריק נבנה כ-4-3-3, יש
 * במבנה משבצת מגן שאין לה שחקן ומשבצת קשר שנופלת בחוץ — כלומר
 * טיוטה שחוזרת מעוותת. לכן קודם שואלים מה המערך, ואז בונים.
 */
export function draftFormation(userId: string, gameweekId: string, mode: Mode): string | null {
  return rawCache.get(cacheKey(userId, gameweekId))?.[mode]?.formation ?? null;
}

/**
 * ההרכב המשוחזר, או `null` אם אין טיוטה שמורה.
 * חייב להיקרא אחרי `fetchDrafts` לאותו מחזור.
 */
export function draftInto(
  base: Lineup, userId: string, gameweekId: string, mode: Mode,
): Lineup | null {
  const raw = rawCache.get(cacheKey(userId, gameweekId))?.[mode];
  if (!raw) return null;
  return fromWire(base, raw);
}

/**
 * שמירה. נקראת בהשהיה מהמסך.
 *
 * ★ כישלון **שקט**, ובכוונה.
 *
 * המשתמש באמצע בניית הרכב. הודעת שגיאה על כל תו שהוקלד ברשת
 * גרועה הופכת את המסך לבלתי שמיש, והטיוטה ממילא חיה בזיכרון
 * הדף ותישמר בניסיון הבא. **ההגשה**, לעומת זאת, לעולם לא
 * נכשלת בשקט — היא זו שנספרת.
 */
export async function pushDraft(gameweekId: string, mode: Mode, lineup: Lineup): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('save_draft', {
      p_gw_code: gameweekId,
      p_mode: mode,
      p_formation: lineup.formation,
      p_slots: toWire(lineup),
    });
    return !error;
  } catch {
    return false;
  }
}

export async function dropDraft(
  userId: string, gameweekId: string, mode: Mode,
): Promise<void> {
  try {
    await supabase.rpc('discard_draft', { p_gw_code: gameweekId, p_mode: mode });
    const raw = rawCache.get(cacheKey(userId, gameweekId));
    if (raw) delete raw[mode];
  } catch {
    /* מחיקה שנכשלה תידרס בשמירה הבאה */
  }
}
