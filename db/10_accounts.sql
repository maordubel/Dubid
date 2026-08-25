-- =====================================================================
--  DUBID · מיגרציה 10 — חשבונות
--
--  ★ מה זה מוסיף, ומה זה בכוונה לא משנה
--
--  עד עכשיו כל משתמש בדוביד היה אנונימי. זה נשאר — **אורח הוא
--  עדיין אזרח מן המניין**, והוא יכול לשחק מחזור שלם בלי להשאיר
--  כתובת מייל. מה שנוסף הוא האפשרות להירשם, ולהפוך את הזהות
--  ממשהו שחי בדפדפן למשהו שחי בחשבון.
--
--  המבנה נגזר מטופס ההרשמה של אופסיידס (`DUBIDAUTHSYNC.md` §5),
--  כדי ששני המוצרים יבקשו את אותם שדות ויכתבו אותו מטא־דאטה.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ הערה על ההנחה במסמך המקור
--  ═══════════════════════════════════════════════════════════════
--
--  `DUBIDAUTHSYNC.md` נכתב תחת ההנחה של **פרויקט Supabase אחד**
--  לשני המוצרים ("אין מה לסנכרן — אותה שורה *היא* המשתמש").
--  ההחלטה בפועל הייתה אחרת: שני פרויקטים נפרדים.
--
--  לכן מה שרלוונטי מהמסמך ומיושם כאן הוא כל מה שאינו תלוי במסד
--  משותף — חוזה הטופס, שדות המטא־דאטה, `emailRedirectTo`,
--  `detectSessionInUrl`, ובעיקר **פאץ' התנגשות שמות המשתמש**
--  (§8), שהוא באג אמיתי ומשוחזר וחל בדיוק אותו דבר גם כאן.
--
--  מה ש**לא** מיושם, כי אין לו משמעות בשני מסדים: `auth.users`
--  משותף, ולקוח OAuth יחיד שנותן אותו `auth.users.id`. בדוביד
--  Google יוצר משתמש דוביד; החיבור לחשבון אופסיידס נשאר דרך
--  `link-offsides` (מיגרציה 09 + Edge Function).
--
--  אידמפוטנטי. additive בלבד. בטוח על מסד חי.
-- =====================================================================

SET search_path = core, game, public;

CREATE EXTENSION IF NOT EXISTS citext;

-- =====================================================================
-- §1 עמודות הפרופיל
-- =====================================================================
ALTER TABLE game.users
  -- ★ `citext` ולא `text`. "מאור" ו-"Maor" הם שמות שונים; "maor"
  --   ו-"MAOR" הם אותו שם, ומשתמש שמגלה את זה רק כשהוא מנסה
  --   להתחבר — מגלה את זה מאוחר מדי.
  ADD COLUMN IF NOT EXISTS username         CITEXT,
  ADD COLUMN IF NOT EXISTS avatar           TEXT,
  ADD COLUMN IF NOT EXISTS referral_code    TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_code TEXT,
  ADD COLUMN IF NOT EXISTS email            TEXT,
  -- ★ הדגל הזה הוא לב העניין: "אורח" אינו סוג משתמש נפרד, אלא
  --   מצב של אותו משתמש. שדרוג מאורח לרשום לא מעביר שום דאטה —
  --   הוא מוריד דגל. לכן אין מסלול הגירה שיכול להיכשל באמצע.
  ADD COLUMN IF NOT EXISTS is_guest         BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS registered_at    TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_key
  ON game.users (username) WHERE username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_key
  ON game.users (referral_code) WHERE referral_code IS NOT NULL;

COMMENT ON COLUMN game.users.is_guest IS
  'TRUE = נכנס בלי הרשמה. אורח משחק, מדורג ומופיע בטבלה בדיוק '
  'כמו כולם. הדגל משפיע רק על מה שהמוצר מציע לו, לא על מה שמותר לו.';

