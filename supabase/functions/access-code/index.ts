/**
 * access-code — כניסה בלי הרשמה, בין מכשירים.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ הבעיה שזה פותר
 * ═══════════════════════════════════════════════════════════════
 *
 * "כניסה ללא הרשמה" נשמעת פשוטה עד שמישהו מחליף מכשיר. זהות
 * אנונימית חיה ב-localStorage של דפדפן אחד; בטלפון היא לא קיימת.
 * המשתמש בונה הרכב במחשב, פותח בטלפון, ורואה מסך ריק — ובצדק
 * חושב שהמערכת איבדה לו הכל.
 *
 * קוד בן שש תווים פותר את זה בלי טופס הרשמה אחד.
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ שלוש החלטות אבטחה
 * ═══════════════════════════════════════════════════════════════
 *
 *  1. **הקוד לא נשמר.** רק SHA-256 שלו. מי שמשיג גישה לטבלה לא
 *     יכול להתחזות לאף אחד. אותו עיקרון כמו סיסמה.
 *
 *  2. **חד־פעמי, ופג.** נפדה = מת. שעה = מת. קוד שנשאר תקף
 *     לנצח בצילום מסך של וואטסאפ הוא חשבון פרוץ.
 *
 *  3. **אלפבית בלי אותיות מתבלבלות.** אין 0/O, אין 1/I/L.
 *     משתמש שמקליד קוד לא נכון כי הפונט דו־משמעי, ינסה שוב —
 *     ושלושה ניסיונות כאלה נראים בדיוק כמו ניחוש בכוח גס.
 *
 * הנפקה דורשת JWT (רק בעל הזהות מנפיק לעצמו).
 * פדיון לא דורש — זו כל הנקודה: המכשיר החדש עדיין לא אף אחד.
 */
import { adminClient, mintSession, CORS, json } from '../_common/session.ts';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LEN = 6;
const TTL_MS = 60 * 60 * 1000;      // שעה
const MAX_ATTEMPTS = 8;

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newCode(): string {
  // `crypto.getRandomValues` ולא `Math.random`: קוד שאפשר לנחש
  // מהזמן שבו הונפק אינו קוד.
  const buf = new Uint32Array(CODE_LEN);
  crypto.getRandomValues(buf);
  return [...buf].map((n) => ALPHABET[n % ALPHABET.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const admin = adminClient();

    /* ---------------- הנפקה ---------------- */
    if (body.action === 'issue') {
      const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
      if (!jwt) return json({ error: 'AUTH_REQUIRED' }, 401);

      const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
      if (whoErr || !who?.user) return json({ error: 'AUTH_REQUIRED' }, 401);

      const code = newCode();
      const hash = await sha256Hex(code);
      const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

      // קוד חדש מבטל את הקודם. שני קודים חיים לאותו משתמש הם
      // שתי דרכים להיכנס, ורק אחת מהן נמצאת אצלו.
      await admin.schema('game').from('access_codes').delete().eq('user_id', who.user.id);

      const { error } = await admin.schema('game').from('access_codes').insert({
        code_hash: hash, user_id: who.user.id, expires_at: expiresAt,
      });
      if (error) return json({ error: 'ISSUE_FAILED', detail: error.message }, 500);

      return json({ code, expiresAt });
    }

    /* ---------------- פדיון ---------------- */
    if (body.action === 'redeem') {
      const code = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== CODE_LEN) return json({ error: 'INVALID_CODE' }, 400);

      /*
       * ★★★ הבאג שהיה כאן ★★★
       *
       * `MAX_ATTEMPTS = 8` היה מוגדר, השדה `attempts` נקרא — ולא
       * הוגדל אף פעם. כלומר לא הייתה שום הגנה על הפדיון.
       *
       * ★ ומונה על השורה לא היה פותר את זה גם אילו כן היה מוגדל.
       *
       * קוד שגוי לא מתאים לאף שורה, ולכן אין מה להגדיל. תוקף
       * שמנחש קודים בני שש (≈30 ביט) מול חלון חי של שעה לא נוגע
       * באף שורה קיימת עד הרגע שבו הוא פוגע — והמונה "לכל קוד"
       * סופר בדיוק את מי שכבר הצליח.
       *
       * לכן המונה יושב על **המנחש**, לא על הקוד.
       */
      const actor = await sha256Hex(
        (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown',
      );
      const { data: allowed } = await admin.schema('game')
        .rpc('code_attempt_ok', { p_actor: actor.slice(0, 32) });

      if (allowed === false) return json({ error: 'TOO_MANY_ATTEMPTS' }, 429);

      const hash = await sha256Hex(code);
      const { data: row } = await admin.schema('game').from('access_codes')
        .select('user_id, expires_at, redeemed_at, attempts')
        .eq('code_hash', hash)
        .maybeSingle();

      if (!row) return json({ error: 'INVALID_CODE' }, 404);
      if (row.redeemed_at) return json({ error: 'CODE_USED' }, 410);
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return json({ error: 'CODE_EXPIRED' }, 410);
      }
      if ((row.attempts ?? 0) >= MAX_ATTEMPTS) return json({ error: 'TOO_MANY_ATTEMPTS' }, 429);

      /*
       * ★ הסימון "נפדה" קורה **לפני** יצירת הסשן, והוא מותנה.
       *
       * הסדר ההפוך (מנפיקים ואז מסמנים) הוא בדיקה-ואז-כתיבה: שתי
       * בקשות שמגיעות באותה מילישנייה שתיהן רואות `redeemed_at`
       * ריק, ושתיהן מקבלות סשן — כלומר קוד חד־פעמי שנפדה פעמיים.
       *
       * `.is('redeemed_at', null)` הופך את זה לפעולה אטומית: רק
       * מי שהעדכון שלו החזיר שורה ממשיך.
       */
      const { data: claimed } = await admin.schema('game').from('access_codes')
        .update({ redeemed_at: new Date().toISOString() })
        .eq('code_hash', hash)
        .is('redeemed_at', null)
        .select('user_id');

      if (!claimed || claimed.length === 0) return json({ error: 'CODE_USED' }, 410);

      const session = await mintSession(admin, row.user_id);

      const { data: profile } = await admin.schema('game').from('users')
        .select('display_name').eq('id', row.user_id).maybeSingle();

      return json({ ...session, display_name: profile?.display_name ?? null });
    }

    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (err) {
    return json({ error: 'INTERNAL', detail: String(err) }, 500);
  }
});
