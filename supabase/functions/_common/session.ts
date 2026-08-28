/**
 * _common/session.ts — הנפקת סשן למשתמש קיים, מצד שרת.
 *
 * ★ הבעיה
 *
 * שני הזרימות שלנו (קוד חד־פעמי, קישור אופסיידס) צריכות אותו דבר:
 * "אני, השרת, יודע מי המשתמש. תן לי סשן **בשבילו**".
 *
 * ל-Supabase אין API כזה. מה שכן יש הוא `admin.generateLink` —
 * הוא מחזיר `hashed_token` בלי לשלוח מייל — ואז `verifyOtp` על
 * אותו טוקן מחזיר סשן מלא. זה הדפוס הרשמי לזרימות מייל מותאמות,
 * וכאן הוא משמש בלי מייל בכלל.
 *
 * ★ למה צריך אימייל למשתמש אנונימי
 *
 * `generateLink` דורש כתובת. משתמש אנונימי נולד בלי אחת, ולכן
 * מוצמדת לו כתובת סינתטית ב-`.invalid` — TLD ששמור בתקן
 * (RFC 2606) ולעולם לא ניתן לרישום. אי אפשר לשלוח אליה דואר,
 * ואי אפשר להתנגש עם כתובת אמיתית של מישהו.
 *
 * ★ מה זה **לא**
 *
 * זו לא דלת אחורית. הפונקציות שקוראות לכאן כבר הוכיחו שהמשתמש
 * הוא מי שהוא טוען — קוד תקף שלא פג, או טוקן שאומת מול אופסיידס.
 * המודול הזה רק ממיר הוכחה לסשן.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

export function adminClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface MintedSession {
  access_token: string;
  refresh_token: string;
}

export async function mintSession(admin: SupabaseClient, userId: string): Promise<MintedSession> {
  const { data: got, error: getErr } = await admin.auth.admin.getUserById(userId);
  if (getErr || !got?.user) throw new Error('USER_NOT_FOUND');

  let email = got.user.email;
  if (!email) {
    email = `guest-${userId}@dubid.invalid`;
    const { error } = await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });
    if (error) throw new Error('EMAIL_ASSIGN_FAILED: ' + error.message);
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error('LINK_FAILED: ' + (linkErr?.message ?? 'no token'));
  }

  // האימות עצמו נעשה בלקוח anon — סשן שנוצר תחת service_role
  // אינו סשן של המשתמש.
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: verified, error: vErr } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  });
  if (vErr || !verified?.session) throw new Error('VERIFY_FAILED: ' + (vErr?.message ?? ''));

  return {
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  };
}

/**
 * CORS — הפונקציות נקראות מהדפדפן.
 *
 * ★★ ברירת המחדל היא הדומיין שלנו, ולא `*` ★★
 *
 * הקובץ הזה משרת את `access-code` ואת `link-offsides` — שתי
 * הפונקציות שמנפיקות **סשן**. `*` כברירת מחדל אומר שאם
 * `APP_ORIGIN` לא הוגדר בפרויקט (וזה בדיוק מה שקורה בהתקנה
 * חדשה, בשקט), כל אתר בעולם יכול להריץ פדיון קודים מהדפדפן של
 * המשתמש שלנו.
 *
 * ברירת מחדל בטוחה עדיפה על הגדרה נכונה שתלויה בכך שמישהו
 * זכר לבצע אותה.
 */
export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'https://dubid.dubelteam.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  /* ★ בלי זה, שרת מטמון בדרך יכול להגיש תשובה עם כותרת מקור
     של בקשה קודמת ממקור אחר. */
  Vary: 'Origin',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
