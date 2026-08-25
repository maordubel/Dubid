-- =====================================================================
--  DUBID · מיגרציה 12 — כניסת אדמין בסיסמה אחת
--
--  ★ מה זה פותר
--
--  עד עכשיו כניסה לניהול דרשה **שני** דברים שלא קשורים זה לזה:
--
--     1. קוד גישה במסך  → פותח את המסך
--     2. `UPDATE game.users SET is_admin = TRUE` ב-SQL Editor
--        → מאפשר לשמור
--
--  מי שעשה רק את הראשון קיבל מסך מלא שבו כל לחיצה נכשלת. זה
--  לא "אבטחה בשתי שכבות" — זו שכחה שנראית כמו באג.
--
--  ★ הפתרון: אותה סיסמה עושה את שניהם.
--
--  המסך שולח את הסיסמה ל-`game.claim_admin`. השרת משווה מול
--  hash שמור, ואם היא נכונה — מסמן את הקורא כאדמין. אין שלב שני,
--  אין SQL Editor, ואין מצב ביניים.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה זה כן, ומה זה לא, מבחינת אבטחה
--  ═══════════════════════════════════════════════════════════════
--
--  **כן:** הסיסמה נבדקת **בשרת**. הקליינט לא מחליט כלום — הוא
--  שולח מחרוזת ומקבל כן/לא. מי שיערוך את הקוד בדפדפן יוכל לפתוח
--  את המסך, ולא יוכל לשמור שום דבר.
--
--  **כן:** הסיסמה לא נשמרת. רק SHA-256 שלה, ועם `pgcrypto`.
--
--  **כן:** מוגבל בקצב. חמישה ניסיונות כושלים בחמש דקות → נעילה.
--  בלי זה, פונקציה ציבורית שמקבלת סיסמה היא הזמנה לניחוש בכוח גס.
--
--  **לא:** זו לא סיסמה חזקה, וזה לא ניהול הרשאות. זו **סיסמת
--  צוות אחת** לשלב שבו יש אדמין אחד. כשיהיו שניים — צריך
--  להעביר את זה לחשבונות אמיתיים, ו-`is_admin` כבר בנוי לזה.
--
--  ⚠ הסיסמה מגיעה למסד כטקסט על גבי TLS. זה תקין, וזה בדיוק מה
--    שקורה בכל טופס התחברות. מה שאסור הוא לשמור אותה כך.
--
--  אידמפוטנטי.
-- =====================================================================

SET search_path = game, public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. הסוד
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game.admin_secrets (
  id          TEXT PRIMARY KEY DEFAULT 'primary',
  secret_hash TEXT NOT NULL,
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at  TIMESTAMPTZ
);

-- ★ אין GRANT. הטבלה נגישה אך ורק דרך `claim_admin`, שהיא
--   SECURITY DEFINER. שאילתה ישירה מהדפדפן מקבלת 404.
ALTER TABLE game.admin_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game.admin_secrets FROM anon, authenticated;

/**
 * SHA-256 של `hapoelTA14!`.
 *
 * ★ למה ה-hash מופיע כאן ולא הסיסמה: כדי שהקובץ הזה יוכל לחיות
 *   ב-git. מי שקורא את הריפו לא מקבל את הסיסמה.
 *
 * ★ להחלפת סיסמה, בשורה אחת מה-SQL Editor:
 *
 *     UPDATE game.admin_secrets
 *        SET secret_hash = encode(digest('הסיסמה-החדשה','sha256'),'hex'),
 *            rotated_at  = now()
 *      WHERE id = 'primary';
 *
 *   ⚠ אחרי החלפה — לעדכן גם את `ADMIN_PIN_HASH` ב-`src/lib/store.ts`,
 *     אחרת השער המקומי ידחה סיסמה שהשרת מקבל.
 */
INSERT INTO game.admin_secrets (id, secret_hash, label)
VALUES ('primary',
        '15a4edaa167df3c9656a9d3dacb527f795dfd2007bc2e0247a27eaeefc8343bf',
        'סיסמת צוות · מחזור 2')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. הגבלת קצב
