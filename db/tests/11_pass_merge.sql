-- =====================================================================
--  db/tests/11_pass_merge.sql — פדיון כרטיס בלי Edge Functions
-- =====================================================================
--
--  ★ מה נבדק כאן
--
--  הפדיון הוא הפעולה ההרסנית ביותר במוצר: הוא מזיז הרכבים,
--  זירות, ופרופיל בין שני משתמשים. יש בו שלושה סיכונים:
--
--    1. דאטה שלא עוברת — המשתמש רואה חשבון ריק אחרי שסרק את
--       הכרטיס שלו. זה בדיוק מה שהתכונה באה למנוע.
--    2. דאטה שנדרסת — המכשיר החדש מוחק משהו שהיה בו.
--    3. ★★ `is_admin` שעובר עם המפתח — כלומר צילום מסך של
--       אדמין הופך למפתח ללוח הניהול.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DELETE FROM auth.users WHERE id::TEXT LIKE 'd5000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('d5000000-0000-0000-0000-000000000001', 'old11@x.test',   TRUE),
  ('d5000000-0000-0000-0000-000000000002', 'new11@x.test',   TRUE),
  ('d5000000-0000-0000-0000-000000000003', 'admin11@x.test', FALSE);

-- מחזור פתוח
SET dubid.test_uid = 'd5000000-0000-0000-0000-000000000003';
SELECT game.ensure_profile('מנהל אחת עשרה');
SELECT game.claim_admin('hapoelTA14!');
SELECT game.admin_set_status('gw-2', 'open');
SELECT game.admin_set_deadline('gw-2', now() + interval '2 days');

-- ---------------------------------------------------------------------
-- 1. המכשיר הישן: אורח שבנה משהו
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'd5000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מאור הישן');

DO $$
DECLARE v_gw UUID; v_lineup UUID;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';

  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, formation, status, submitted_at, team_name)
  VALUES ('d5000000-0000-0000-0000-000000000001', v_gw, 'five', '2-1-1',
          'submitted', now(), 'שכונת התקווה יונייטד')
  RETURNING id INTO v_lineup;
END $$;

-- מפתח
DO $$
DECLARE v JSONB;
BEGIN
  v := game.issue_pass();
  IF length(v->>'code') <> 10 THEN
    RAISE EXCEPTION 'FAIL 1: אורך המפתח % במקום 10', length(v->>'code');
  END IF;

  /* ★ האלפבית בלי אותיות מתבלבלות — אין 0, O, 1, I.
     L נשאר בכוונה: 32 תווים הם מה ששומר על `% 32` בלי הטיה,
     ו-`1` ממילא לא קיים, ולכן אין למי להתבלבל **איתו**. */
  IF v->>'code' ~ '[01OI]' THEN
    RAISE EXCEPTION 'FAIL 1b: המפתח מכיל תו דו־משמעי (%)', v->>'code';
  END IF;

  IF v->>'pretty' !~ '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$' THEN
    RAISE EXCEPTION 'FAIL 1c: הקיבוץ שגוי (%)', v->>'pretty';
  END IF;

  /* ★ במסד יושב רק ה-hash. */
  IF EXISTS (SELECT 1 FROM game.access_codes WHERE code_hash = v->>'code') THEN
    RAISE EXCEPTION 'FAIL 1d: המפתח נשמר כטקסט גלוי';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS t_key (code TEXT);
  DELETE FROM t_key;
  INSERT INTO t_key VALUES (v->>'code');
END $$;

-- ---------------------------------------------------------------------
-- 2. ★★★ הפדיון — הדאטה עוברת למכשיר החדש ★★★
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'd5000000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('אורח חדש');