-- =====================================================================
-- §2 ★★ התנגשות שמות משתמש — הבאג מ-§8 של מסמך המקור ★★
-- =====================================================================
--
--  ★ מה נשבר, ולמה זה לא תיאורטי
--
--  ברגע ש-`username` הוא `UNIQUE`, כל מסלול שיוצר פרופיל בלי שם
--  מפורש נופל לגיבוי שנגזר מהמייל — `split_part(email,'@',1)`
--  ועוד ארבעה תווים מה-UUID. במסמך המקור שוחזר בדיוק זה:
--
--      info@alpha.com   id 4336d23f…  →  info_4336   ✓
--      info@beta.com    id 11111111…  →  info_1111   ✓
--      info@gamma.com   id 1111aaaa…  →  info_1111   ✗ duplicate key
--
--  ההרשמה השלישית **נכשלת ברמת השרת** והמשתמש רואה
--  "Database error saving new user". עם `info@` / `contact@` /
--  `hello@` זה קורה בעולם האמיתי.
--
--  ★ הפתרון: טריגר BEFORE INSERT על הטבלה, לא תיקון בפונקציה.
--
--  יש שלושה מסלולים שיוצרים פרופיל — `ensure_profile`, קישור
--  אופסיידס, ואדמין. תיקון באחד מהם משאיר את השניים האחרים
--  שבורים. טריגר על הטבלה תופס את שלושתם.
--
--  ★ הסיומת נגזרת מהמפתח הראשי של השורה עצמה, ולא מלולאת
--    "ספור עד שפנוי". לולאה כזו היא תחרות: שתי הרשמות מקבילות
--    יכולות שתיהן לראות ש-`x_2` פנוי. מזהה השורה ייחודי מעצם
--    היותו מפתח ראשי, ולכן אין תחרות בכלל.
--
--  ★★ אזהרה למי שמיישם את אותו פאץ' בצד אופסיידס ★★
--
--  מסמך המקור (§8) מתאר סיומת של **ארבעה** תווים מה-UUID —
--  אותו אורך כמו הגיבוי השבור שהוא בא לתקן. הבדיקה כאן תפסה
--  שזה לא מספיק:
--
--      11111111-…  →  info_1111
--      1111aaaa-…  →  info_1111   ✗ duplicate key
--
--  זה בדיוק התרחיש שהמסמך עצמו הביא כהוכחה לבאג — הפאץ' רק
--  הזיז אותו שלב אחד אחורה. ארבעה תווים הקסדצימליים הם 65,536
--  אפשרויות; בפרדוקס יום ההולדת מספיק כמה מאות משתמשים עם אותו
--  חלק־מייל כדי לפגוש התנגשות.
--
--  כאן: שלוש דרגות, והשלישית **לא יכולה** להתנגש —
--
--      1.  base                    אם פנוי, נשמר תו-בתו
--      2.  base_XXXXXXXX           שמונה תווים
--      3.  base_<32 תווים מלאים>   ה-UUID השלם = ייחודי בהגדרה
--
--  אין לולאה, אין ספירה, ואין תרחיש שנופל.
CREATE OR REPLACE FUNCTION game.users_username_dedupe()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = game, public
AS $$
DECLARE
  v_base TEXT;
  v_hex  TEXT;
  v_try  CITEXT;
