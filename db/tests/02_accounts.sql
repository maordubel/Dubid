-- =====================================================================
--  db/tests/02_accounts.sql — הרשמה, אורחים, והתנגשות שמות
--
--  ★ הבדיקה המרכזית כאן היא §2: השחזור המדויק של הבאג שמתואר
--    ב-`DUBIDAUTHSYNC.md` §8. הוא לא תיאורטי — הוא שוחזר על
--    PostgreSQL, והוא היה מונע מהמשתמש השלישי להירשם בכלל.
--
--  הרצה (אחרי 00_supabase_shim + 01→10):
--    psql -d dubid_test -v ON_ERROR_STOP=1 -f db/tests/02_accounts.sql
-- =====================================================================

\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

-- ---------------------------------------------------------------------
-- ניקוי — כדי שהקובץ ירוץ שוב ושוב, ובכל סדר
-- ---------------------------------------------------------------------
--  ★ בדיקה שאפשר להריץ רק פעם אחת על מסד נקי היא בדיקה שלא
--    מריצים. המשתמשים כאן נמחקים בתחילת הריצה, וה-CASCADE מוריד
--    איתם את ההרכבים והפרופילים.
DELETE FROM auth.users WHERE id::TEXT LIKE '%-0000-0000-0000-%'
                          OR id IN ('11111111-1111-1111-1111-111111111111',
                                    '22222222-2222-2222-2222-222222222222');

-- ---------------------------------------------------------------------
-- 1. אורח — בלי מייל, בלי שם, בלי כלום
-- ---------------------------------------------------------------------
INSERT INTO auth.users (id, email, is_anonymous)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', NULL, TRUE);

SET dubid.test_uid = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT game.ensure_profile();

DO $$
DECLARE u game.users;
BEGIN
  SELECT * INTO u FROM game.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  IF NOT u.is_guest          THEN RAISE EXCEPTION 'FAIL 1: אורח לא סומן כאורח'; END IF;
  IF u.username IS NULL      THEN RAISE EXCEPTION 'FAIL 1b: אורח בלי שם משתמש'; END IF;
  IF u.referral_code IS NULL THEN RAISE EXCEPTION 'FAIL 1c: אין קוד הפניה'; END IF;
  IF u.registered_at IS NOT NULL THEN RAISE EXCEPTION 'FAIL 1d: אורח סומן כרשום'; END IF;
END $$;
\echo '  ✓ 1  אורח נכנס בלי שום שדה — ומקבל פרופיל תקין'

-- ---------------------------------------------------------------------
-- 2. ★★ התנגשות שמות — השחזור מ-DUBIDAUTHSYNC §8 ★★
-- ---------------------------------------------------------------------
--  שלושה משתמשים, אותו חלק לפני ה-@, ושניים מהם חולקים את ארבעת
--  התווים הראשונים של ה-UUID. במסמך המקור השלישי **נכשל**.
INSERT INTO auth.users (id, email, is_anonymous, raw_user_meta_data) VALUES
  ('4336d23f-0000-0000-0000-000000000001', 'info@alpha.com', FALSE, '{}'),
  ('11111111-0000-0000-0000-000000000002', 'info@beta.com',  FALSE, '{}'),
  ('1111aaaa-0000-0000-0000-000000000003', 'info@gamma.com', FALSE, '{}');

SET dubid.test_uid = '4336d23f-0000-0000-0000-000000000001'; SELECT game.ensure_profile();
SET dubid.test_uid = '11111111-0000-0000-0000-000000000002'; SELECT game.ensure_profile();
SET dubid.test_uid = '1111aaaa-0000-0000-0000-000000000003'; SELECT game.ensure_profile();

DO $$
DECLARE n INT; names TEXT;
BEGIN
  SELECT count(*) INTO n FROM game.users
   WHERE email IN ('info@alpha.com','info@beta.com','info@gamma.com');
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 2: רק % מתוך 3 נרשמו', n; END IF;

  SELECT count(*) - count(DISTINCT username) INTO n FROM game.users;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 2b: % שמות כפולים', n; END IF;

  SELECT string_agg(username::TEXT, ' · ' ORDER BY email) INTO names
    FROM game.users WHERE email LIKE 'info@%';
  RAISE NOTICE '      %', names;
END $$;
\echo '  ✓ 2  שלוש הרשמות עם אותו חלק־מייל — שלושתן עוברות, אפס כפילויות'

-- ---------------------------------------------------------------------
-- 3. שם מהטופס נשמר תו-בתו כשהוא פנוי
-- ---------------------------------------------------------------------
INSERT INTO auth.users (id, email, is_anonymous, raw_user_meta_data) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'maor@example.com', FALSE,
   '{"username":"מלך_הקרנות","avatar":"👑","referred_by_code":"ABC12345"}'::jsonb);

SET dubid.test_uid = 'bbbbbbbb-0000-0000-0000-000000000001';
SELECT game.ensure_profile();

DO $$
DECLARE u game.users;
BEGIN
  SELECT * INTO u FROM game.users WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF u.username::TEXT <> 'מלך_הקרנות' THEN
    RAISE EXCEPTION 'FAIL 3: שם עברי פנוי לא נשמר כמו שהוא — התקבל %', u.username;
  END IF;
  IF u.avatar <> '👑'                THEN RAISE EXCEPTION 'FAIL 3b: אווטאר לא נשמר'; END IF;
  IF u.referred_by_code <> 'ABC12345' THEN RAISE EXCEPTION 'FAIL 3c: קוד הפניה לא נשמר'; END IF;
  IF u.is_guest                      THEN RAISE EXCEPTION 'FAIL 3d: משתמש רשום סומן כאורח'; END IF;
  IF u.registered_at IS NULL         THEN RAISE EXCEPTION 'FAIL 3e: אין חותמת הרשמה'; END IF;
