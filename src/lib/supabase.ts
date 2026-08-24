/**
 * lib/supabase.ts — הלקוח של דוביד.
 *
 * ★ שני דברים קריטיים בקובץ הזה
 *
 * 1. **אין מפתחות בקוד.** הכל מגיע מ-`import.meta.env`. גם המפתח
 *    ה"פומבי" — לא כי הוא סוד (הוא לא), אלא כדי שסביבת בדיקה
 *    וסביבת ייצור לא יצביעו לאותו מסד בטעות.
 *
 * 2. **`db.schema = 'game'`.** דוביד ואופסיידס חולקים פרויקט
 *    Supabase אחד. אופסיידס יושב על `public`, שהוא ברירת המחדל
 *    של PostgREST. בלי השורה הזו, שאילתה של דוביד בלי `.schema()`
 *    מפורשת הייתה פוגעת בטבלאות של אופסיידס.
 *
 *        game.*   → דוביד      (ברירת מחדל כאן)
 *        core.*   → משותף      (קבוצות, שחקנים, משחקים, אירועים)
 *        public.* → אופסיידס   (לא נגישה מכאן בלי בקשה מפורשת)
 *
 * ראו `docs/SUPABASE-SETUP.md`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * ★ האפליקציה לא מתרסקת בלי הגדרות.
 *
 * עד שהמסד מחובר, דוביד עובד מול localStorage. `supabase` יהיה
 * `null`, וכל קורא חייב לבדוק. זה מכוון: מעבר לענן הוא הדרגתי,
 * ומסך לבן בגלל משתנה סביבה חסר הוא הדרך הגרועה לגלות את זה.
 */
export const supabase: SupabaseClient | null =
  URL && KEY
    ? createClient(URL, KEY, {
        db: { schema: 'game' },
        auth: { persistSession: true, autoRefreshToken: true },
        global: { headers: { 'x-client-info': 'dubid-web' } },
      })
    : null;

export const isSupabaseConfigured = supabase !== null;

/**
 * דאטת כדורגל משותפת — סכימת `core`, מבוקשת במפורש.
 *
 * הבקשה המפורשת היא תכונה ולא טרחה: כל קריאה לשכבה המשותפת
 * גלויה בקוד, ולכן קל לראות מי נוגע במה כששני מוצרים חולקים מסד.
 */
export function coreTable(name: string) {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  return supabase.schema('core').from(name);
}

/** פרסים חוצי-אפליקציות — סכימת `shared`. */
export function sharedTable(name: string) {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  return supabase.schema('shared').from(name);
}

/**
 * שעון השרת, ל-`serverTime.ts`.
 * נופל בשקט לשעון המכשיר כשאין חיבור — בדיוק כמו שהמודול מצפה.
 */
export async function fetchServerTime(): Promise<number> {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  const { data, error } = await supabase.rpc('server_now');
  if (error || data == null) throw error ?? new Error('no server time');
  return Number(data);
}
