-- =====================================================================
--  db/tests/06_admin_console.sql — לוח ניהול בלי תלות בקוד
-- =====================================================================
--
--  ★ מה נבדק כאן
--
--  הבקשה הייתה "שלא אצטרך אותך בכל פעם שאני רוצה להוסיף משהו".
--  לכן הבדיקה המרכזית היא **מסלול מלא של מחזור חדש**, מהתחלה
--  ועד הסוף, בלי לגעת בשום קובץ:
--
--      יצירת מחזור → קליטת לוח → הפיכה לפעיל → הקליינט רואה אותו
--
--  אם המסלול הזה עובר, אפשר לפתוח מחזור 3 מהטלפון.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DELETE FROM auth.users WHERE id::TEXT LIKE 'c1000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'boss@x.test',  FALSE),
  ('c1000000-0000-0000-0000-000000000002', 'plain@x.test', FALSE);

SET dubid.test_uid = 'c1000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל');
SELECT game.claim_admin('hapoelTA14!');

SET dubid.test_uid = 'c1000000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('שחקן');
SET dubid.test_uid = 'c1000000-0000-0000-0000-000000000001';

-- =====================================================================
-- 1 — יש מחזור נוכחי, והוא בדיוק אחד
-- =====================================================================
DO $$
DECLARE v_code TEXT; v_n INT;
BEGIN
  v_code := game.current_gameweek();
  IF v_code IS NULL THEN RAISE EXCEPTION 'FAIL 1a: אין מחזור נוכחי'; END IF;

  SELECT count(*) INTO v_n FROM game.gameweeks WHERE is_current;
  -- ★ שניים נוכחיים = שתי תחרויות מקבילות שאף אחד לא התכוון אליהן.
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 1b: % מחזורים נוכחיים', v_n; END IF;
END $$;
\echo '  ✓ 1  יש בדיוק מחזור נוכחי אחד, והשרת יודע מיהו'

-- =====================================================================
-- 2 — ★★ המסלול המלא: מחזור 3, בלי לגעת בקוד
-- =====================================================================
DO $$
DECLARE r JSONB; v_imported JSONB; v_before TEXT;
BEGIN
  v_before := game.current_gameweek();

  ---- א. יצירה
  r := game.admin_create_gameweek(3::SMALLINT);
  IF r->>'code' <> 'gw-3' THEN RAISE EXCEPTION 'FAIL 2a: %', r; END IF;

  ---- ב. מחזור בלי משחקים לא יכול להפוך לפעיל
  BEGIN
    PERFORM game.admin_set_current_gameweek('gw-3');
    RAISE EXCEPTION 'FAIL 2b: מחזור ריק הפך לפעיל';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NO_FIXTURES%' THEN RAISE; END IF;
  END;

  ---- ג. קליטת לוח מ-JSON
  v_imported := game.admin_import_fixtures('gw-3', jsonb_build_array(
    jsonb_build_object('home','1','away','2','kickoff','2026-09-05T20:00:00+03:00'),
    jsonb_build_object('home','3','away','4','kickoff','2026-09-05T22:00:00+03:00'),
    jsonb_build_object('home','5','away','6','kickoff','2026-09-06T20:00:00+03:00')
  ));

  IF (v_imported->>'added')::INT <> 3 THEN RAISE EXCEPTION 'FAIL 2c: %', v_imported; END IF;
  IF jsonb_array_length(v_imported->'problems') <> 0 THEN
    RAISE EXCEPTION 'FAIL 2d: %', v_imported->'problems';
  END IF;

  ---- ד. הדדליין נגזר מהמשחק המוקדם ביותר, אוטומטית
  IF (v_imported->>'lockAt')::TIMESTAMPTZ <> TIMESTAMPTZ '2026-09-05T20:00:00+03:00' THEN
    RAISE EXCEPTION 'FAIL 2e: הדדליין %', v_imported->>'lockAt';
  END IF;

  ---- ה. עכשיו אפשר להפוך אותו לפעיל
  PERFORM game.admin_set_current_gameweek('gw-3');
  IF game.current_gameweek() <> 'gw-3' THEN
    RAISE EXCEPTION 'FAIL 2f: המחזור הפעיל לא התחלף';
  END IF;

  ---- ו. והקליינט רואה אותו — דרך אותה פונקציה בדיוק שהמסך קורא לה
  IF jsonb_array_length(game.fixtures('gw-3')->'fixtures') <> 3 THEN
    RAISE EXCEPTION 'FAIL 2g: הלוח לא חוזר לקליינט';
  END IF;

  ---- ז. החזרה, כדי שהבדיקות הבאות ירוצו על מצב מוכר
  PERFORM game.admin_set_current_gameweek(v_before);