BEGIN
  -- שם ריק או חסר → נגזר מהמייל, ואם גם הוא חסר → 'player'.
  v_base := NULLIF(btrim(COALESCE(NEW.username::TEXT, '')), '');
  IF v_base IS NULL THEN
    v_base := NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), '');
  END IF;
  IF v_base IS NULL THEN
    v_base := 'player';
  END IF;

  -- ★ אין סינון תווים. שם בעברית שורד תו-בתו, וזו החלטה: מוצר
  --   שמדבר עברית ומכריח האנדל לטיני הוא מוצר שלא מדבר עברית.
  v_try := v_base::CITEXT;

  IF NOT EXISTS (SELECT 1 FROM game.users WHERE username = v_try AND id <> NEW.id) THEN
    NEW.username := v_try;      -- פנוי — נשמר תו-בתו
    RETURN NEW;
  END IF;

  -- דרגה 2 — שמונה תווים מה-PK.
  v_hex := upper(replace(NEW.id::TEXT, '-', ''));
  v_try := (v_base || '_' || left(v_hex, 8))::CITEXT;
  IF NOT EXISTS (SELECT 1 FROM game.users WHERE username = v_try AND id <> NEW.id) THEN
    NEW.username := v_try;
    RETURN NEW;
  END IF;

  -- דרגה 3 — ה-UUID המלא. ייחודי בהגדרה, ולכן זו התחנה האחרונה.
  NEW.username := (v_base || '_' || v_hex)::CITEXT;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_username_dedupe ON game.users;
-- ★ INSERT בלבד, בכוונה.
--   משתמש מחובר שמנסה לשנות את שמו לשם תפוס צריך לקבל שגיאה
--   אמיתית — לא שינוי שקט לשם אחר שהוא לא ביקש.
CREATE TRIGGER users_username_dedupe
  BEFORE INSERT ON game.users
  FOR EACH ROW EXECUTE FUNCTION game.users_username_dedupe();

/**
 * בדיקת זמינות לטופס.
 *
 * ★ למה זה לא חושף מידע: שמות המשתמש מופיעים ממילא בכל טבלת
 *   דירוג במוצר. הפונקציה לא מגלה דבר שאי אפשר לראות במסך הדירוג.
 */
CREATE OR REPLACE FUNCTION game.username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public AS $$
  SELECT CASE
    WHEN btrim(COALESCE(p_username, '')) = '' THEN FALSE
    WHEN length(btrim(p_username)) < 3       THEN FALSE
    ELSE NOT EXISTS (
      SELECT 1 FROM game.users WHERE username = btrim(p_username)::CITEXT
    )
  END;
$$;
GRANT EXECUTE ON FUNCTION game.username_available(TEXT) TO anon, authenticated;

-- =====================================================================
-- §3 יצירת הפרופיל — קוראת את מה שהטופס שלח
-- =====================================================================
--
--  ★ המטא־דאטה של ההרשמה היא מקור אמת, ולא הצעה.
--
--  `supabase.auth.signUp({ options: { data: {...} } })` כותב
--  ל-`auth.users.raw_user_meta_data`. הפונקציה קוראת משם, ולכן
--  שם המשתמש והאווטאר שהמשתמש בחר בטופס שורדים גם אם הקליינט
--  נסגר מיד אחרי ההרשמה ולפני שהספיק לקרוא לפונקציה בעצמו.
--
--  ★ למה גם `email` נשמר כאן: הוא נדרש לגיבוי שם המשתמש (§2).
--    הוא **לא** מוחזר לאף קליינט — ראו `game.me()`.
CREATE OR REPLACE FUNCTION game.ensure_profile(p_display_name TEXT DEFAULT NULL)
RETURNS game.users
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE
  v_auth  UUID := auth.uid();
  v_user  game.users;
  v_meta  JSONB;
  v_email TEXT;
  v_anon  BOOLEAN;
  v_name  TEXT;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT u.raw_user_meta_data,
         u.email,
         COALESCE(u.is_anonymous, FALSE)
    INTO v_meta, v_email, v_anon
    FROM auth.users u WHERE u.id = v_auth;

  -- עדיפות: מה שהקליינט שלח עכשיו > מה שהיה בטופס ההרשמה.
  v_name := COALESCE(
    NULLIF(btrim(p_display_name), ''),
    NULLIF(btrim(v_meta->>'username'), ''),
    NULLIF(btrim(v_meta->>'display_name'), '')
  );

  SELECT * INTO v_user FROM game.users WHERE id = v_auth OR auth_id = v_auth;

  IF v_user.id IS NOT NULL THEN
    UPDATE game.users SET
      display_name = COALESCE(v_name, display_name),
      avatar       = COALESCE(avatar, NULLIF(v_meta->>'avatar', '')),
      email        = COALESCE(v_email, email),
      -- ★ המעבר מאורח לרשום קורה כאן, ורק בכיוון אחד.
      --   משתמש רשום לא חוזר להיות אורח בגלל רענון דף.
      is_guest      = (v_anon AND v_user.offsides_user_id IS NULL),
      registered_at = CASE
                        WHEN v_user.registered_at IS NOT NULL THEN v_user.registered_at
                        WHEN NOT v_anon THEN now()
                        ELSE NULL
                      END
    WHERE id = v_user.id
    RETURNING * INTO v_user;
    RETURN v_user;
  END IF;

  INSERT INTO game.users (
    id, auth_id, display_name, username, avatar, email,
    referred_by_code, referral_code, is_guest, registered_at
  )
  VALUES (
    v_auth, v_auth,
    COALESCE(v_name, 'שחקן דוביד'),
    v_name,                                   -- הטריגר ידאג לייחודיות
    NULLIF(v_meta->>'avatar', ''),
    v_email,
    NULLIF(v_meta->>'referred_by_code', ''),
    upper(left(replace(v_auth::TEXT, '-', ''), 8)),
    v_anon,
    CASE WHEN v_anon THEN NULL ELSE now() END
  )
  RETURNING * INTO v_user;

  RETURN v_user;
