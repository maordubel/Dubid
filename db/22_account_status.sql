-- =====================================================================
--  Dubid · מיגרציה 22 — "התחברתי, ולא קרה כלום"
-- =====================================================================
--
--  ═══════════════════════════════════════════════════════════════
--  ★★★ הבאג ★★★
--  ═══════════════════════════════════════════════════════════════
--
--  משתמש נכנס עם גוגל, חוזר לאתר — ועדיין רשום כ**אורח**.
--  הפרופיל מציג "אורח", הצעת ההרשמה ממשיכה להופיע, ושום דבר
--  לא מרגיש שונה. כאילו ההתחברות לא קרתה.
--
--  ★ הסיבה: `is_guest` נגזר משדה **אחד** — `auth.users.is_anonymous`.
--
--  והשדה הזה לא בהכרח מתעדכן כשמקשרים זהות לחשבון אנונימי קיים
--  (`linkIdentity`). כלומר: המשתמש **באמת** חיבר את גוגל, יש לו
--  שורה ב-`auth.identities`, אבל מבחינת המוצר הוא עדיין אורח.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ התיקון: לשאול את השאלה הנכונה
--  ═══════════════════════════════════════════════════════════════
--
--  "האם המשתמש הזה יכול לחזור לחשבון שלו ממכשיר אחר?"
--
--  התשובה היא כן אם מתקיים **אחד** מהשלושה:
--    · יש לו כתובת מייל מאומתת, או
--    · יש לו זהות מספק חיצוני (גוגל), או
--    · `auth` עצמו כבר לא מחשיב אותו אנונימי.
--
--  שלוש בדיקות במקום אחת, ו-`OR` ביניהן. כל אחת מהן לבדה מספיקה,
--  ולכן אף מסלול המרה לא נופל בין הכיסאות — לא גוגל, לא אימייל,
--  ולא מה שיתווסף מחר.
--
--  אידמפוטנטי. אפשר להריץ שוב.
-- =====================================================================

SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · "האם זה עדיין אורח"
-- ---------------------------------------------------------------------
--
--  ★ הפונקציה עמידה בפני היעדר `auth.identities`.
--
--  בסביבת הבדיקות המקומית הסכימה `auth` היא חיקוי מצומצם ואין
--  בה טבלת `identities`. פונקציה שנשענת עליה בעיוורון הייתה
--  מפילה את כל חבילת הבדיקות — ואז הבאג הבא יתגלה רק בייצור.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.auth_is_guest(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, auth, public
AS $$
DECLARE
  v_anon    BOOLEAN;
  v_email   TEXT;
  v_linked  BOOLEAN := FALSE;
BEGIN
  SELECT COALESCE(u.is_anonymous, FALSE), NULLIF(btrim(u.email), '')
    INTO v_anon, v_email
    FROM auth.users u WHERE u.id = p_uid;

  IF NOT FOUND THEN RETURN TRUE; END IF;

  -- ★ זהות חיצונית — הסימן החזק ביותר, וזה שהיה חסר.
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'auth' AND table_name = 'identities') THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM auth.identities i
        WHERE i.user_id = $1 AND i.provider <> 'anonymous'
      )
    $q$ INTO v_linked USING p_uid;
  END IF;

  RETURN NOT (v_linked OR v_email IS NOT NULL OR NOT v_anon);
END;
$$;

GRANT EXECUTE ON FUNCTION game.auth_is_guest(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- §2 · `ensure_profile` שואלת את השאלה הנכונה
-- ---------------------------------------------------------------------

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
  v_guest BOOLEAN;
  v_name  TEXT;
BEGIN
  IF v_auth IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT u.raw_user_meta_data, u.email
    INTO v_meta, v_email
    FROM auth.users u WHERE u.id = v_auth;

  -- ★ כאן השינוי: שלוש בדיקות במקום `is_anonymous` לבדו.
  v_guest := game.auth_is_guest(v_auth);

  v_name := COALESCE(
    NULLIF(btrim(p_display_name), ''),
    NULLIF(btrim(v_meta->>'username'), ''),
    NULLIF(btrim(v_meta->>'display_name'), ''),
    NULLIF(btrim(v_meta->>'full_name'), ''),   -- ★ גוגל שולח את זה
    NULLIF(btrim(v_meta->>'name'), '')
  );

  SELECT * INTO v_user FROM game.users WHERE id = v_auth OR auth_id = v_auth;

  IF v_user.id IS NOT NULL THEN
    UPDATE game.users SET
      display_name = COALESCE(v_name, display_name),
      /* ★ תמונת הפרופיל של גוגל, אם המשתמש עוד לא בחר אווטאר. */
      avatar       = COALESCE(avatar, NULLIF(v_meta->>'avatar', '')),
      email        = COALESCE(v_email, email),
      /* ★★ בכיוון אחד בלבד: מי שכבר רשום לא חוזר להיות אורח
         בגלל רענון דף או תשובה חלקית מהשרת. */
      is_guest      = (v_guest AND v_user.is_guest AND v_user.offsides_user_id IS NULL),
      registered_at = CASE
                        WHEN v_user.registered_at IS NOT NULL THEN v_user.registered_at
                        WHEN NOT v_guest THEN now()
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
    v_name,
    NULLIF(v_meta->>'avatar', ''),
    v_email,
    NULLIF(v_meta->>'referred_by_code', ''),
    upper(left(replace(v_auth::TEXT, '-', ''), 8)),
    v_guest,
    CASE WHEN v_guest THEN NULL ELSE now() END
  )
  RETURNING * INTO v_user;

  RETURN v_user;
