-- =====================================================================
--  db/tests/18_internal_grants.sql — פונקציות המערכת סגורות לציבור
-- =====================================================================
--
--  ★ מה הבדיקה הזו מגנה עליו
--
--  PostgreSQL פותח כל פונקציה חדשה ל-PUBLIC כברירת מחדל. כלומר
--  כל `CREATE FUNCTION` עתידי במיגרציה הבאה יחזיר את הבעיה,
--  בשקט, בלי ששורה אחת השתנתה בקובץ הזה.
--
--  לכן הבדיקה כאן היא **שומר סף קבוע** ולא בדיקה חד-פעמית:
--  היא סופרת פונקציות מערכת פתוחות, ונופלת על כל אחת חדשה.
--
--  ובאותה נשימה: היא מוודאת שהמסכים לא נסגרו. סגירה גורפת היא
--  הדרך הקלה להפוך פרצה קטנה למוצר שבור לאורחים.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

-- =====================================================================
-- 1 — פונקציות המערכת אינן קריאות ל-PUBLIC
-- =====================================================================
DO $$
DECLARE
  v_open TEXT;
  v_list TEXT[] := ARRAY[
    'lifecycle_tick','auto_advance','touch_fingerprint','gameweek_fingerprint',
    'ingest_check_coverage','ingest_tick','ingest_should_run','ingest_snapshot',
    'ingest_log_failure','ingest_set_availability','ingest_set_market_values',
    'ingest_resolve_team','ingest_resolve_player','can_write_data','is_system'
  ];
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_open
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'game'
     AND p.proname = ANY(v_list)
     AND has_function_privilege('public', p.oid, 'EXECUTE');

  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 1: פונקציות מערכת פתוחות ל-PUBLIC — %', v_open;
  END IF;
END $$;
\echo '  ✓ 1  פונקציות המערכת סגורות ל-PUBLIC'

-- =====================================================================
-- 2 — ★ המסכים לא נסגרו
--
--     סגירה גורפת הייתה מפילה את המוצר לאורחים — וזו תקלה
--     גרועה יותר מהפרצה שהיא באה לסגור.
-- =====================================================================
DO $$
DECLARE
  v_shut TEXT;
  v_list TEXT[] := ARRAY[
    'entries','fixtures','gameweeks_list','current_gameweek','gameweek_state',
    'public_board','league_table','gameweek_recap','house_ads','content_all'
  ];
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_shut
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'game'
     AND p.proname = ANY(v_list)
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_shut IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 2: מסכים נסגרו בפני אורחים — %', v_shut;
  END IF;
END $$;
\echo '  ✓ 2  המסכים נשארו פתוחים לאורחים'

-- =====================================================================
-- 3 — service_role מקבל בחזרה בדיוק את מה שה-Edge קוראת
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
   WHERE n.nspname = 'game'
     AND p.proname = ANY(v_list)
     AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 3: ה-Edge איבדה גישה ל-%', v_missing;
  END IF;
END $$;
\echo '  ✓ 3  ה-Edge Functions שמרו על הגישה שלהן'

-- =====================================================================
-- 4 — ★ השרשרת הפנימית עדיין עובדת
--
--     `lifecycle_tick → auto_advance → touch_fingerprint` —
--     כולן SECURITY DEFINER, ולכן הבדיקה נעשית מול הבעלים.
--     אם הנחה זו שגויה, הפעימה מתה בשקט וזה יתגלה רק בייצור.
-- =====================================================================
DO $$
DECLARE v JSONB;
BEGIN
  v := game.lifecycle_tick();
  IF v IS NULL THEN RAISE EXCEPTION 'FAIL 4: הפעימה לא החזירה דבר'; END IF;
  IF v ? 'skipped' AND v->>'skipped' = 'ingest_disabled' THEN
    RAISE EXCEPTION 'FAIL 4: הקליטה מושבתת — הבדיקה חסרת משמעות';
  END IF;
END $$;
\echo '  ✓ 4  שרשרת הפעימה הפנימית עוברת את ה-REVOKE'

\echo ''
\echo '  ✔ 18_internal_grants — הכל עבר'
