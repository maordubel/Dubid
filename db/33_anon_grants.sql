-- =====================================================================
--  db/33_anon_grants.sql — ההרשאה שלא באה מ-PUBLIC
--
--  ═══════════════════════════════════════════════════════════════
--  ★★ db/32 לא סגר את החור, ובדיקה 18 העידה שכן ★★
--  ═══════════════════════════════════════════════════════════════
--
--  `db/32` הריץ `REVOKE ALL … FROM PUBLIC` והנחתי שזה מספיק, כי
--  ההנחה הייתה שההרשאה מגיעה מברירת המחדל של PostgreSQL.
--  היא לא. `db/07` מעניק במפורש:
--
--      GRANT ALL ON ALL ROUTINES IN SCHEMA game
--        TO anon, authenticated, service_role;
--
--      ALTER DEFAULT PRIVILEGES … GRANT ALL ON ROUTINES
--        TO anon, authenticated, service_role;
--
--  הענקה מפורשת ל-`anon` שורדת כל `REVOKE … FROM PUBLIC`,
--  ושורת ה-`ALTER DEFAULT PRIVILEGES` מעניקה אותה מחדש לכל
--  פונקציה **עתידית** באופן אוטומטי.
--
--  אחרי `db/32` המצב היה:  `PUBLIC=no  anon=YES`.
--  כלומר: אנונימי עדיין הריץ את הפעימה ושינה סטטוס של מחזור.
--
--  ★ והחלק החמור יותר: בדיקה 18 בדקה **רק PUBLIC**, ולכן היא
--    עברה. בדיקה ירוקה שמעידה על סגירה שלא קרתה גרועה מהחור
--    עצמו — היא מוחקת את הסיכוי שמישהו יסתכל שוב.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה משתנה כאן
--  ═══════════════════════════════════════════════════════════════
--
--  ההרשאה נשללת מ-`anon`, מ-`authenticated` ומ-PUBLIC — משלושתם.
--
--  והכלל אינו רשימה שמישהו יצטרך לזכור לעדכן, אלא **דפוס**:
--
--      · כל פונקציה בסכימת `game` ששמה מתחיל ב-`ingest_`
--      · ועוד קבוצה מפורשת של פונקציות מחזור חיים וזהות
--
--  `admin_ingest_now`, `admin_ingest_state`, `admin_ingest_round`
--  ו-`admin_ingest_dispatches` מתחילות ב-`admin_` ולכן אינן
--  נתפסות — והמסך קורא להן. זו בדיוק הסיבה שהדפוס הוא
--  `ingest\_%` ולא `%ingest%`.
--
--  ★ למה זה לא מפיל את האתר: עברתי על כל קריאות ה-`rpc(...)`
--    ב-`src/`. אף אחת מהפונקציות ברשימה אינה נקראת מהדפדפן.
--    מה שהמסכים קוראים — `entries`, `fixtures`, `public_board`,
--    `league_table`, `gameweek_recap`, `squads`, `me` וכל השאר —
--    אינו נוגע בדפוס הזה כלל.
--
--  ★ מה שלא נגעתי בו, ודורש החלטה נפרדת: שורת
--    `ALTER DEFAULT PRIVILEGES` ב-`db/07` ממשיכה להעניק כל
--    פונקציה עתידית ל-`anon`. הקובץ הזה רץ אחרון ב-RUN-ALL
--    ולכן מנקה אחריה, ובדיקה 19 נופלת על כל פונקציית מערכת
--    חדשה שתיפתח. לצמצם את ברירת המחדל עצמה זה שינוי רחב
--    שדורש מעבר על כל פונקציה בסכימה — לא בסבב הזה.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION game.is_system_routine(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name LIKE 'ingest\_%'
      OR p_name IN (
           'lifecycle_tick','auto_advance','touch_fingerprint',
           'gameweek_fingerprint','can_write_data','is_system');
$$;

COMMENT ON FUNCTION game.is_system_routine(TEXT) IS
  'האם זו פונקציית מערכת שאסור שתהיה קריאה מהדפדפן. מקור אמת אחד לקובץ הזה ולבדיקה.';

DO $lock$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::REGPROCEDURE AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'game' AND game.is_system_routine(p.proname)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    /* ★ התפקידים קיימים רק בענן. במסד מקומי אין ממי לשלול. */
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    END IF;
  END LOOP;
END
$lock$;

/* ה-Edge Functions קוראות חמש מהן דרך PostgREST בתור service_role. */
DO $grant$
DECLARE
  r      RECORD;
  v_list TEXT[] := ARRAY[
    'ingest_snapshot','ingest_set_availability','ingest_set_market_values',
    'ingest_log_failure','auto_advance'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE NOTICE 'אין service_role — מסד מקומי. דילגתי.';
    RETURN;
  END IF;

  FOR r IN
    SELECT p.oid::REGPROCEDURE AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'game' AND p.proname = ANY(v_list)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$grant$;

COMMIT;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('33', '★ פונקציות המערכת נשללות גם מ-anon ומ-authenticated — לא רק מ-PUBLIC')
ON CONFLICT (version) DO NOTHING;