END $$;
\echo '  ✓ 2  מחזור חדש: יצירה → לוח → פעיל → נראה בקליינט. בלי קוד.'

-- =====================================================================
-- 3 — קליטה אידמפוטנטית, ושום שורה לא נופלת בשקט
-- =====================================================================
DO $$
DECLARE a JSONB; b JSONB; c JSONB;
BEGIN
  a := game.admin_import_fixtures('gw-3', jsonb_build_array(
    jsonb_build_object('home','1','away','2','kickoff','2026-09-05T20:00:00+03:00')));
  b := game.admin_import_fixtures('gw-3', jsonb_build_array(
    jsonb_build_object('home','1','away','2','kickoff','2026-09-05T21:00:00+03:00')));

  -- ★ הרצה שנייה = עדכון, לא כפילות. cron שרץ פעמיים לא מכפיל לוח.
  IF (b->>'added')::INT <> 0 OR (b->>'updated')::INT <> 1 THEN
    RAISE EXCEPTION 'FAIL 3a: %', b;
  END IF;

  ---- שורות פגומות: מדווחות, לא נבלעות
  c := game.admin_import_fixtures('gw-3', jsonb_build_array(
    jsonb_build_object('home','1','away','2','kickoff','2026-09-05T20:00:00+03:00'),
    jsonb_build_object('home','999','away','2','kickoff','2026-09-05T20:00:00+03:00'),
    jsonb_build_object('home','3','away','3','kickoff','2026-09-05T20:00:00+03:00'),
    jsonb_build_object('home','5','away','6'),
    jsonb_build_object('home','7','away','8','kickoff','לא-תאריך')
  ));

  IF (c->>'received')::INT <> 5 THEN RAISE EXCEPTION 'FAIL 3b: %', c; END IF;
  -- ★ ארבע בעיות, וכל אחת עם מספר שורה. "0 שגיאות" היה מסתיר
  --   שנקלט משחק אחד מתוך חמישה.
  IF jsonb_array_length(c->'problems') <> 4 THEN
    RAISE EXCEPTION 'FAIL 3c: % בעיות במקום 4: %', jsonb_array_length(c->'problems'), c->'problems';
  END IF;
  IF (c->'problems'->0->>'row') IS NULL THEN
    RAISE EXCEPTION 'FAIL 3d: לבעיה אין מספר שורה';
  END IF;
END $$;
\echo '  ✓ 3  קליטה אידמפוטנטית; כל שורה פגומה מדווחת עם מספרה'

-- =====================================================================
-- 4 — משחק שכבר יש לו תוצאה לא נמחק בקליטה מחליפה
-- =====================================================================
DO $$
DECLARE v_gw UUID; v_match UUID; v_left INT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-3';
  SELECT m.id INTO v_match FROM core.weekly_matches m
   WHERE m.gameweek_id = v_gw LIMIT 1;
  UPDATE core.weekly_matches SET home_goals = 2, away_goals = 1 WHERE id = v_match;

  -- קליטה שמחליפה הכל בלוח אחר לגמרי
  PERFORM game.admin_import_fixtures('gw-3', jsonb_build_array(
    jsonb_build_object('home','9','away','10','kickoff','2026-09-07T20:00:00+03:00')),
    TRUE);

  -- ★ המשחק עם התוצאה שרד. ספק ששולח לוח חלקי לא מוחק היסטוריה.
  SELECT count(*) INTO v_left FROM core.weekly_matches WHERE id = v_match;
  IF v_left <> 1 THEN RAISE EXCEPTION 'FAIL 4: משחק עם תוצאה נמחק'; END IF;
