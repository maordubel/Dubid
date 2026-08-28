-- =====================================================================
--  db/tests/10_guest_pass.sql — כרטיס המנוי ולכידת לידים
-- =====================================================================
--
--  ★ מה נבדק כאן, ולמה דווקא זה
--
--  שלושה סיכונים, וכולם שקטים:
--
--    1. מפתח קבוע שנשרף בשימוש — התמונה ששמורה בגלריה מפסיקה
--       לעבוד, והמשתמש מגלה את זה כשהוא מחליף טלפון.
--    2. שני מפתחות פעילים לאותו אדם — כל לחיצה מייצרת עוד אחד,
--       ומשטח התקיפה גדל בכל ביקור.
--    3. ליד שנשמר בלי הסכמה, או ליד שאי אפשר למחוק.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DELETE FROM auth.users WHERE id::TEXT LIKE 'd4000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('d4000000-0000-0000-0000-000000000001', 'guest10@x.test', TRUE),
  ('d4000000-0000-0000-0000-000000000002', 'admin10@x.test', FALSE);

SET dubid.test_uid = 'd4000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('אורח עשר');

-- ---------------------------------------------------------------------
-- 1. שני סוגים באותה טבלה, וכל אחד עם הכללים שלו
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- מפתח קבוע: מותר לו להיות בלי תפוגה
  INSERT INTO game.access_codes (code_hash, user_id, kind, expires_at)
  VALUES ('hash-pass-1', 'd4000000-0000-0000-0000-000000000001', 'pass', NULL);

  -- ★ קוד העברה בלי תפוגה — חייב להיחסם.
  --   קוד "זמני" שחי לנצח הוא בדיוק הבאג שהעמודה קיימת למנוע.
  BEGIN
    INSERT INTO game.access_codes (code_hash, user_id, kind, expires_at)
    VALUES ('hash-bad', 'd4000000-0000-0000-0000-000000000001', 'transfer', NULL);
    RAISE EXCEPTION 'FAIL 1: קוד העברה בלי תפוגה התקבל';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- סוג לא מוכר
  BEGIN
    INSERT INTO game.access_codes (code_hash, user_id, kind, expires_at)
    VALUES ('hash-x', 'd4000000-0000-0000-0000-000000000001', 'magic', now() + interval '1 hour');
    RAISE EXCEPTION 'FAIL 1b: סוג לא מוכר התקבל';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- ---------------------------------------------------------------------