DO $$
DECLARE v JSONB; v_key TEXT; n INT;
BEGIN
  DELETE FROM game.probe_attempts;
  SELECT code INTO v_key FROM t_key;

  v := game.claim_pass(v_key);

  IF (v->>'ok')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL 2: הפדיון נכשל (%)', v;
  END IF;

  /* ההרכב עבר */
  SELECT count(*) INTO n FROM game.user_lineups
   WHERE user_id = 'd5000000-0000-0000-0000-000000000002' AND status <> 'draft';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 2b: % הרכבים במכשיר החדש במקום 1', n; END IF;

  /* ולא נשאר במקור */
  SELECT count(*) INTO n FROM game.user_lineups
   WHERE user_id = 'd5000000-0000-0000-0000-000000000001';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 2c: % הרכבים נשארו במכשיר הישן', n; END IF;

  /* ★ שם הקבוצה הוא מה שהמשתמש מזהה כשלו. */
  IF (SELECT team_name FROM game.user_lineups
       WHERE user_id = 'd5000000-0000-0000-0000-000000000002')
     <> 'שכונת התקווה יונייטד' THEN
    RAISE EXCEPTION 'FAIL 2d: שם הקבוצה לא עבר';
  END IF;

  /* שם המאמן */
  IF (SELECT display_name FROM game.users
       WHERE id = 'd5000000-0000-0000-0000-000000000002') <> 'מאור הישן' THEN
    RAISE EXCEPTION 'FAIL 2e: שם המאמן לא עבר';
  END IF;

  /* המקור מסומן כמוזג */
  IF (SELECT merged_into FROM game.users
       WHERE id = 'd5000000-0000-0000-0000-000000000001')
     <> 'd5000000-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION 'FAIL 2f: המקור לא סומן כמוזג';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. ★ הכרטיס ממשיך לעבוד אחרי הפדיון
--
--    זו כל הנקודה של מפתח חוזר: התמונה ששמורה בגלריה חייבת
--    להמשיך לעבוד. מפתח שנשרף בשימוש הראשון הופך את התמונה
--    לחסרת ערך בדיוק אחרי הפעם הראשונה.
-- ---------------------------------------------------------------------
DO $$
DECLARE v JSONB; v_key TEXT;
BEGIN
  SELECT code INTO v_key FROM t_key;
  v := game.claim_pass(v_key);
  IF (v->>'sameUser')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL 3: פדיון חוזר באותו מכשיר לא זוהה (%)', v;
  END IF;

  IF (SELECT count(*) FROM game.access_codes
       WHERE user_id = 'd5000000-0000-0000-0000-000000000002'
         AND kind = 'pass' AND revoked_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'FAIL 3b: הכרטיס לא עבר ליעד או שיש יותר מאחד';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. ★★★ `is_admin` לא עובר עם המפתח ★★★
--
--    מפתח נשלח בוואטסאפ ומצולם מהמסך. אילו הוא היה גורר הרשאת
--    ניהול, כל צילום מסך של אדמין היה מפתח ללוח הניהול.
-- ---------------------------------------------------------------------
DELETE FROM auth.users WHERE id::TEXT LIKE 'd6000000-%';
INSERT INTO auth.users (id, email, is_anonymous)
VALUES ('d6000000-0000-0000-0000-000000000001', 'victim11@x.test', TRUE);

SET dubid.test_uid = 'd5000000-0000-0000-0000-000000000003';
DO $$
DECLARE v JSONB;
BEGIN
  v := game.issue_pass();
  DELETE FROM t_key;
  INSERT INTO t_key VALUES (v->>'code');
END $$;

SET dubid.test_uid = 'd6000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מישהו');

