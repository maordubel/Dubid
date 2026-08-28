-- =====================================================================
--  db/tests/12_profile.sql — פרופיל המאמן ומצב החשבון
-- =====================================================================
--
--  ★ מה נבדק כאן, ולמה
--
--  התלונה שהובילה למיגרציות 21–22 הייתה "התחברתי ולא קרה כלום".
--  היא נבעה משני דברים שאי אפשר לראות בעין:
--
--    1. `is_guest` נגזר משדה אחד (`is_anonymous`) שלא בהכרח
--       מתעדכן בקישור זהות — ולכן משתמש שחיבר גוגל נשאר "אורח".
--    2. הפרופיל לא החזיר היסטוריה, ולכן המסך נראה ריק גם כשיש
--       דאטה.
--
--  שתיהן נראות כמו "המוצר לא עובד" ואף אחת מהן לא זורקת שגיאה.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DELETE FROM auth.users WHERE id::TEXT LIKE 'd7000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('d7000000-0000-0000-0000-000000000001', NULL,               TRUE),
  ('d7000000-0000-0000-0000-000000000002', 'real12@x.test',    FALSE),
  ('d7000000-0000-0000-0000-000000000003', 'admin12@x.test',   FALSE);

-- מחזור פתוח
SET dubid.test_uid = 'd7000000-0000-0000-0000-000000000003';
SELECT game.ensure_profile('מנהל שתים עשרה');
SELECT game.claim_admin('hapoelTA14!');
SELECT game.admin_set_status('gw-2', 'open');
SELECT game.admin_set_deadline('gw-2', now() + interval '2 days');

