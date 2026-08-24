/**
 * lib/supabase.ts — שני הפרויקטים.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ מה השתנה, ולמה זה חשוב לקרוא לפני שנוגעים
 * ═══════════════════════════════════════════════════════════════
 *
 * עד הסבב הזה התכנון היה **פרויקט Supabase אחד** לשני המוצרים:
 * דוביד ב-`game`, אופסיידס ב-`public`, `auth.users` משותף.
 *
 * ההחלטה השתנתה: לכל מוצר פרויקט משלו.
 *
 *      DUBID     afxpjfxwpdjvlmuoawda   eu-central-1
 *      OFFSIDES  pqdzqpettxuuyngxbpxn   eu-west-1
 *
 * זו החלטה טובה — אופסיידס חי, יש לו משתמשים אמיתיים, גיבויים
 * ותצורה. גרירה שלו למסד חדש בשביל נוחות ארכיטקטונית היא בדיוק
 * הסוג של סיכון שאסור לקחת על מוצר שרץ.
 *
 * ★ המחיר, ואיך משלמים אותו
 *
 * שני פרויקטים = **שני `auth.users` נפרדים**. אין "אותו משתמש"
 * ברמת המסד, ואי אפשר להעמיד פנים שיש. לכן הזהות המשותפת נבנית
 * בשכבה מעל:
 *
 *      אופסיידס = ספק הזהות.
 *      דוביד    = מחזיק מיפוי, ומנפיק סשן משלו.
 *
 * המימוש ב-`lib/identity.ts`. כאן רק הלקוחות.
 *
 * ★ מה **אסור**
 *
 * אסור לקרוא לטבלאות של אופסיידס מהדפדפן דרך `offsidesClient`,
 * חוץ מ-`auth`. הגבול בין המוצרים עובר בשרת (Edge Function עם
 * מפתח service), לא בקליינט. לקוח שקורא ישירות לשני מסדים הוא
 * לקוח שאפשר לשכנע לכתוב לאחד מהם.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/* ------------------------------------------------------------------ */
/* תצורה                                                               */
/* ------------------------------------------------------------------ */

/**
 * ★ למה יש כאן ערכי ברירת מחדל, למרות שקודם לא היו.
 *
 * הנימוק המקורי היה נכון: משתני סביבה מונעים מסביבת בדיקה ומסביבת
 * ייצור להצביע בטעות לאותו מסד. אבל הוא הניח שקיימות שתי סביבות.
 * בפועל יש אחת, והמחיר של ההנחה היה שהאפליקציה נפלה בשקט
 * ל-localStorage בכל מכשיר שבו מישהו שכח להגדיר משתנה — כלומר
 * "עבד אצלי" ולא עבד באמת.
 *
 * המפתחות כאן הם **publishable**. הם נשלחים לדפדפן של כל משתמש
 * ממילא, בכל אפליקציית Supabase שקיימת. מה שמגן על הדאטה זה RLS,
 * לא סודיות המפתח. מפתח `service_role` לעולם לא יופיע בקובץ הזה
 * ולא בשום קובץ תחת `src/`.
 *
 * משתנה סביבה עדיין מנצח, כדי שסביבת staging תוכל להצביע למקום אחר.
 */
const DEFAULTS = {
  dubid: {
    url: 'https://afxpjfxwpdjvlmuoawda.supabase.co',
    key: 'sb_publishable_0p3GNCau1Qlcw5jE1pHwqg_btD7458V',
  },
  offsides: {
    url: 'https://pqdzqpettxuuyngxbpxn.supabase.co',
    key: 'sb_publishable_1_YcFqw8irBbV_GhACgX2w_gWMy3SZ1',
  },
} as const;

function env(name: string): string | undefined {
  const v = (import.meta.env as Record<string, string | undefined>)[name];
  return v && v.length > 0 ? v : undefined;
}

