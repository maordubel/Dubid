-- =====================================================================
--  db/tests/19_anon_grants.sql — הפעם בודקים את התפקיד הנכון
-- =====================================================================
--
--  ★ למה הקובץ הזה קיים, ולמה בדיקה 18 לא הספיקה
--
--  בדיקה 18 שאלה «האם PUBLIC יכול להריץ». התשובה הייתה «לא»,
--  והיא נצבעה ירוקה — בזמן שאנונימי עדיין הריץ את הפעימה ושינה
--  סטטוס של מחזור. ההרשאה לא הגיעה מ-PUBLIC אלא מהענקה מפורשת
--  ל-`anon` ב-`db/07`.
--
--  **בדיקה ירוקה שמעידה על סגירה שלא קרתה גרועה מהחור עצמו.**
--  היא מוחקת את הסיבה להסתכל שוב.
--
--  לכן כאן:
--    · בודקים את שלושת התפקידים, לא אחד;
--    · הכלל נשלף מ-`game.is_system_routine` — אותו מקור אמת
--      שהמיגרציה משתמשת בו, ולכן פונקציה חדשה נתפסת אוטומטית
--      בלי שאיש יזכור לעדכן רשימה;
--    · ובודקים גם את הצד השני — שהמסכים לא נסגרו.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

-- =====================================================================
-- 1 — ★ פונקציות המערכת סגורות לשלושת התפקידים
-- =====================================================================
DO $$
DECLARE v_open TEXT;
BEGIN
  SELECT string_agg(
           p.proname || '(' ||
           CASE WHEN has_function_privilege('public', p.oid, 'EXECUTE')        THEN 'PUBLIC ' ELSE '' END ||
           CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')
                     AND has_function_privilege('anon', p.oid, 'EXECUTE')      THEN 'anon ' ELSE '' END ||
           CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated')
                     AND has_function_privilege('authenticated', p.oid,'EXECUTE') THEN 'authenticated' ELSE '' END
           || ')', ', ' ORDER BY p.proname)
    INTO v_open
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'game'
     AND game.is_system_routine(p.proname)
     AND (
          has_function_privilege('public', p.oid, 'EXECUTE')
       OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')
           AND has_function_privilege('anon', p.oid, 'EXECUTE'))
       OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated')
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     );

  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 1: פונקציות מערכת פתוחות — %', v_open;
  END IF;
END $$;
\echo '  ✓ 1  פונקציות המערכת סגורות ל-PUBLIC, ל-anon ול-authenticated'

-- =====================================================================
-- 2 — ★ המסכים לא נסגרו
--
--     הכיוון ההפוך של אותה טעות. סגירה גורפת הייתה מפילה את
--     המוצר לכל מי שלא מחובר — תקלה גרועה מהפרצה שהיא סוגרת.
-- =====================================================================
DO $$
DECLARE
  v_shut TEXT;
  v_list TEXT[] := ARRAY[
    'entries','fixtures','gameweeks_list','current_gameweek','gameweek_state',
    'public_board','league_table','gameweek_recap','house_ads','content_all',
    'squads','scoring_rules','results','server_now','has_anything'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE NOTICE 'אין anon — דילגתי';
    RETURN;
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_shut
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'game' AND p.proname = ANY(v_list)
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_shut IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 2: מסכים נסגרו בפני אורחים — %', v_shut;
  END IF;
END $$;
\echo '  ✓ 2  המסכים נשארו פתוחים לאורחים'

-- =====================================================================
-- 3 — ★ `admin_ingest_*` לא נתפסו בדפוס
--
--     הדפוס הוא `ingest\_%` ולא `%ingest%` בדיוק בשביל זה.
--     לוח הניהול קורא לארבע הפונקציות האלה מהדפדפן.
-- =====================================================================
DO $$
DECLARE
  v_shut TEXT;
  v_list TEXT[] := ARRAY[
    'admin_ingest_now','admin_ingest_state','admin_ingest_dispatches','admin_ingest_round'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE NOTICE 'אין authenticated — דילגתי';
    RETURN;
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_shut
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'game' AND p.proname = ANY(v_list)
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_shut IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 3: לוח הניהול איבד גישה ל-%', v_shut;
  END IF;
END $$;
\echo '  ✓ 3  admin_ingest_* נשארו פתוחות ללוח הניהול'

-- =====================================================================
-- 4 — ה-Edge Functions שמרו על הגישה שלהן
-- =====================================================================
DO $$
DECLARE
  v_missing TEXT;
  v_list TEXT[] := ARRAY[
    'ingest_snapshot','ingest_set_availability','ingest_set_market_values',
    'ingest_log_failure','auto_advance'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE NOTICE 'אין service_role — דילגתי';
    RETURN;
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_missing
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'game' AND p.proname = ANY(v_list)
     AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 4: ה-Edge איבדה גישה ל-%', v_missing;
  END IF;
END $$;
\echo '  ✓ 4  ה-Edge Functions שמרו על הגישה שלהן'

-- =====================================================================
-- 5 — ★ השרשרת הפנימית עוברת את השלילה
--
--     כולן SECURITY DEFINER, ולכן הבדיקה נעשית מול הבעלים.
--     אם ההנחה הזו שגויה — הפעימה מתה בשקט, וזה יתגלה רק בייצור.
-- =====================================================================
DO $$
DECLARE v JSONB;
BEGIN
  v := game.lifecycle_tick();
  IF v IS NULL THEN RAISE EXCEPTION 'FAIL 5: הפעימה לא החזירה דבר'; END IF;
  IF v ? 'skipped' AND v->>'skipped' = 'ingest_disabled' THEN
    RAISE EXCEPTION 'FAIL 5: הקליטה מושבתת — הבדיקה חסרת משמעות';
  END IF;
END $$;
\echo '  ✓ 5  שרשרת הפעימה הפנימית עוברת את השלילה'

\echo ''
\echo '  ✔ 19_anon_grants — הכל עבר'