END $$;
\echo '  ✓ 3  שם בעברית + אווטאר + קוד הפניה — נשמרים מהטופס, בלי סינון תווים'

-- ---------------------------------------------------------------------
-- 4. אותו שם, משתמש אחר → סיומת, לא שגיאה
-- ---------------------------------------------------------------------
INSERT INTO auth.users (id, email, is_anonymous, raw_user_meta_data) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'other@example.com', FALSE,
   '{"username":"מלך_הקרנות"}'::jsonb);

SET dubid.test_uid = 'cccccccc-0000-0000-0000-000000000001';
SELECT game.ensure_profile();

DO $$
DECLARE u game.users;
BEGIN
  SELECT * INTO u FROM game.users WHERE id = 'cccccccc-0000-0000-0000-000000000001';
  IF u.username::TEXT = 'מלך_הקרנות' THEN RAISE EXCEPTION 'FAIL 4: שם כפול התקבל'; END IF;
  IF u.username::TEXT NOT LIKE 'מלך_הקרנות_%' THEN
    RAISE EXCEPTION 'FAIL 4b: הסיומת לא נגזרה מהשם — התקבל %', u.username;
  END IF;
  -- ★ השם המקורי לא נגע. מי שהיה ראשון שומר על השם שלו.
  IF (SELECT username::TEXT FROM game.users
       WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001') <> 'מלך_הקרנות' THEN
    RAISE EXCEPTION 'FAIL 4c: השם של המשתמש הראשון השתנה';
  END IF;
END $$;
\echo '  ✓ 4  שם תפוס → סיומת מה-PK. הראשון שומר על שמו'

-- ---------------------------------------------------------------------
-- 5. רגישות רישיות — 'Maor' ו-'maor' הם אותו שם
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF game.username_available('MELECH') <> TRUE THEN RAISE EXCEPTION 'FAIL 5: שם פנוי דווח כתפוס'; END IF;
  IF game.username_available('מלך_הקרנות') <> FALSE THEN RAISE EXCEPTION 'FAIL 5b: שם תפוס דווח כפנוי'; END IF;
  IF game.username_available('ab')  <> FALSE THEN RAISE EXCEPTION 'FAIL 5c: שם קצר מדי התקבל'; END IF;
  IF game.username_available('   ') <> FALSE THEN RAISE EXCEPTION 'FAIL 5d: רווחים בלבד התקבלו'; END IF;
END $$;
\echo '  ✓ 5  username_available — קצר, ריק, ותפוס נדחים'

-- ---------------------------------------------------------------------
-- 6. `game.me()` לא מחזיר מייל
-- ---------------------------------------------------------------------
SET dubid.test_uid = 'bbbbbbbb-0000-0000-0000-000000000001';
DO $$
DECLARE m JSONB;
BEGIN
  m := game.me();
  IF m ? 'email' THEN RAISE EXCEPTION 'FAIL 6: game.me() מחזיר מייל'; END IF;
  IF (m->>'isGuest')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 6b: משתמש רשום מדווח כאורח'; END IF;
  IF (m->>'username') <> 'מלך_הקרנות' THEN RAISE EXCEPTION 'FAIL 6c: שם משתמש שגוי'; END IF;
END $$;
\echo '  ✓ 6  game.me() מחזיר מצב חשבון — ולא מייל'

-- ---------------------------------------------------------------------
-- 7. אורח שנרשם — אותה שורה, בלי הגירה
-- ---------------------------------------------------------------------
--  זה מה שהופך "שדרוג מאורח" מפעולה מסוכנת לשינוי דגל: כל
--  ההרכבים וההיסטוריה קשורים ל-`id`, וה-`id` לא זז.
UPDATE auth.users SET is_anonymous = FALSE, email = 'guest.grew@example.com'
 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

SET dubid.test_uid = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT game.ensure_profile('אורח שהתבגר');

DO $$
DECLARE u game.users; n INT;
BEGIN
  SELECT count(*) INTO n FROM game.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 7: נוצרה שורה שנייה במקום עדכון'; END IF;

  SELECT * INTO u FROM game.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  IF u.is_guest              THEN RAISE EXCEPTION 'FAIL 7b: עדיין מסומן כאורח'; END IF;
  IF u.registered_at IS NULL THEN RAISE EXCEPTION 'FAIL 7c: אין חותמת הרשמה'; END IF;
  IF u.display_name <> 'אורח שהתבגר' THEN RAISE EXCEPTION 'FAIL 7d: השם לא עודכן'; END IF;
END $$;
\echo '  ✓ 7  אורח שנרשם — אותה שורה, אותו id, דגל אחד השתנה'

-- ---------------------------------------------------------------------
-- 8. suggest_username מחזיר שם פנוי
-- ---------------------------------------------------------------------
DO $$
DECLARE v TEXT;
BEGIN
  v := game.suggest_username();
  IF v IS NULL OR length(v) < 3 THEN RAISE EXCEPTION 'FAIL 8: הצעה לא תקינה: %', v; END IF;
  IF NOT game.username_available(v) THEN RAISE EXCEPTION 'FAIL 8b: ההצעה % תפוסה', v; END IF;
END $$;
\echo '  ✓ 8  suggest_username — תמיד מחזיר שם פנוי'

\echo ''
\echo '════════════════════════════════════════════'
\echo '  PASS — חשבונות, אורחים והתנגשויות'
\echo '════════════════════════════════════════════'