export const DUBID_PROJECT = {
  url: env('VITE_SUPABASE_URL') ?? DEFAULTS.dubid.url,
  key: env('VITE_SUPABASE_PUBLISHABLE_KEY') ?? DEFAULTS.dubid.key,
};

export const OFFSIDES_PROJECT = {
  url: env('VITE_OFFSIDES_SUPABASE_URL') ?? DEFAULTS.offsides.url,
  key: env('VITE_OFFSIDES_PUBLISHABLE_KEY') ?? DEFAULTS.offsides.key,
};

/* ------------------------------------------------------------------ */
/* הלקוח של דוביד                                                      */
/* ------------------------------------------------------------------ */

/**
 * `db.schema = 'game'` נשאר, למרות שאין יותר שכן ב-`public`.
 *
 * לא מטעמי בידוד — מטעמי כוונה. שאילתה בלי `.schema()` צריכה
 * לפגוע בטבלאות המשחק, ולא בכל מה שמישהו יצור ב-`public` מחר.
 */
export const supabase: SupabaseClient = createClient(DUBID_PROJECT.url, DUBID_PROJECT.key, {
  db: { schema: 'game' },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'dubid.auth.v1',
  },
  global: { headers: { 'x-client-info': 'dubid-web' } },
});

/** תמיד מוגדר עכשיו. נשמר כדי שקוד קיים שבודק את הדגל לא יישבר. */
export const isSupabaseConfigured = true;

/**
 * דאטת כדורגל — סכימת `core`, מבוקשת במפורש.
 *
 * הבקשה המפורשת היא תכונה ולא טרחה: כל קריאה לשכבה המשותפת גלויה
 * בקוד, ולכן קל לראות מי נוגע במה.
 */
export function coreTable(name: string) {
  return supabase.schema('core').from(name);
}

/** פרסים חוצי-אפליקציות — סכימת `shared`. */
export function sharedTable(name: string) {
  return supabase.schema('shared').from(name);
}

/* ------------------------------------------------------------------ */
/* הלקוח של אופסיידס — אימות בלבד                                      */
/* ------------------------------------------------------------------ */

/**
 * ★ `storageKey` שונה, ו-`persistSession: false`.
 *
 * שני לקוחות שחולקים מפתח אחסון דורסים זה את הסשן של זה, והסימפטום
 * הוא "התנתקתי לבד" אקראי שקשה מאוד לשחזר. שם נפרד הוא שורה אחת
 * שמונעת את כל מחלקת הבאגים הזו.
 *
 * `persistSession: false` הוא החלטה נפרדת: דוביד לא **מחזיק** סשן
 * של אופסיידס. הוא משתמש בו לרגע אחד — לאמת שהמשתמש הוא מי שהוא
 * טוען — ומיד מחליף אותו בסשן משלו.
 */
export const offsidesAuthClient: SupabaseClient = createClient(
  OFFSIDES_PROJECT.url,
  OFFSIDES_PROJECT.key,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'dubid.offsides-auth.v1',
    },
    global: { headers: { 'x-client-info': 'dubid-web/offsides-link' } },
  },
);

/* ------------------------------------------------------------------ */
/* שעון השרת                                                           */
/* ------------------------------------------------------------------ */

/**
 * ★ אל תשנו את טיפוס ההחזרה של `public.server_now()`.
 *
 * היא מחזירה `BIGINT` — אלפיות שנייה מאז ה-epoch. `serverTime.ts`
 * עושה `Number(data)`. אם מישהו יחליף אותה ל-`TIMESTAMPTZ`,
 * `Number("2026-08-24 12:00:00+00")` הוא **NaN**, השעון יישאר על
 * היסט 0 בלי אף שגיאה, וכל ספירה לאחור תזוז לפי שעון המכשיר של
 * המשתמש. באג שקט שהורס נעילה.
 */
export async function fetchServerTime(): Promise<number> {
  const { data, error } = await supabase.rpc('server_now');
  if (error || data == null) throw error ?? new Error('no server time');
  return Number(data);
}