-- ---------------------------------------------------------------------
-- 1. ★★ אורח הוא אורח, ומי שיש לו מייל — לא ★★
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT game.auth_is_guest('d7000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL 1: משתמש אנונימי בלי מייל דווח כרשום';
  END IF;

  /* ★ זה הלב של התיקון.
     משתמש עם מייל הוא **לא** אורח, גם אם `is_anonymous` היה
     נשאר TRUE משום מה. שלוש בדיקות ב-OR, ולא אחת. */
  IF game.auth_is_guest('d7000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'FAIL 1b: משתמש עם מייל דווח כאורח';
  END IF;

  /* משתמש שלא קיים בכלל */
  IF NOT game.auth_is_guest('00000000-0000-0000-0000-000000000000') THEN
    RAISE EXCEPTION 'FAIL 1c: משתמש לא קיים לא דווח כאורח';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. ★★★ הבאג המרכזי: מייל שנוסף אחרי ההרשמה ★★★
--
--    זה בדיוק מה שקורה בשדרוג אורח: השורה ב-`game.users` כבר
--    קיימת עם `is_guest = TRUE`, ורק אז מתווסף המייל.
--    `ensure_profile` חייבת להבחין בזה בקריאה הבאה.
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'd7000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מאור האורח');

DO $$
BEGIN
  IF NOT (SELECT is_guest FROM game.users
           WHERE id = 'd7000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL 2: אורח נוצר כרשום';
  END IF;
END $$;

-- המשתמש משדרג: מתווסף לו מייל (כמו אחרי אימות או קישור גוגל)
UPDATE auth.users SET email = 'upgraded12@x.test', is_anonymous = FALSE
 WHERE id = 'd7000000-0000-0000-0000-000000000001';

SELECT game.ensure_profile(NULL);

DO $$
DECLARE v RECORD;
BEGIN
  SELECT is_guest, registered_at, email INTO v
    FROM game.users WHERE id = 'd7000000-0000-0000-0000-000000000001';

  IF v.is_guest THEN
    RAISE EXCEPTION 'FAIL 2b: אחרי שדרוג המשתמש עדיין מדווח כאורח — זה הבאג המקורי';
  END IF;
  IF v.registered_at IS NULL THEN
    RAISE EXCEPTION 'FAIL 2c: לא נרשם מועד ההרשמה';
  END IF;
  IF v.email IS NULL THEN
    RAISE EXCEPTION 'FAIL 2d: המייל לא הועתק לפרופיל';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. ★ ובכיוון אחד בלבד — רשום לא חוזר להיות אורח
-- ---------------------------------------------------------------------
DO $$
BEGIN
  /* מדמים תשובה חלקית: המייל נעלם מ-`auth` (למשל שגיאת רשת
     שהחזירה שורה ריקה). המשתמש חייב להישאר רשום. */
  UPDATE auth.users SET email = NULL, is_anonymous = TRUE
   WHERE id = 'd7000000-0000-0000-0000-000000000001';

  PERFORM game.ensure_profile(NULL);

  IF (SELECT is_guest FROM game.users
       WHERE id = 'd7000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL 3: משתמש רשום הוחזר להיות אורח';
  END IF;

  UPDATE auth.users SET email = 'upgraded12@x.test', is_anonymous = FALSE
   WHERE id = 'd7000000-0000-0000-0000-000000000001';
END $$;

-- ---------------------------------------------------------------------
-- 4. הפרופיל מחזיר היסטוריה אמיתית
-- ---------------------------------------------------------------------
DO $$
DECLARE v_gw UUID;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';

  INSERT INTO game.user_lineups
    (user_id, gameweek_id, mode, formation, status, submitted_at, team_name)
  VALUES ('d7000000-0000-0000-0000-000000000001', v_gw, 'five', '2-1-1',
          'submitted', now(), 'שכונת התקווה יונייטד')
  ON CONFLICT (user_id, gameweek_id, mode) DO UPDATE
    SET team_name = 'שכונת התקווה יונייטד', status = 'submitted';
END $$;

DO $$
DECLARE v JSONB; h JSONB;
BEGIN
  v := game.my_profile();

  IF (v->>'played')::INT <> 1 THEN
    RAISE EXCEPTION 'FAIL 4: הפרופיל מדווח % הגשות במקום 1', v->>'played';
  END IF;
  IF (v->>'isGuest')::BOOLEAN THEN
    RAISE EXCEPTION 'FAIL 4b: הפרופיל מדווח אורח אחרי שדרוג';
  END IF;

  h := v->'history';
  IF jsonb_array_length(h) <> 1 THEN
    RAISE EXCEPTION 'FAIL 4c: ההיסטוריה ריקה — המסך ייראה ריק גם כשיש דאטה';
  END IF;

  IF (h->0->>'teamName') <> 'שכונת התקווה יונייטד' THEN
    RAISE EXCEPTION 'FAIL 4d: שם הקבוצה לא מופיע בהיסטוריה';
  END IF;

  /* ★★ מחזור שלא נוקד מחזיר NULL ולא 0.
     אפס נראה כמו כישלון; ריק נראה כמו "עוד לא". במסך שכל
     תפקידו לגרום למישהו להרגיש טוב עם מה שבנה, זה כל ההבדל. */
  IF (h->0->'points') <> 'null'::JSONB THEN
    RAISE EXCEPTION 'FAIL 4e: מחזור שלא נוקד מחזיר % במקום null', h->0->'points';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. אווטאר
-- ---------------------------------------------------------------------
DO $$
DECLARE v JSONB;
BEGIN
  PERFORM game.set_avatar('🦁');
  v := game.my_profile();
  IF (v->>'avatar') <> '🦁' THEN
    RAISE EXCEPTION 'FAIL 5: האווטאר לא נשמר (%)', v->>'avatar';
  END IF;

  /* ★ שדה חופשי בפרופיל הוא בדיוק המקום שבו מישהו מדביק אלף
     תווים. הקיצוץ הוא במסד ולא רק בטופס. */
  PERFORM game.set_avatar(repeat('x', 500));
  v := game.my_profile();
  IF length(v->>'avatar') > 8 THEN
    RAISE EXCEPTION 'FAIL 5b: אווטאר ארוך מדי התקבל (% תווים)', length(v->>'avatar');
  END IF;

  PERFORM game.set_avatar('🦁');
END $$;

-- ---------------------------------------------------------------------
-- 6. `me()` נשארת רזה — בלי מייל
-- ---------------------------------------------------------------------
DO $$
DECLARE m JSONB;
BEGIN
  m := game.me();
  /* ★ החלטה קיימת שנשמרת: `me()` רצה בכל עלייה של האפליקציה.
     המייל שייך ל-`my_profile()`, שנקראת רק כשפותחים את הפרופיל. */
  IF m ? 'email' THEN RAISE EXCEPTION 'FAIL 6: me() מחזיר מייל'; END IF;
  IF NOT (m ? 'provider') THEN RAISE EXCEPTION 'FAIL 6b: me() לא מחזיר provider'; END IF;
  IF (m->>'isGuest')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 6c: me() מדווח אורח'; END IF;
END $$;

-- ---------------------------------------------------------------------
-- 7. הרשאות
-- ---------------------------------------------------------------------
DO $$
DECLARE v JSONB;
BEGIN
  /* ★ הפרופיל מחזיר **רק את שלי**. */
  v := game.my_profile();
  IF (v->>'displayName') NOT IN ('מאור האורח') THEN
    RAISE EXCEPTION 'FAIL 7: הפרופיל מחזיר משתמש אחר (%)', v->>'displayName';
  END IF;

  BEGIN
    SET LOCAL ROLE anon;
    PERFORM game.my_profile();
    RESET ROLE;
    RAISE EXCEPTION 'FAIL 7b: אנונימי בלי סשן קיבל פרופיל';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    RESET ROLE;
  END;
END $$;

-- ניקוי
DELETE FROM game.user_lineups WHERE user_id::TEXT LIKE 'd7000000-%';


-- ---------------------------------------------------------------------
-- 8. ★★★ "החשבון כבר קיים" — התרחיש שנשבר ★★★
-- ---------------------------------------------------------------------
--
--  אורח בנה הרכב, ואז לחץ "התחבר עם גוגל" — עם חשבון גוגל
--  ש**כבר** מוכר למערכת. הגישה הישנה (`linkIdentity`) נכשלה
--  כאן, והמשתמש נתקע.
--
--  הגישה החדשה: נכנסים לחשבון הקיים, ואז גוררים אליו את מה
--  שהאורח בנה. הבדיקה הזו מריצה בדיוק את זה.
-- ---------------------------------------------------------------------
DELETE FROM auth.users WHERE id::TEXT LIKE 'd8000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('d8000000-0000-0000-0000-000000000001', NULL,             TRUE),   -- האורח
  ('d8000000-0000-0000-0000-000000000002', 'exists@x.test',  FALSE);  -- החשבון הקיים

SET dubid.test_uid = 'd8000000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('מאור הרשום');

-- האורח בונה משהו
SET dubid.test_uid = 'd8000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('אורח עם הרכב');

DO $$
DECLARE v_gw UUID;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  INSERT INTO game.user_lineups
    (user_id, gameweek_id, mode, formation, status, submitted_at, team_name)
  VALUES ('d8000000-0000-0000-0000-000000000001', v_gw, 'full', '4-3-3',
          'submitted', now(), 'הקבוצה של האורח')
  ON CONFLICT (user_id, gameweek_id, mode) DO UPDATE SET status = 'submitted';

  /* ★ `has_anything` היא מה שמונע הנפקת אסימון מיותרת לכל מי
     שנכנס ולא עשה כלום — וזה הרוב. */
  IF NOT game.has_anything() THEN
    RAISE EXCEPTION 'FAIL 8: has_anything לא מזהה הרכב קיים';
  END IF;
END $$;

-- לפני היציאה לגוגל: מנפיקים אסימון העברה
DO $$
DECLARE v_token TEXT;
BEGIN
  v_token := game.issue_merge_token();
  IF length(v_token) <> 10 THEN
    RAISE EXCEPTION 'FAIL 8b: אסימון באורך % במקום 10', length(v_token);
  END IF;

  /* ★★ הנפקת אסימון העברה **לא** נוגעת בכרטיס המנוי.
     אילו היא הייתה מבטלת אותו, כל לחיצה על "התחבר עם גוגל"
     הייתה הורגת בשקט את התמונה ששמרנו למשתמש בגלריה. */
  PERFORM game.issue_pass();
  PERFORM game.issue_merge_token();
  IF (SELECT count(*) FROM game.access_codes
       WHERE user_id = 'd8000000-0000-0000-0000-000000000001'
         AND kind = 'pass' AND revoked_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'FAIL 8c: אסימון ההעברה ביטל את כרטיס המנוי';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS t_merge (code TEXT);
  DELETE FROM t_merge;
  INSERT INTO t_merge VALUES (game.issue_merge_token());
END $$;

-- ...ואז נכנסים לחשבון ה**קיים** ופודים
SET dubid.test_uid = 'd8000000-0000-0000-0000-000000000002';
DO $$
DECLARE v JSONB; v_token TEXT; n INT;
BEGIN
  DELETE FROM game.probe_attempts;
  SELECT code INTO v_token FROM t_merge;

  v := game.claim_pass(v_token);
  IF (v->>'ok')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL 8d: המיזוג נכשל (%)', v;
  END IF;

  /* ההרכב של האורח עבר לחשבון הקיים */
  SELECT count(*) INTO n FROM game.user_lineups
   WHERE user_id = 'd8000000-0000-0000-0000-000000000002' AND status <> 'draft';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 8e: % הרכבים בחשבון הקיים במקום 1', n;
  END IF;

  IF (SELECT team_name FROM game.user_lineups
       WHERE user_id = 'd8000000-0000-0000-0000-000000000002')
     <> 'הקבוצה של האורח' THEN
    RAISE EXCEPTION 'FAIL 8f: שם הקבוצה לא עבר';
  END IF;

  /* ★ והחשבון הקיים נשאר רשום — לא הפך לאורח בגלל המיזוג. */
  IF (SELECT is_guest FROM game.users
       WHERE id = 'd8000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'FAIL 8g: החשבון הרשום הפך לאורח אחרי המיזוג';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 9. אסימון העברה הוא חד־פעמי
-- ---------------------------------------------------------------------
DO $$
DECLARE v JSONB; v_token TEXT;
BEGIN
  DELETE FROM game.probe_attempts;
  SELECT code INTO v_token FROM t_merge;

  /* ★ פדיון שני של אותו אסימון חייב להיכשל. אסימון שנשאר תקף
     הוא מפתח כניסה שמסתובב ב-sessionStorage בלי סיבה. */
  v := game.claim_pass(v_token);
  IF (v->>'ok')::BOOLEAN IS TRUE AND (v->>'sameUser')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL 9: אסימון ההעברה נפדה פעמיים';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 10. ★★★ פדיון מוקדם מדי לא שורף את האסימון ★★★
-- ---------------------------------------------------------------------
--
--  ★ הבאג שזה נועל.
--
--  האפליקציה מנסה למזג גם בעלייה הרגילה, כי לשונית שנטענה
--  מחדש אחרי החזרה מגוגל לא בהכרח מקבלת אירוע התחברות.
--
--  אבל הסשן של גוגל נקלט **אסינכרונית**. יש חלון קצר שבו
--  `auth.uid()` הוא עדיין האורח הישן — ואז הפדיון מתבצע
--  "על עצמו".
--
--  אם המצב הזה היה מסמן את האסימון כנפדה, המיזוג האמיתי —
--  זה שקורה שנייה אחר כך — היה מגיע בלי מפתח, והמשתמש היה
--  מתחבר לחשבון ריק בלי שאיש ידע למה.
--
--  ולכן: `sameUser` הוא לא־אירוע. הוא לא פודה, לא מבטל,
--  ולא נוגע בכלום.
-- ---------------------------------------------------------------------
DELETE FROM auth.users WHERE id::TEXT LIKE 'd9000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('d9000000-0000-0000-0000-000000000001', NULL,            TRUE),
  ('d9000000-0000-0000-0000-000000000002', 'later@x.test',  FALSE);

SET dubid.test_uid = 'd9000000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('החשבון האמיתי');

SET dubid.test_uid = 'd9000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('אורח ממתין');

DO $$
DECLARE v_gw UUID; v JSONB; v_token TEXT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  INSERT INTO game.user_lineups
    (user_id, gameweek_id, mode, formation, status, submitted_at, team_name)
  VALUES ('d9000000-0000-0000-0000-000000000001', v_gw, 'five', '2-2',
          'submitted', now(), 'ממתין למיזוג')
  ON CONFLICT (user_id, gameweek_id, mode) DO UPDATE SET status = 'submitted';

  DELETE FROM game.probe_attempts;
  CREATE TEMP TABLE IF NOT EXISTS t_early (code TEXT);
  DELETE FROM t_early;
  INSERT INTO t_early VALUES (game.issue_merge_token());
  SELECT code INTO v_token FROM t_early;

  /* ---- הפדיון המוקדם: עדיין האורח ---- */
  v := game.claim_pass(v_token);
  IF (v->>'sameUser')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL 10: פדיון על אותו משתמש לא זוהה כ-sameUser (%)', v;
  END IF;

  /* ★ והאסימון **עדיין לא** סומן כנפדה. */
  IF EXISTS (SELECT 1 FROM game.access_codes
              WHERE user_id = 'd9000000-0000-0000-0000-000000000001'
                AND kind = 'transfer' AND redeemed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL 10b: פדיון מוקדם שרף את האסימון';
  END IF;
END $$;

-- ...ורגע אחר כך הסשן האמיתי נקלט, ואותו אסימון עובד
SET dubid.test_uid = 'd9000000-0000-0000-0000-000000000002';
DO $$
DECLARE v JSONB; v_token TEXT; n INT;
BEGIN
  DELETE FROM game.probe_attempts;
  SELECT code INTO v_token FROM t_early;

  v := game.claim_pass(v_token);
  IF (v->>'ok')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL 10c: המיזוג המאוחר נכשל (%)', v;
  END IF;

  SELECT count(*) INTO n FROM game.user_lineups
   WHERE user_id = 'd9000000-0000-0000-0000-000000000002'
     AND team_name = 'ממתין למיזוג';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 10d: ההרכב לא הגיע לחשבון האמיתי (% שורות)', n;
  END IF;
END $$;
\echo '  ✓ 10 פדיון לפני שהסשן נקלט — לא שורף את האסימון'

DELETE FROM game.user_lineups WHERE user_id::TEXT LIKE 'd9000000-%';
DELETE FROM game.access_codes WHERE user_id::TEXT LIKE 'd9000000-%';
DELETE FROM auth.users        WHERE id::TEXT      LIKE 'd9000000-%';
DROP TABLE IF EXISTS t_early;

DELETE FROM game.user_lineups WHERE user_id::TEXT LIKE 'd8000000-%';
DELETE FROM game.access_codes WHERE user_id::TEXT LIKE 'd8000000-%';
DELETE FROM game.probe_attempts;
DROP TABLE IF EXISTS t_merge;

SELECT '12_profile · OK' AS result;