-- 2. ★★ מפתח פעיל אחד לכל משתמש ★★
--
--    בלי האילוץ הזה כל לחיצה על "הראה לי את הכרטיס" מוסיפה
--    מפתח נוסף. המשתמש היה מחזיק בגלריה חמש תמונות שכולן
--    עובדות — בלגן, וגם משטח תקיפה שגדל בכל ביקור.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO game.access_codes (code_hash, user_id, kind, expires_at)
    VALUES ('hash-pass-2', 'd4000000-0000-0000-0000-000000000001', 'pass', NULL);
    RAISE EXCEPTION 'FAIL 2: שני מפתחות פעילים לאותו משתמש';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- ★ אבל אחרי ביטול — כן. זו בדיוק ההנפקה מחדש.
  UPDATE game.access_codes SET revoked_at = now()
   WHERE code_hash = 'hash-pass-1';

  INSERT INTO game.access_codes (code_hash, user_id, kind, expires_at)
  VALUES ('hash-pass-2', 'd4000000-0000-0000-0000-000000000001', 'pass', NULL);

  IF (SELECT count(*) FROM game.access_codes
       WHERE user_id = 'd4000000-0000-0000-0000-000000000001'
         AND kind = 'pass' AND revoked_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'FAIL 2b: אחרי הנפקה מחדש אין בדיוק מפתח פעיל אחד';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. מצב הכרטיס — בלי לחשוף את המפתח עצמו
-- ---------------------------------------------------------------------
DO $$
DECLARE v JSONB;
BEGIN
  v := game.my_pass_state();
  IF (v->>'has')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL 3: הכרטיס לא מזוהה (%)', v;
  END IF;

  /* ★★ הבדיקה החשובה כאן: המפתח **לא** חוזר.
     במסד יושב רק ה-hash, וזו ההחלטה — מי שמשיג גישה לטבלה לא
     יכול להתחזות לאיש. פונקציה שמחזירה קוד כלשהו היא באג. */
  IF v::TEXT ILIKE '%hash-pass%' OR v ? 'code' THEN
    RAISE EXCEPTION 'FAIL 3b: מצב הכרטיס מחזיר את המפתח (%)', v;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. לידים — הסכמה, עדכון, ומחיקה
-- ---------------------------------------------------------------------
DO $$
DECLARE v JSONB; n INT;
BEGIN
  DELETE FROM game.probe_attempts;

  PERFORM game.capture_lead('Maor@DubelTeam.com', FALSE, 'pass', 'gw-2');

  SELECT count(*) INTO n FROM game.leads
   WHERE user_id = 'd4000000-0000-0000-0000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 4: הליד לא נשמר'; END IF;

  /* ★ הסכמה כבויה נשמרת ככבויה.
     זה המקום היחיד שבו קל מאוד "לשפר" את המספרים בשקט — ולכן
     יש כאן בדיקה. */
  IF (SELECT consent FROM game.leads
       WHERE user_id = 'd4000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL 4b: הסכמה נשמרה כדולקת למרות שנשלחה כבויה';
  END IF;

  /* אותו אדם שמקליד שוב הוא ליד אחד ששינה דעתו, לא שניים. */
  PERFORM game.capture_lead('maor@dubelteam.com', TRUE, 'account', 'gw-2');
  SELECT count(*) INTO n FROM game.leads
   WHERE user_id = 'd4000000-0000-0000-0000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 4c: הקלדה שנייה יצרה שורה כפולה'; END IF;

  IF NOT (SELECT consent FROM game.leads
           WHERE user_id = 'd4000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL 4d: ההסכמה לא התעדכנה';
  END IF;

  v := game.my_lead();
  IF (v->>'email') IS NULL THEN RAISE EXCEPTION 'FAIL 4e: my_lead ריק'; END IF;

  -- כתובת פגומה נדחית
  BEGIN
    PERFORM game.capture_lead('לא מייל', FALSE, 'pass', NULL);
    RAISE EXCEPTION 'FAIL 4f: כתובת פגומה התקבלה';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%EMAIL_INVALID%' THEN RAISE; END IF;
  END;
END $$;

-- ---------------------------------------------------------------------
-- 5. ★ "תשכחו אותי" עובד — וזה מה שהופך את ההשארה להפיכה
-- ---------------------------------------------------------------------
DO $$
DECLARE n INT;
BEGIN
  PERFORM game.forget_me();
  SELECT count(*) INTO n FROM game.leads
   WHERE user_id = 'd4000000-0000-0000-0000-000000000001';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 5: הליד לא נמחק'; END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6. מכסה על לכידת לידים
-- ---------------------------------------------------------------------
--
--  ★ `capture_lead` פתוחה לכל מחובר, ו-`signInAnonymously` הוא
--    חינם. בלי מכסה זו דלת להצפת הטבלה.
-- ---------------------------------------------------------------------
DO $$
DECLARE i INT; blocked BOOLEAN := FALSE;
BEGIN
  DELETE FROM game.probe_attempts;

  FOR i IN 1..9 LOOP
    BEGIN
      PERFORM game.capture_lead('x' || i || '@y.com', FALSE, 'pass', NULL);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%TOO_MANY%' THEN blocked := TRUE; END IF;
    END;
  END LOOP;

  IF NOT blocked THEN RAISE EXCEPTION 'FAIL 6: תשע לכידות ברצף עברו בלי מכסה'; END IF;
  PERFORM game.forget_me();
END $$;

-- ---------------------------------------------------------------------
-- 7. הרשאות — משתמש רגיל לא רואה לידים של אחרים
-- ---------------------------------------------------------------------
DO $$
DECLARE blocked INT := 0;
BEGIN
  BEGIN PERFORM game.admin_leads(10);
  EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;

  BEGIN PERFORM game.admin_funnel();
  EXCEPTION WHEN OTHERS THEN blocked := blocked + 1; END;

  IF blocked <> 2 THEN
    RAISE EXCEPTION 'FAIL 7: רק % מתוך 2 פונקציות ניהול חסומות', blocked;
  END IF;

  /* ★ וגם ישירות: הטבלה סגורה לחלוטין. */
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM game.leads LIMIT 1;
    RESET ROLE;
    RAISE EXCEPTION 'FAIL 7b: anon קורא את טבלת הלידים';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;
END $$;

-- ---------------------------------------------------------------------
-- 8. הצד של האדמין עובד
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'd4000000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('מנהל עשר');
SELECT game.claim_admin('hapoelTA14!');

DO $$
DECLARE v JSONB;
BEGIN
  v := game.admin_funnel();
  IF (v->>'users')::INT < 1 THEN RAISE EXCEPTION 'FAIL 8: המשפך ריק (%)', v; END IF;
  IF NOT (v ? 'withPass') THEN RAISE EXCEPTION 'FAIL 8b: אין ספירת מפתחות'; END IF;

  v := game.admin_leads(10);
  IF jsonb_typeof(v) <> 'array' THEN RAISE EXCEPTION 'FAIL 8c: admin_leads לא מערך'; END IF;
END $$;

-- ניקוי
DELETE FROM game.access_codes
 WHERE user_id::TEXT LIKE 'd4000000-%';
DELETE FROM game.probe_attempts;

SELECT '10_guest_pass · OK' AS result;