DO $$
DECLARE v_key TEXT;
BEGIN
  DELETE FROM game.probe_attempts;
  SELECT code INTO v_key FROM t_key;
  PERFORM game.claim_pass(v_key);

  IF (SELECT is_admin FROM game.users
       WHERE id = 'd6000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL 4: הרשאת ניהול עברה דרך מפתח כרטיס';
  END IF;

  IF game.is_admin() THEN
    RAISE EXCEPTION 'FAIL 4b: המשתמש הפך לאדמין בפועל';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. מפתח שגוי, ומכסת ניחושים
-- ---------------------------------------------------------------------
DO $$
DECLARE i INT; v JSONB; blocked BOOLEAN := FALSE; bad INT := 0;
BEGIN
  DELETE FROM game.probe_attempts;

  /*
   * ★★★ הבאג שהבדיקה הזו תפסה ★★★
   *
   * הגרסה הראשונה של `claim_pass` עשתה `RAISE EXCEPTION` על
   * מפתח שגוי. `RAISE` מגלגל אחורה את הטרנזקציה — וביחד איתה
   * את השורה ש-`rate_ok` הרגע הכניסה ל-`probe_attempts`.
   *
   * כלומר כל ניחוש שגוי **מחק את הרישום של עצמו**, והמכסה
   * עבדה רק על מי שהקליד נכון. בדיוק הפוך ממה שהיא קיימת בשבילו.
   *
   * ולכן הבדיקה הזו סופרת ניסיונות אמיתיים ולא בודקת "האם
   * נזרקה שגיאה".
   */
  FOR i IN 1..14 LOOP
    v := game.claim_pass('ZZZZ' || lpad(i::TEXT, 6, '0'));
    IF v->>'error' = 'TOO_MANY_ATTEMPTS' THEN blocked := TRUE;
    ELSIF v->>'error' = 'INVALID_CODE' THEN bad := bad + 1;
    END IF;
  END LOOP;

  IF bad = 0 THEN RAISE EXCEPTION 'FAIL 5: מפתח שגוי לא נדחה'; END IF;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL 5b: 14 ניחושים עברו בלי מכסה'; END IF;

  /* ★ והראיה הישירה: הניסיונות באמת נרשמו ולא התגלגלו אחורה. */
  IF (SELECT count(*) FROM game.probe_attempts WHERE bucket = 'claim_pass') < 10 THEN
    RAISE EXCEPTION 'FAIL 5c: הניסיונות השגויים לא נרשמו — המונה מתגלגל אחורה';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6. אורך לא חוקי נדחה לפני שנוגעים במסד
-- ---------------------------------------------------------------------
DO $$
DECLARE v JSONB;
BEGIN
  DELETE FROM game.probe_attempts;
  v := game.claim_pass('ABC');
  IF v->>'error' <> 'INVALID_CODE' THEN
    RAISE EXCEPTION 'FAIL 6: מפתח קצר לא נדחה (%)', v;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 7. הדוחות לאדמין
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'd5000000-0000-0000-0000-000000000003';
DO $$
DECLARE v JSONB; s TEXT;
BEGIN
  v := game.admin_funnel();
  IF NOT (v ? 'merges') THEN RAISE EXCEPTION 'FAIL 7: אין ספירת מיזוגים'; END IF;

  /* ★ המשפך מדלג על משתמשים שמוזגו — אחרת כל פדיון היה מנפח
     את "הנכנסו" ומוריד את שיעור ההמרה בלי שקרה כלום. */
  IF (v->>'merges')::INT < 1 THEN RAISE EXCEPTION 'FAIL 7b: מיזוג לא נספר'; END IF;

  v := game.admin_daily(7);
  IF jsonb_typeof(v) <> 'array' OR jsonb_array_length(v) < 7 THEN
    RAISE EXCEPTION 'FAIL 7c: הדוח היומי ריק (%)', v;
  END IF;

  s := game.admin_leads_csv();
  IF s IS NULL OR s NOT LIKE 'email,name,consent%' THEN
    RAISE EXCEPTION 'FAIL 7d: כותרת ה-CSV שגויה (%)', left(COALESCE(s, ''), 60);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 8. הרשאות
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'd6000000-0000-0000-0000-000000000001';
DO $$
DECLARE blocked INT := 0;
BEGIN
  BEGIN PERFORM game.admin_leads_csv();
  EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;
  BEGIN PERFORM game.admin_daily(7);
  EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;

  IF blocked <> 2 THEN
    RAISE EXCEPTION 'FAIL 8: רק % מתוך 2 דוחות חסומים', blocked;
  END IF;
END $$;

-- ניקוי
DELETE FROM game.access_codes WHERE user_id::TEXT LIKE 'd5000000-%'
                                 OR user_id::TEXT LIKE 'd6000000-%';
DELETE FROM game.user_lineups WHERE user_id::TEXT LIKE 'd5000000-%'
                                 OR user_id::TEXT LIKE 'd6000000-%';
DELETE FROM game.probe_attempts;
DROP TABLE IF EXISTS t_key;

SELECT '11_pass_merge · OK' AS result;