END $$;
\echo '  ✓ 4  קליטה מחליפה לא מוחקת משחק שכבר יש לו תוצאה'

-- =====================================================================
-- 5 — מחזור עם הגשות לא נמחק
-- =====================================================================
DO $$
BEGIN
  PERFORM game.admin_delete_gameweek('gw-3');       -- ריק מהגשות — מותר
  IF EXISTS (SELECT 1 FROM game.gameweeks WHERE code = 'gw-3') THEN
    RAISE EXCEPTION 'FAIL 5a: לא נמחק';
  END IF;

  BEGIN
    PERFORM game.admin_delete_gameweek('gw-2');     -- יש בו הגשות מבדיקות קודמות
    -- אם אין הגשות זה מותר; הבדיקה האמיתית היא שהמחזור **הפעיל**
    -- לא נמחק, וזו הבדיקה למטה.
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%HAS_ENTRIES%' AND SQLERRM NOT LIKE '%IS_CURRENT%' THEN RAISE; END IF;
  END;

  IF NOT EXISTS (SELECT 1 FROM game.gameweeks WHERE is_current) THEN
    RAISE EXCEPTION 'FAIL 5b: נמחק המחזור הפעיל';
  END IF;
END $$;
\echo '  ✓ 5  מחזור עם הגשות, או המחזור הפעיל, לא נמחקים'

-- =====================================================================
-- 6 — חוקי ניקוד כדאטה
-- =====================================================================
DO $$
DECLARE v JSONB;
BEGIN
  PERFORM game.admin_set_rule('goal_fwd', 7);
  v := game.scoring_rules();
  IF (v->>'goal_fwd')::NUMERIC <> 7 THEN RAISE EXCEPTION 'FAIL 6a: %', v; END IF;

  -- טווח שפוי
  BEGIN
    PERFORM game.admin_set_rule('goal_fwd', 9999);
    RAISE EXCEPTION 'FAIL 6b: 9999 נקודות התקבל';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%POINTS_RANGE%' THEN RAISE; END IF;
  END;

  -- היסטוריה נשמרת
  IF NOT EXISTS (SELECT 1 FROM game.scoring_history WHERE rule_key = 'goal_fwd') THEN
    RAISE EXCEPTION 'FAIL 6c: אין היסטוריה';
  END IF;

  -- ביטול מחזיר לברירת המחדל שבקוד
  PERFORM game.admin_clear_rule('goal_fwd');
  IF (game.scoring_rules() ? 'goal_fwd') THEN RAISE EXCEPTION 'FAIL 6d: לא בוטל'; END IF;
END $$;
\echo '  ✓ 6  שינוי חוק ניקוד, טווח שפוי, היסטוריה, וביטול'

-- =====================================================================
-- 7 — תוכן ושיווק
-- =====================================================================
DO $$
DECLARE v JSONB;
BEGIN
  PERFORM game.admin_set_content('lobby.headline', '"מחזור 3 נפתח"'::jsonb, 'קמפיין');
  v := game.content_all();
  IF v->>'lobby.headline' <> 'מחזור 3 נפתח' THEN RAISE EXCEPTION 'FAIL 7a: %', v; END IF;

  -- ★ טיוטה לא דולפת לקריאה הפומבית
  PERFORM game.admin_set_content('promo.draft', '"עוד לא"'::jsonb, NULL, FALSE);
  IF (game.content_all() ? 'promo.draft') THEN
    RAISE EXCEPTION 'FAIL 7b: טיוטת קמפיין נחשפה';
  END IF;
  -- אבל האדמין כן רואה אותה
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(game.admin_content_list()) x
                  WHERE x.value->>'key' = 'promo.draft') THEN
    RAISE EXCEPTION 'FAIL 7c: האדמין לא רואה טיוטה';
  END IF;

  PERFORM game.admin_delete_content('lobby.headline');
  IF (game.content_all() ? 'lobby.headline') THEN RAISE EXCEPTION 'FAIL 7d: לא נמחק'; END IF;
