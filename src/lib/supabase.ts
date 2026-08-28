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

/**
 * ★ `import.meta.env` לא קיים מחוץ ל-Vite.
 *
 * הבדיקות רצות ב-`node --experimental-strip-types`, בלי bundler.
 * גישה ישירה ל-`import.meta.env.X` שם זורקת, וכל קובץ שמייבא
 * את המודול הזה — כולל `store.ts` — נופל בטעינה. הבדיקה שנפלה
 * על זה (`purge.test.ts`) לא בודקת Supabase בכלל; היא רק ייבאה
 * את `store`.
 *
 * `?? {}` הוא כל התיקון: מחוץ ל-Vite פשוט אין משתני סביבה,
 * ונופלים לברירות המחדל.
 */
function env(name: string): string | undefined {
  const bag = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const v = bag[name];
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
/* איזו סביבה זו בעצם                                                  */
/* ------------------------------------------------------------------ */

/**
 * ★★ הבעיה האמיתית בהיעדר staging ★★
 *
 * המפתחות כאן הם publishable ולכן אין כאן דליפת סוד. אבל יש
 * כאן משהו גרוע יותר, ושקט יותר: **`npm run dev` אחרי `clone`
 * כותב לדאטה של הייצור.** מפתח שבודק הגשה, מוחק מחזור או מריץ
 * בוטים עושה את זה על המשחק החי, ואין שום דבר במסך שאומר לו.
 *
 * זה לא נפתר בהסתרת מפתחות. זה נפתר בכך שהסביבה תהיה **גלויה**:
 * אם מישהו עומד לגעת בייצור, שיראה את זה.
 *
 * ★ למה זה נגזר מהכתובת ולא רק ממשתנה סביבה
 *
 * משתנה סביבה שלא הוגדר הוא בדיוק המצב שבו הטעות קורית. גזירה
 * מהכתובת עובדת גם כשאיש לא הגדיר כלום — וזו הנקודה.
 */
export type ProjectEnv = 'production' | 'staging' | 'local';

export const PROJECT_ENV: ProjectEnv = (() => {
  const explicit = env('VITE_SUPABASE_ENV');
  if (explicit === 'production' || explicit === 'staging' || explicit === 'local') {
    return explicit;
  }
  if (/localhost|127\.0\.0\.1/.test(DUBID_PROJECT.url)) return 'local';
  /* כתובת שאינה של פרויקט הייצור המוכר = לא ייצור. ברירת המחדל
     הזהירה כאן היא **staging**: להכריז בטעות "ייצור" על סביבת
     בדיקה מרעיש לחינם, ולהפך מסוכן. */
  return DUBID_PROJECT.url === DEFAULTS.dubid.url ? 'production' : 'staging';
})();

/** `true` = כל כתיבה כאן נוגעת במשחק החי של המשתמשים. */
export const IS_PRODUCTION_DATA = PROJECT_ENV === 'production';

export const PROJECT_ENV_HE: Record<ProjectEnv, string> = {
  production: 'ייצור · דאטה חיה',
  staging: 'בדיקות',
  local: 'מקומי',
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
 * ═══════════════════════════════════════════════════════════════
 * ★ כאן ישב לקוח Supabase שני, של אופסיידס — והוא הוסר
 * ═══════════════════════════════════════════════════════════════
 *
 * הוא שימש למסך אחד: לבקש קוד מייל מאופסיידס ולאמת אותו, כדי
 * לקשר חשבון. המסך הזה הוסר (ראו `AccountSheet`), כי מרגע ששני
 * המוצרים חולקים OAuth client אחד בגוגל, אותו אדם נכנס לשניהם
 * באותו חשבון — בלי סבב מייל ובלי מסך נוסף.
 *
 * ★ ומה שנחסך כאן הוא לא רק קוד מת:
 *   לקוח Supabase שני בדפדפן הוא עוד חבילה שנטענת, עוד סשן
 *   שיכול להתנגש, ועוד מפתח שצריך להיות מוגדר נכון כדי שהמוצר
 *   יעלה. פחות חלקים נעים.
 *
 * `OFFSIDES_PROJECT` **נשאר** — לוח הניהול משתמש בכתובת שלו כדי
 * להציג את כתובת ההחזרה שגוגל צריכה להכיר עבור אופסיידס.
 */

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
  // ★ `db.schema = 'game'` חל גם על RPC. `server_now` המקורית
  //   יושבת ב-`public`, ולכן קריאה כאן הייתה מחזירה 404 בשקט
  //   וההיסט היה נשאר 0 לנצח. `db/09` §3b מוסיפה עטיפה ב-`game`.
  const { data, error } = await supabase.rpc('server_now');
  if (error || data == null) throw error ?? new Error('no server time');
  return Number(data);
}
