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

/** קוד העברה: "תעביר אותי עכשיו לטלפון". קצר, חד־פעמי, שעה. */
const CODE_LEN = 6;
const TTL_MS = 60 * 60 * 1000;

/**
 * ★★ מפתח הכניסה — למה הוא ארוך יותר ★★
 *
 * שישה תווים מאלפבית של 32 הם 30 ביט. זה בסדר גמור לקוד שחי
 * שעה, וזה לא מספיק לקוד ששוכב בגלריה של המשתמש לנצח.
 *
 * עשרה תווים הם 50 ביט. יחד עם המכסה שכבר קיימת במסד
 * (`code_attempt_ok`, עשרה ניסיונות לרבע שעה לכל מנחש), ניחוש
 * הוא לא תרחיש. מה שמגן כאן הוא **האורך כפול המכסה**, ולא אחד
 * מהם לבדו.
 */
const PASS_LEN = 10;

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newCode(len = CODE_LEN): string {
  // `crypto.getRandomValues` ולא `Math.random`: קוד שאפשר לנחש
  // מהזמן שבו הונפק אינו קוד.
  //
  // ★ 32 מחלק את 2³² בדיוק, ולכן `% 32` אינו מטה את ההתפלגות.
  //   אלפבית באורך אחר היה דורש דחיית ערכים, ולא רק מודולו.
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return [...buf].map((n) => ALPHABET[n % ALPHABET.length]).join('');
}

