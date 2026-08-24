/**
 * link-offsides — חשבון אחד, שני מוצרים.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למה זה חייב להיות בשרת
 * ═══════════════════════════════════════════════════════════════
 *
 * הדפדפן שולח טוקן וטוען "זה שלי, מאופסיידס". דפדפן יכול לשלוח
 * כל דבר. רק צד שרת יכול לשאול את אופסיידס עצמו — "הטוקן הזה
 * באמת שלך, ולמי הוא שייך?" — ולקבל תשובה שאי אפשר לזייף.
 *
 * הבדיקה: `GET {OFFSIDES_URL}/auth/v1/user` עם הטוקן. אם
 * אופסיידס מחזיר משתמש, הטוקן אמיתי. אין דרך קצרה יותר, ואין
 * דרך לדלג על זה.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ למי שייכת ההיסטוריה
 * ═══════════════════════════════════════════════════════════════
 *
 * שני מקרים, ורק אחד מהם מובן מאליו:
 *
 *  · **חשבון אופסיידס שעוד לא קושר** — הוא נצמד למשתמש הדוביד
 *    הנוכחי (האורח). כל מה שהאורח בנה נשמר. זה הרוב.
 *
 *  · **חשבון שכבר מקושר למשתמש דוביד אחר** — אנחנו מחזירים סשן
 *    של **אותו** משתמש, לא של האורח הנוכחי. ההיסטוריה האמיתית
 *    שלו שם: ההגשות, הדירוג, הזירות. אורח שנוצר לפני שלוש דקות
 *    לא מנצח חודש של משחק.
 *
 * מיזוג של שתי היסטוריות במקרה הזה **לא** נעשה בכוונה: זה דורש
 * להחליט מה קורה כששני הצדדים הגישו הרכב לאותו מחזור, וזו החלטת
 * מוצר ולא החלטת קוד.
 *
 * Secrets: OFFSIDES_URL. (SUPABASE_* מוזרקים אוטומטית.)
 */
import { adminClient, mintSession, CORS, json } from '../_common/session.ts';

const OFFSIDES_URL = Deno.env.get('OFFSIDES_URL') ?? 'https://pqdzqpettxuuyngxbpxn.supabase.co';
const OFFSIDES_ANON = Deno.env.get('OFFSIDES_ANON_KEY') ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { offsides_access_token } = await req.json().catch(() => ({}));
    if (!offsides_access_token) return json({ error: 'TOKEN_REQUIRED' }, 400);

    /* --- 1. אימות מול אופסיידס. זו כל האבטחה כאן. --- */
    const res = await fetch(`${OFFSIDES_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${offsides_access_token}`,
        apikey: OFFSIDES_ANON,
      },
    });
    if (!res.ok) return json({ error: 'OFFSIDES_TOKEN_INVALID' }, 401);

    const offsidesUser = await res.json() as { id?: string; email?: string };
    if (!offsidesUser?.id) return json({ error: 'OFFSIDES_TOKEN_INVALID' }, 401);

    const admin = adminClient();

    /* --- 2. כבר מקושר? אותו משתמש מנצח. --- */
    const { data: existing } = await admin.schema('game').from('users')
      .select('id, display_name')
      .eq('offsides_user_id', offsidesUser.id)
      .maybeSingle();

    if (existing?.id) {
      const session = await mintSession(admin, existing.id);
      return json({
        ...session,
        offsides_user_id: offsidesUser.id,
        display_name: existing.display_name ?? null,
        merged_into: 'existing',
      });
    }

    /* --- 3. לא מקושר: נצמד למשתמש הנוכחי, אם יש. --- */
    const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    let dubidUserId: string | null = null;

    if (jwt) {
      const { data: who } = await admin.auth.getUser(jwt);
      dubidUserId = who?.user?.id ?? null;
    }

    if (!dubidUserId) {
      // אין אורח נוכחי (מכשיר חדש לגמרי). יוצרים משתמש.
      const { data: created, error } = await admin.auth.admin.createUser({
        email: offsidesUser.email ?? `offsides-${offsidesUser.id}@dubid.invalid`,
        email_confirm: true,
      });
      if (error || !created?.user) return json({ error: 'CREATE_FAILED' }, 500);
      dubidUserId = created.user.id;
    }

    const { error: upErr } = await admin.schema('game').from('users').upsert({
      id: dubidUserId,
      auth_id: dubidUserId,
      display_name: offsidesUser.email?.split('@')[0] ?? 'שחקן דוביד',
      offsides_user_id: offsidesUser.id,
      offsides_email: offsidesUser.email ?? null,
      linked_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (upErr) return json({ error: 'LINK_FAILED', detail: upErr.message }, 500);

    const session = await mintSession(admin, dubidUserId);
    const { data: profile } = await admin.schema('game').from('users')
      .select('display_name').eq('id', dubidUserId).maybeSingle();

    return json({
      ...session,
      offsides_user_id: offsidesUser.id,
      display_name: profile?.display_name ?? null,
      merged_into: 'current',
    });
  } catch (err) {
    return json({ error: 'INTERNAL', detail: String(err) }, 500);
  }
});
