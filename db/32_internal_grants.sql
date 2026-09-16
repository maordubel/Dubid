-- =====================================================================
--  db/32_internal_grants.sql — פונקציות המערכת נסגרות לציבור
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה נמצא
--  ═══════════════════════════════════════════════════════════════
--
--  פונקציות המערכת — `lifecycle_tick`, `ingest_tick`,
--  `auto_advance`, `ingest_snapshot` ואחיותיהן — היו פתוחות
--  לקריאה בתור `anon`. לא בגלל `GRANT` שמישהו כתב, אלא בגלל
--  ההפך: PostgreSQL מעניק `EXECUTE` ל-PUBLIC על כל פונקציה חדשה
--  כברירת מחדל, ומי שלא כותב `REVOKE` פותח אותה לכולם.
--
--  ההערה ב-db/27 טענה שהן «לא מוענקות לאיש». ההערה תיארה כוונה.
--  המסד תיאר ברירת מחדל. זה בדיוק אותו סוג פער שתפס אותנו
--  ב-`sw.js` — תיעוד שמתאר מה התכוונו, לא מה קורה.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ מה החומרה, בכנות
--  ═══════════════════════════════════════════════════════════════
--
--  מוגבלת, ולא אפס.
--
--  · **אי אפשר לשבור תחרות.** כל מעבר סטטוס חסום בשעון
--    (`lock_at`) ובנתונים (כל המשחקים הסתיימו, יציבות 45 דקות).
--    קריאה אנונימית יכולה רק להקדים ב-דקות משהו שקורה ממילא.
--  · **אפשר להוציא כסף.** `ingest_tick` שולחת פנייה החוצה. לולאה
--    של קריאות = חשבון Edge Functions שמאור משלם עליו.
--  · **אפשר לרעוש.** `ingest_log_failure` כותבת שורות ליומן.
--
--  ═══════════════════════════════════════════════════════════════
--  ★ למה זה בטוח לסגור
--  ═══════════════════════════════════════════════════════════════
--
--  כל הפונקציות כאן הן `SECURITY DEFINER`. כשאחת קוראת לשנייה,
--  הבדיקה נעשית מול הבעלים ולא מול הקורא המקורי — ולכן שרשרת
--  `lifecycle_tick → auto_advance → touch_fingerprint` ממשיכה
--  לעבוד. pg_cron רץ כסופר-יוזר ואינו נבדק כלל.
--
--  מה שכן צריך הרשאה מפורשת: מה שה-Edge Function קוראת ישירות
--  דרך PostgREST, כלומר בתור `service_role`. חמש פונקציות,
--  והן מפורטות למטה בשמן — רשימה מפורשת היא
--  רשימה שאפשר לבקר.
--
--  ★ מה **לא** נסגר כאן: שום פונקציה שהמסכים קוראים.
--    `entries`, `fixtures`, `public_board`, `league_table`,
--    `gameweek_recap` וכל שאר המסכים נשארים בדיוק כפי שהיו.
--    סגירה גורפת הייתה מפילה את המוצר לאורחים.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  §1 · מה ש-PUBLIC מאבד
-- ---------------------------------------------------------------------
/*
 * ★ נשלף לפי **שם** ולא לפי חתימה.
 *
 * הניסיון הראשון כאן כתב `game.ingest_tick()`, ו-db/28 כבר
 * החליפה אותה ב-`ingest_tick(TEXT DEFAULT …)`. ה-REVOKE נפל
 * על `undefined_function`, נבלע ב-NOTICE, והפונקציה שמוציאה
 * כסף נשארה פתוחה. בדיקה 18 תפסה את זה.
 *
 * לולאה על `pg_proc` מכסה כל עומס-יתר קיים ועתידי של אותו שם.
 */
DO $revoke$
DECLARE
  r      RECORD;
  v_list TEXT[] := ARRAY[
    /* מחזור החיים */
    'lifecycle_tick','auto_advance','touch_fingerprint','gameweek_fingerprint',
    'ingest_check_coverage',
    /* הקליטה — כולל זו ששולחת פניות בתשלום */
    'ingest_tick','ingest_should_run','ingest_snapshot','ingest_log_failure',
    'ingest_set_availability','ingest_set_market_values',
    'ingest_resolve_team','ingest_resolve_player',
    /* שערי הזהות */
    'can_write_data','is_system'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::REGPROCEDURE AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'game' AND p.proname = ANY(v_list)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
  END LOOP;
END
$revoke$;

-- ---------------------------------------------------------------------
--  §2 · מה ש-service_role מקבל בחזרה
-- ---------------------------------------------------------------------
--  בדיוק מה שה-Edge Functions קוראות דרך PostgREST, ולא שורה
--  אחת יותר. הרשימה נגזרה מקריאות ה-`rpc(...)` בקוד:
--  ingest_snapshot · ingest_set_market_values · ingest_set_availability
--  · auto_advance · ingest_log_failure · admin_reprice_from_market
--  · admin_set_published · gameweek_player_stats · gameweek_team_results
--  · scoring_rules
--  (ארבע האחרונות מוענקות ממילא ל-`authenticated`, ו-service_role
--   יורש אותן — כאן רק מה שאיבד את ההרשאה למעלה.)
DO $grant$
DECLARE
  r      RECORD;
  v_list TEXT[] := ARRAY[
    'ingest_snapshot','ingest_set_availability','ingest_set_market_values',
    'ingest_log_failure','auto_advance'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE NOTICE 'אין service_role — מסד מקומי. דילגתי על ההענקות.';
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
  ('32', '★ פונקציות המערכת נסגרו ל-PUBLIC; service_role מקבל בדיוק את מה שה-Edge קוראת')
ON CONFLICT (version) DO NOTHING;