END;
$$;
GRANT EXECUTE ON FUNCTION game.ensure_profile(TEXT) TO authenticated;

-- =====================================================================
-- §4 `game.me()` — עכשיו עם מצב החשבון
-- =====================================================================
--
--  ★ `email` לא מוחזר. הוא נשמר בשורה כי הגיבוי של שם המשתמש
--    צריך אותו, ואין שום מסך שצריך להציג אותו. שדה שלא יוצא
--    החוצה הוא שדה שלא ידלוף.
CREATE OR REPLACE FUNCTION game.me()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, public AS $$
  SELECT jsonb_build_object(
    'id',             u.id,
    'displayName',    u.display_name,
    'username',       u.username,
    'avatar',         u.avatar,
    'isGuest',        u.is_guest,
    'referralCode',   u.referral_code,
    'offsidesUserId', u.offsides_user_id,
    'isAdmin',        u.is_admin,
    'registeredAt',   u.registered_at
  )
  FROM game.users u WHERE u.id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION game.me() TO authenticated;

-- =====================================================================
-- §5 שם משתמש מוצע
-- =====================================================================
--
--  ★ למה הטופס מציע שם במקום לבקש אחד.
--
--  "בחר שם משתמש" הוא השדה שהכי הרבה אנשים נתקעים בו, והוא לא
--  שדה חשוב. הצעה שאפשר להחליף מורידה את המחסום לאפס בלי לקחת
--  מאף אחד את הבחירה.
--
--  שתי מילים עבריות מרשימה קטנה + מספר. עברית ולא לטינית, כי
--  המוצר בעברית והשם מופיע בטבלת דירוג עברית.
CREATE OR REPLACE FUNCTION game.suggest_username()
RETURNS TEXT
LANGUAGE plpgsql VOLATILE
SET search_path = game, public AS $$
DECLARE
  v_adj  TEXT[] := ARRAY['מהיר','חד','קר','זהוב','שקט','ערמומי','ברזל','חופשי','אחרון','ראשון'];
  v_noun TEXT[] := ARRAY['חלוץ','בלם','קפטן','מאמן','שוער','כנף','קשר','שופט','אלוף','טוטו'];
  v_try  TEXT;
  i      INT;