/** `AB34-CD67-KM` — מקובץ, כי מפתח בן עשרה תווים ברצף לא נקרא. */
function pretty(code: string): string {
  return code.replace(/(.{4})(.{4})(.*)/, '$1-$2-$3').replace(/-$/, '');
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

    /* ---------------- מפתח הכניסה הקבוע ---------------- */
    /*
     * ★ אידמפוטנטי: מי שכבר יש לו מפתח מקבל אותו... ולא.
     *
     * וזו נקודה שחשוב לומר בפירוש: **אי אפשר להחזיר מפתח קיים.**
     * במסד יושב רק ה-hash שלו, וזו ההחלטה הנכונה — מי שמשיג
     * גישה לטבלה לא יכול להתחזות לאיש.
     *
     * המשמעות המעשית: "הצג לי את הכרטיס שלי שוב" חייב להנפיק
     * מפתח **חדש** ולבטל את הישן. וזה גם ההתנהגות הנכונה: אם
     * המשתמש מבקש את הכרטיס שוב, בדרך כלל הסיבה היא שהוא איבד
     * את הקודם.
     *
     * מה שכן מוחזר בלי הנפקה מחדש הוא **המצב** (`my_pass_state`)
     * — מתי הונפק וכמה פעמים שימש. זה מספיק כדי שהמסך יידע
     * להגיד "כבר יש לך כרטיס" בלי לזרוק את הקיים.
     */
    if (body.action === 'pass') {
      const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
      if (!jwt) return json({ error: 'AUTH_REQUIRED' }, 401);

      const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
      if (whoErr || !who?.user) return json({ error: 'AUTH_REQUIRED' }, 401);

      const code = newCode(PASS_LEN);
      const hash = await sha256Hex(code);

      /* ★ ביטול הישן לפני הכנסת החדש, ולא אחריו.
         יש אינדקס ייחודי על "מפתח פעיל אחד למשתמש"; הסדר ההפוך
         היה נכשל על עצמו. */
      await admin.schema('game').from('access_codes')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', who.user.id).eq('kind', 'pass').is('revoked_at', null);

      const { error } = await admin.schema('game').from('access_codes').insert({
        code_hash: hash, user_id: who.user.id, kind: 'pass', expires_at: null,
      });
      if (error) return json({ error: 'PASS_FAILED', detail: error.message }, 500);

      const { data: profile } = await admin.schema('game').from('users')
        .select('display_name').eq('id', who.user.id).maybeSingle();

      return json({
        code,
        pretty: pretty(code),
        displayName: profile?.display_name ?? null,
        issuedAt: new Date().toISOString(),
      });
    }

    /* ---------------- פדיון ---------------- */
    if (body.action === 'redeem') {
      /* ★ המקפים שהמשתמש רואה בכרטיס נשלפים כאן.
         הוא מקליד "AB34-CD67-KM" כי ככה זה כתוב אצלו; הנרמול
         חייב לקבל את זה, אחרת המפתח שאנחנו הדפסנו לו לא עובד. */
      const code = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== CODE_LEN && code.length !== PASS_LEN) {
        return json({ error: 'INVALID_CODE' }, 400);
      }

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
        .select('user_id, kind, expires_at, redeemed_at, revoked_at, uses')
        .eq('code_hash', hash)
        .maybeSingle();

      if (!row) return json({ error: 'INVALID_CODE' }, 404);
      if (row.revoked_at) return json({ error: 'CODE_REVOKED' }, 410);

      /*
       * ═══════════════════════════════════════════════════════
       * ★★ שני סוגים, ורק אחד מהם נשרף בשימוש ★★
       * ═══════════════════════════════════════════════════════
       *
       *   transfer — "תעביר אותי עכשיו לטלפון". חד־פעמי, שעה.
       *   pass     — הכרטיס שהמשתמש שמר בגלריה. חוזר, קבוע.
       *
       * ★ למה מפתח חוזר הוא **חובה** ולא נוחות
       *
       * המוצר מבקש מהמשתמש לשמור תמונה עם המפתח ולשלוח אותה
       * לעצמו. מפתח שנשרף בשימוש הראשון הופך את התמונה הזו
       * לחסרת ערך בדיוק אחרי הפעם הראשונה — והמשתמש יגלה את זה
       * ברגע הגרוע ביותר: כשהוא מחליף טלפון בפעם השנייה.
       *
       * מה שמחליף את החד־פעמיות בתור ההגנה: אורך (50 ביט)
       * ומכסת ניחושים למנחש. ראו את ההערה על `PASS_LEN`.
       */
      if (row.kind === 'pass') {
        await admin.schema('game').from('access_codes')
          .update({ uses: (row.uses ?? 0) + 1, last_used_at: new Date().toISOString() })
          .eq('code_hash', hash);
      } else {
        if (row.redeemed_at) return json({ error: 'CODE_USED' }, 410);
        if (!row.expires_at || new Date(row.expires_at).getTime() < Date.now()) {
          return json({ error: 'CODE_EXPIRED' }, 410);
        }

        /*
         * ★ הסימון "נפדה" קורה **לפני** יצירת הסשן, והוא מותנה.
         *
         * הסדר ההפוך (מנפיקים ואז מסמנים) הוא בדיקה-ואז-כתיבה:
         * שתי בקשות שמגיעות באותה מילישנייה שתיהן רואות
         * `redeemed_at` ריק, ושתיהן מקבלות סשן — כלומר קוד
         * חד־פעמי שנפדה פעמיים.
         *
         * `.is('redeemed_at', null)` הופך את זה לאטומי.
         */
        const { data: claimed } = await admin.schema('game').from('access_codes')
          .update({ redeemed_at: new Date().toISOString(), uses: (row.uses ?? 0) + 1,
                    last_used_at: new Date().toISOString() })
          .eq('code_hash', hash)
          .is('redeemed_at', null)
          .select('user_id');

        if (!claimed || claimed.length === 0) return json({ error: 'CODE_USED' }, 410);
      }

      const session = await mintSession(admin, row.user_id);

      const { data: profile } = await admin.schema('game').from('users')
        .select('display_name').eq('id', row.user_id).maybeSingle();

      return json({
        ...session,
        display_name: profile?.display_name ?? null,
        kind: row.kind ?? 'transfer',
      });
    }

    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (err) {
    return json({ error: 'INTERNAL', detail: String(err) }, 500);
  }
});