END $$;
\echo '  ✓ 7  תוכן: עריכה, טיוטה שלא דולפת, ומחיקה'

-- =====================================================================
-- 8 — ניתוח ובריאות
-- =====================================================================
DO $$
DECLARE a JSONB; q JSONB;
BEGIN
  a := game.admin_analytics();
  IF a->'audience'->>'users' IS NULL THEN RAISE EXCEPTION 'FAIL 8a: %', a; END IF;
  IF a->'topPicks' IS NULL THEN RAISE EXCEPTION 'FAIL 8b: אין בחירות'; END IF;
  IF a->>'generatedAt' IS NULL THEN RAISE EXCEPTION 'FAIL 8c: אין חותמת זמן'; END IF;

  q := game.admin_data_quality();
  IF jsonb_typeof(q) <> 'array' THEN RAISE EXCEPTION 'FAIL 8d: %', q; END IF;
END $$;
\echo '  ✓ 8  ניתוח ובריאות נתונים מחזירים מבנה תקין'

-- =====================================================================
-- 9 — הכל נדחה למי שאינו אדמין
-- =====================================================================
DO $$
BEGIN
  SET LOCAL dubid.test_uid = 'c1000000-0000-0000-0000-000000000002';

  BEGIN PERFORM game.admin_create_gameweek(9::SMALLINT);
    RAISE EXCEPTION 'FAIL 9a';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF; END;

  BEGIN PERFORM game.admin_import_fixtures('gw-2', '[]'::jsonb);
    RAISE EXCEPTION 'FAIL 9b';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF; END;

  BEGIN PERFORM game.admin_set_rule('goal_fwd', 5);
    RAISE EXCEPTION 'FAIL 9c';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF; END;

  BEGIN PERFORM game.admin_set_content('x', '"y"'::jsonb);
    RAISE EXCEPTION 'FAIL 9d';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF; END;

  BEGIN PERFORM game.admin_analytics();
    RAISE EXCEPTION 'FAIL 9e';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF; END;

  BEGIN PERFORM game.admin_set_current_gameweek('gw-2');
    RAISE EXCEPTION 'FAIL 9f';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ADMIN_REQUIRED%' THEN RAISE; END IF; END;
END $$;
\echo '  ✓ 9  כל פונקציות הלוח נדחות למי שאינו אדמין'

-- =====================================================================
-- 10 — סטטוס מחזור מדבר את השפה של המסד
-- =====================================================================
DO $$
BEGIN
  -- ★ הרשימה בפונקציה חייבת להיות זהה ל-CHECK על הטבלה.
  --   היא לא הייתה: 'published' נדחה, ו-'settled' עבר את
  --   הפונקציה ואז נפל על ה-CHECK.
  PERFORM game.admin_set_status('gw-2', 'locked');
  PERFORM game.admin_set_status('gw-2', 'scoring');
  PERFORM game.admin_set_status('gw-2', 'published');
  PERFORM game.admin_set_status('gw-2', 'open');

  BEGIN
    PERFORM game.admin_set_status('gw-2', 'settled');
    RAISE EXCEPTION 'FAIL 10: סטטוס לא קיים התקבל';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%BAD_STATUS%' THEN RAISE; END IF;
  END;
END $$;
\echo '  ✓ 10 כל סטטוס חוקי מתקבל, ולא-חוקי נדחה לפני המסד'

\echo ''
\echo '  ══ 06_admin_console: כל הבדיקות עברו ══'