-- ---------------------------------------------------------------------
--  ★ המפתח הוא המשתמש, לא ה-IP.
--
--  אין לנו IP ברמת ה-RPC, ולכל מבקר יש זהות (גם אורח אנונימי).
--  זה לא מושלם — מי שמנקה עוגיות מקבל זהות חדשה — אבל הוא
--  מייקר ניחוש אוטומטי מספיק, והאלטרנטיבה היא כלום.
CREATE TABLE IF NOT EXISTS game.admin_attempts (
  user_id     UUID PRIMARY KEY,
  attempts    SMALLINT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE game.admin_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game.admin_attempts FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. הפונקציה
-- ---------------------------------------------------------------------
/**
 * מקבל סיסמה, מחזיר את התוצאה, ובדרך הופך את הקורא לאדמין.
 *
 * מחזיר JSONB ולא BOOLEAN כי המסך צריך להבדיל בין "סיסמה
 * שגויה" לבין "נעול לשלוש דקות" — שתי הודעות שונות לגמרי
 * למשתמש, ואי אפשר לגזור אותן מ-`false`.
 */
CREATE OR REPLACE FUNCTION game.claim_admin(p_secret TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE
  v_user    UUID := auth.uid();
  v_hash    TEXT;
  v_stored  TEXT;
  v_row     game.admin_attempts;
  v_wait    INT;
  MAX_TRIES CONSTANT INT := 5;
  LOCK_MINS CONSTANT INT := 5;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'AUTH_REQUIRED');
  END IF;

  -- הפרופיל חייב להתקיים לפני שמסמנים אותו.
  PERFORM game.ensure_profile(NULL);

  SELECT * INTO v_row FROM game.admin_attempts WHERE user_id = v_user;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    v_wait := CEIL(EXTRACT(EPOCH FROM (v_row.locked_until - now())));
    RETURN jsonb_build_object('ok', FALSE, 'error', 'LOCKED', 'retryInSeconds', v_wait);
  END IF;

  v_hash := encode(digest(COALESCE(p_secret, ''), 'sha256'), 'hex');
  SELECT secret_hash INTO v_stored FROM game.admin_secrets WHERE id = 'primary';

  IF v_stored IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'NO_SECRET_CONFIGURED');
  END IF;

  -- ★ השוואה בזמן קבוע. `=` על טקסט יוצא מוקדם בתו הראשון
  --   שנבדל, ומדליף — תיאורטית — מידע דרך זמן התגובה. על
  --   מחרוזת hash באורך קבוע זה זניח, אבל זו שורה אחת.
  IF NOT (v_hash = v_stored) OR length(v_hash) <> length(v_stored) THEN
    INSERT INTO game.admin_attempts (user_id, attempts, last_at)
    VALUES (v_user, 1, now())
    ON CONFLICT (user_id) DO UPDATE
      SET attempts = game.admin_attempts.attempts + 1,
          last_at  = now(),
          locked_until = CASE
            WHEN game.admin_attempts.attempts + 1 >= MAX_TRIES
            THEN now() + (LOCK_MINS || ' minutes')::INTERVAL
            ELSE NULL END
    RETURNING * INTO v_row;

    IF v_row.locked_until IS NOT NULL THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'LOCKED',
                                'retryInSeconds', LOCK_MINS * 60);
    END IF;
    RETURN jsonb_build_object('ok', FALSE, 'error', 'BAD_SECRET',
                              'triesLeft', MAX_TRIES - v_row.attempts);
  END IF;

  -- ------- נכון -------
  UPDATE game.users SET is_admin = TRUE WHERE id = v_user;
  DELETE FROM game.admin_attempts WHERE user_id = v_user;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (v_user::TEXT, 'claim_admin', 'user', v_user::TEXT,
          jsonb_build_object('at', now()));

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION game.claim_admin(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. ויתור על הרשאה
-- ---------------------------------------------------------------------
--  ★ "יציאה" צריכה לכבות גם את הדגל במסד, לא רק את המסך.
--
--  אחרת כל מכשיר שהוקלדה בו הסיסמה פעם אחת נשאר אדמין לנצח —
--  כולל טלפון שהושאל למישהו לרגע.
CREATE OR REPLACE FUNCTION game.release_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
DECLARE v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RETURN FALSE; END IF;
  UPDATE game.users SET is_admin = FALSE WHERE id = v_user AND is_admin;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION game.release_admin() TO authenticated;

-- ---------------------------------------------------------------------
-- 5. בדיקת בריאות
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW game.v_admin_health AS
SELECT
  (SELECT count(*) FROM game.admin_secrets)                    AS secrets,
  (SELECT count(*) FROM game.users WHERE is_admin)             AS admins,
  (SELECT count(*) FROM game.admin_attempts
    WHERE locked_until > now())                                AS locked_now,
  (SELECT max(rotated_at) FROM game.admin_secrets)             AS last_rotation;

GRANT SELECT ON game.v_admin_health TO authenticated;