BEGIN
  FOR i IN 1..12 LOOP
    v_try := v_noun[1 + floor(random() * array_length(v_noun, 1))::INT] || '_' ||
             v_adj [1 + floor(random() * array_length(v_adj , 1))::INT] || '_' ||
             lpad(floor(random() * 1000)::TEXT, 3, '0');
    IF game.username_available(v_try) THEN RETURN v_try; END IF;
  END LOOP;
  -- 12 ניסיונות נכשלו (כמעט בלתי אפשרי) — נופלים לערך שתמיד פנוי.
  RETURN 'player_' || upper(left(replace(gen_random_uuid()::TEXT, '-', ''), 6));
END;
$$;
GRANT EXECUTE ON FUNCTION game.suggest_username() TO anon, authenticated;

-- =====================================================================
-- §6 יישור שורות קיימות
-- =====================================================================
--  משתמשים שנוצרו לפני המיגרציה: להשלים `referral_code`, ולסמן
--  מי מהם באמת אורח. בלי זה, כל מי שכבר נרשם היה נדחף להירשם שוב.
DO $backfill$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    UPDATE game.users u SET
      referral_code = COALESCE(u.referral_code, upper(left(replace(u.id::TEXT, '-', ''), 8))),
      email         = COALESCE(u.email, a.email),
      is_guest      = COALESCE(a.is_anonymous, TRUE) AND u.offsides_user_id IS NULL,
      registered_at = CASE
                        WHEN u.registered_at IS NOT NULL THEN u.registered_at
                        WHEN COALESCE(a.is_anonymous, TRUE) = FALSE THEN now()
                        ELSE NULL
                      END
    FROM auth.users a
    WHERE a.id = u.id;

    -- שם משתמש לכל מי שאין לו, דרך הטריגר של §2 (UPDATE לא מפעיל
    -- אותו, ולכן הגזירה חוזרת כאן במפורש).
    UPDATE game.users SET username = NULL WHERE btrim(COALESCE(username::TEXT, '')) = '';
    -- ה-UUID המלא ולא קיצור: שורות קיימות מקבלות שם ייחודי מובטח,
    -- והמשתמש יכול לשנות אותו אחר כך למשהו יפה.
    UPDATE game.users u SET
      username = (COALESCE(NULLIF(btrim(u.display_name), ''), 'player')
                  || '_' || upper(replace(u.id::TEXT, '-', '')))::CITEXT
    WHERE u.username IS NULL;
  END IF;
END
$backfill$;

-- =====================================================================
-- בדיקת בריאות
-- =====================================================================
-- ★ `DROP` ולא `CREATE OR REPLACE`.
--
--   PostgreSQL לא מרשה ל-`CREATE OR REPLACE VIEW` לשנות את
--   רשימת העמודות — רק להוסיף בסוף. מיגרציה מאוחרת שהרחיבה
--   תצוגה, ואז הרצה חוזרת של המיגרציה המוקדמת שמצמצמת אותה
--   בחזרה, נופלת על:
--
--       ERROR: 42P16: cannot drop columns from view
--
--   וזה קורה בפועל: הקבצים אידמפוטנטיים, ולכן טבעי להריץ אותם
--   שוב בסדר כלשהו. `DROP` הופך את הסדר ללא רלוונטי.
DROP VIEW IF EXISTS game.v_accounts_health;
CREATE VIEW game.v_accounts_health AS
SELECT
  count(*)                                        AS users_total,
  count(*) FILTER (WHERE is_guest)                AS guests,
  count(*) FILTER (WHERE NOT is_guest)            AS registered,
  count(*) FILTER (WHERE offsides_user_id IS NOT NULL) AS linked_to_offsides,
  count(*) FILTER (WHERE username IS NULL)        AS missing_username,
  count(*) - count(DISTINCT username)             AS duplicate_usernames
FROM game.users;

GRANT SELECT ON game.v_accounts_health TO authenticated;