END;
$$;

GRANT EXECUTE ON FUNCTION game.ensure_profile(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §3 · `me()` מחזירה גם **איך** התחברת
-- ---------------------------------------------------------------------
--
--  ★ "מחובר" זו הפשטה. "מחובר עם גוגל" היא עובדה שאפשר לראות —
--    וזה ההבדל בין מסך שמרגיש מחובר לבין מסך שטוען שהוא מחובר.
--
--  ⚠ המייל עצמו **לא** חוזר כאן. `me()` רצה בכל עלייה של
--    האפליקציה; המייל שייך ל-`my_profile()`, שנקראת רק כשפותחים
--    את הפרופיל בפועל.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game.me()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, auth, public
AS $$
DECLARE v JSONB; v_provider TEXT := NULL; v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'auth' AND table_name = 'identities') THEN
    EXECUTE $q$
      SELECT i.provider FROM auth.identities i
      WHERE i.user_id = $1 AND i.provider <> 'anonymous'
      ORDER BY i.last_sign_in_at DESC NULLS LAST LIMIT 1
    $q$ INTO v_provider USING v_uid;
  END IF;

  SELECT jsonb_build_object(
    'id',             u.id,
    'displayName',    u.display_name,
    'username',       u.username,
    'avatar',         u.avatar,
    'isGuest',        u.is_guest,
    /* ★ המייל **לא** חוזר כאן, וזו החלטה קיימת שנשמרת:
       `me()` היא קריאת הזהות הקלה שרצה בכל עלייה, והיא מחזירה
       רק מה שצריך כדי לצייר מסך. המייל חוזר ב-`my_profile()`,
       שנקראת רק כשפותחים את הפרופיל. יש בדיקה שנועלת את זה. */
    'provider',       v_provider,
    'referralCode',   u.referral_code,
    'offsidesUserId', u.offsides_user_id,
    'isAdmin',        u.is_admin,
    'registeredAt',   u.registered_at
  ) INTO v
  FROM game.users u WHERE u.id = v_uid;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION game.me() TO authenticated;

-- ---------------------------------------------------------------------
-- §4 · תיקון למפרע
-- ---------------------------------------------------------------------
--
--  ★ מי שכבר חיבר גוגל לפני התיקון תקוע כ"אורח" במסד.
--    בלי השורה הזו הוא יישאר כך עד שיתחבר שוב — ואין לו סיבה
--    לעשות את זה, כי מבחינתו הוא כבר התחבר.
-- ---------------------------------------------------------------------

DO $$
DECLARE n INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'auth' AND table_name = 'identities') THEN
    EXECUTE $q$
      UPDATE game.users u SET
        is_guest = FALSE,
        registered_at = COALESCE(u.registered_at, now())
      WHERE u.is_guest
        AND EXISTS (SELECT 1 FROM auth.identities i
                     WHERE i.user_id = u.id AND i.provider <> 'anonymous')
    $q$;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;

  UPDATE game.users u SET
    is_guest = FALSE,
    registered_at = COALESCE(u.registered_at, now())
  FROM auth.users a
  WHERE a.id = u.id AND u.is_guest AND NULLIF(btrim(a.email), '') IS NOT NULL;

  IF n > 0 THEN RAISE NOTICE 'תוקנו % משתמשים שהיו תקועים כאורחים', n; END IF;
END $$;

UPDATE game.data_revision
   SET revision = revision + 1, scope = 'migration-22', updated_at = now()
 WHERE id = 1;
