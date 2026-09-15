-- =====================================================================
--  db/tests/14_ingest.sql — קליטה אוטומטית
-- =====================================================================
--
--  ★ מה הבדיקה הזו מגנה עליו
--
--  קליטה אוטומטית נכשלת בשקט. אין מסך שנשבר ואין שגיאה שמישהו
--  רואה — יש רק מחזור שמתפרסם עם מספרים שגויים, שבוע אחרי
--  שהדבר קרה. לכן כל בדיקה כאן שואלת את אותה שאלה בצורה אחרת:
--  «מה קורה כשהנתון לא מושלם?»
--
--  שחקן שלא מופה · משחק שנדחה · קליטה שרצה פעמיים · ספק
--  שמתקן את עצמו יומיים אחרי · משתמש רגיל שמנסה לכתוב.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

\ir _shared_gameweek.sql

-- ---------------------------------------------------------------- הכנה
DELETE FROM auth.users WHERE id::TEXT LIKE 'e2600000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('e2600000-0000-0000-0000-000000000001', 'ingest-boss@dubid.test', FALSE),
  ('e2600000-0000-0000-0000-000000000002', 'plain-user@dubid.test',  FALSE);

SET dubid.test_uid = 'e2600000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל הקליטה');
SELECT game.claim_admin('hapoelTA14!');

-- מנקים שאריות של ריצות קודמות
DELETE FROM game.ingest_alerts   WHERE gw_code = 'gw-77';
DELETE FROM game.ingest_unmapped WHERE source = 'testsource';
DELETE FROM core.external_refs   WHERE provider = 'testsource';
DELETE FROM game.gameweeks       WHERE code = 'gw-77';

-- =====================================================================
-- 1 — משתמש רגיל אינו מערכת
-- =====================================================================
--
--  ★ זו הבדיקה שנפלה כבר פעם אחת בפיתוח: גרסה מוקדמת של
--    `is_system()` בדקה `session_user = 'postgres'`, וכל הרצה
--    מכלי בדיקה או מה-SQL Editor הפכה לזהות מערכת. הבדיקה
--    הזו היא מה שתפס את זה.
DO $$
BEGIN
  IF game.is_system() THEN
    RAISE EXCEPTION 'FAIL 1a: סשן בדיקה רגיל מזוהה כמערכת';
  END IF;
END $$;

SET dubid.test_uid = 'e2600000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('משתמש רגיל');

DO $$
BEGIN
  BEGIN
    PERFORM game.ingest_snapshot('testsource', '{"gameweek":{"number":77}}'::jsonb);
    RAISE EXCEPTION 'FAIL 1b: משתמש רגיל כתב דאטה';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%SYSTEM_OR_ADMIN_REQUIRED%' AND SQLERRM NOT LIKE '%ADMIN_REQUIRED%'
    THEN RAISE; END IF;
  END;
END $$;
\echo '  ✓ 1  רק אדמין או מערכת כותבים דאטה'

-- מכאן ואילך: זהות מערכת, בדיוק כמו ה-Edge Function
SET dubid.test_uid = '';
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', FALSE);

DO $$
BEGIN
  IF NOT game.is_system() THEN RAISE EXCEPTION 'FAIL 1c: service_role אינו מערכת'; END IF;
END $$;

-- =====================================================================
-- 2 — לוח המשחקים נקלט, והדדליין נגזר מהבעיטה הראשונה
-- =====================================================================
DO $$
DECLARE r JSONB; v_lock TIMESTAMPTZ; v_first TIMESTAMPTZ;
BEGIN
  r := game.ingest_snapshot('testsource', jsonb_build_object(
    'phase', 'fixtures',
    'gameweek', jsonb_build_object('number', 77),
    'fixtures', jsonb_build_array(
      jsonb_build_object('providerId','M1',
        'home', jsonb_build_object('id','S3','nameEn','Maccabi Tel Aviv'),
        'away', jsonb_build_object('id','S6','nameEn','Hapoel Tel Aviv'),
        'kickoff', (now() + INTERVAL '3 days')::TEXT, 'status','scheduled'),
      jsonb_build_object('providerId','M2',
        'home', jsonb_build_object('id','S5','nameEn','Beitar Jerusalem'),
        'away', jsonb_build_object('id','S4','nameEn','Maccabi Haifa'),
        'kickoff', (now() + INTERVAL '2 days')::TEXT, 'status','scheduled'))));

  IF (r->>'fixtures')::INT <> 2 THEN
    RAISE EXCEPTION 'FAIL 2a: נקלטו % משחקים', r->>'fixtures';
  END IF;

  SELECT lock_at INTO v_lock FROM game.gameweeks WHERE code = 'gw-77';
  SELECT min(kickoff_at) INTO v_first FROM core.weekly_matches m
    JOIN game.gameweeks g ON g.id = m.gameweek_id WHERE g.code = 'gw-77';

  IF v_lock IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'FAIL 2b: הדדליין % אינו הבעיטה הראשונה %', v_lock, v_first;
  END IF;

  /* ★ הקבוצה זוהתה דרך טבלת הכינויים, בלי שאף אחד הזין מיפוי.
     "Hapoel Tel Aviv" הוא כתיב הספק; במסד יושב 'T6'. */
  IF core.entity_by_provider('testsource','team','S6') IS NULL THEN
    RAISE EXCEPTION 'FAIL 2c: קבוצה לא קושרה אוטומטית';
  END IF;
END $$;
\echo '  ✓ 2  לוח נקלט, קבוצות זוהו לפי כינוי, הדדליין = הבעיטה הראשונה'

-- =====================================================================
-- 3 — מיפוי שחקן: לפי מספר חולצה, ומה שלא בטוח לא מנוחש
-- =====================================================================
DO $$
DECLARE
  v_team UUID; v_shirt SMALLINT; v_ext TEXT; r JSONB; v_player UUID;
BEGIN
  v_team := core.team_by_ext('3');                     -- מכבי ת״א

  SELECT s.shirt_number, core.ext_code('player', s.player_id)
    INTO v_shirt, v_ext
    FROM core.squads s
   WHERE s.team_id = v_team AND s.valid_to IS NULL AND s.status <> 'left'
     AND s.shirt_number IS NOT NULL
     AND (SELECT count(*) FROM core.squads x
           WHERE x.team_id = v_team AND x.valid_to IS NULL
             AND x.shirt_number = s.shirt_number) = 1
   LIMIT 1;

  IF v_shirt IS NULL THEN RAISE EXCEPTION 'FAIL 3a: אין שחקן עם מספר ייחודי לבדיקה'; END IF;

  r := game.ingest_snapshot('testsource', jsonb_build_object(
    'phase', 'final',
    'gameweek', jsonb_build_object('number', 77),
    'stats', jsonb_build_array(
      /* יש לו מספר חולצה → ימופה */
      jsonb_build_object(
        'matchProviderId','M1',
        'team',   jsonb_build_object('id','S3','nameEn','Maccabi Tel Aviv'),
        'player', jsonb_build_object('id','SP-KNOWN','nameEn','Whoever','shirt',v_shirt,'position','MID'),
        'minutes',90,'started',TRUE,'goals',1,'assists',0,'goalsConceded',0),
      /* ★ שם שלא דומה לאיש ובלי מספר → **לא מנוחש** */
      jsonb_build_object(
        'matchProviderId','M1',
        'team',   jsonb_build_object('id','S3','nameEn','Maccabi Tel Aviv'),
        'player', jsonb_build_object('id','SP-GHOST','nameEn','Zzqx Vbnm','position','FWD'),
        'minutes',12,'goals',0,'assists',0,'goalsConceded',0))));

  IF (r->>'playersMapped')::INT <> 1 THEN
    RAISE EXCEPTION 'FAIL 3b: מופו % במקום 1', r->>'playersMapped';
  END IF;
  IF (r->>'unmapped')::INT <> 1 THEN
    RAISE EXCEPTION 'FAIL 3c: לא-מופים % במקום 1', r->>'unmapped';
  END IF;

  v_player := core.entity_by_provider('testsource','player','SP-KNOWN');
  IF v_player IS NULL OR core.ext_code('player', v_player) <> v_ext THEN
    RAISE EXCEPTION 'FAIL 3d: מספר החולצה לא הוביל לשחקן הנכון';
  END IF;

  /* ★ השחקן שלא מופה לא נעלם — הוא ברשימת העבודה של האדמין */
  IF NOT EXISTS (SELECT 1 FROM game.ingest_unmapped
                  WHERE source='testsource' AND external_id='SP-GHOST' AND resolved_at IS NULL)
  THEN RAISE EXCEPTION 'FAIL 3e: שחקן לא מופה נעלם בשקט'; END IF;
END $$;
\echo '  ✓ 3  מספר חולצה ממפה, שם לא מזוהה עולה לאדמין ולא מנוחש'

-- =====================================================================
-- 4 — אידמפוטנטיות: אותו JSON פעמיים = אפס שינויים
-- =====================================================================
DO $$
DECLARE p JSONB; r1 JSONB; r2 JSONB; n_before INT; n_after INT;
BEGIN
  p := jsonb_build_object(
    'phase','final',
    'gameweek', jsonb_build_object('number', 77),
    'fixtures', jsonb_build_array(jsonb_build_object('providerId','M1',
      'home', jsonb_build_object('id','S3','nameEn','Maccabi Tel Aviv'),
      'away', jsonb_build_object('id','S6','nameEn','Hapoel Tel Aviv'),
      'kickoff',(now() + INTERVAL '3 days')::TEXT,'status','finished',
      'homeGoals',2,'awayGoals',0)));

  SELECT count(*) INTO n_before FROM core.stat_corrections;
  r1 := game.ingest_snapshot('testsource', p);
  r2 := game.ingest_snapshot('testsource', p);
  SELECT count(*) INTO n_after FROM core.stat_corrections;

  IF (r2->>'changed')::INT <> 0 THEN
    RAISE EXCEPTION 'FAIL 4a: הרצה שנייה שינתה % שורות', r2->>'changed';
  END IF;
  IF r1->>'fingerprint' IS DISTINCT FROM r2->>'fingerprint' THEN
    RAISE EXCEPTION 'FAIL 4b: טביעת האצבע זזה בלי שהדאטה זזה';
  END IF;
  IF n_after <> n_before THEN
    RAISE EXCEPTION 'FAIL 4c: נכתבו שורות תיקון בלי שינוי אמיתי';
  END IF;
END $$;
\echo '  ✓ 4  קליטה חוזרת אינה משנה דבר, וטביעת האצבע יציבה'

-- =====================================================================
-- 5 — שער נקי נגזר, לא מתקבל מהספק
-- =====================================================================
DO $$
DECLARE v_player UUID; v_match UUID; v_clean BOOLEAN;
BEGIN
  v_player := core.entity_by_provider('testsource','player','SP-KNOWN');
  v_match  := core.entity_by_provider('testsource','match','M1');

  SELECT clean_sheet INTO v_clean FROM core.player_match_stats
   WHERE match_id = v_match AND player_id = v_player;

  /* המשחק הסתיים 2:0 והוא ספג 0 → שער נקי, למרות שאיש לא שלח
     את השדה הזה. */
  IF NOT v_clean THEN RAISE EXCEPTION 'FAIL 5a: שער נקי לא נגזר'; END IF;
END $$;
\echo '  ✓ 5  שער נקי מחושב במסד מהתוצאה ומהדקות'

-- =====================================================================
-- 6 — תיקון מאוחר של הספק נרשם, לא נדרס
-- =====================================================================
DO $$
DECLARE v_match UUID; v_player UUID; n_before INT; n_after INT; r JSONB; v_shirt SMALLINT;
BEGIN
  v_match  := core.entity_by_provider('testsource','match','M1');
  v_player := core.entity_by_provider('testsource','player','SP-KNOWN');
  SELECT count(*) INTO n_before FROM core.stat_corrections WHERE match_id = v_match;

  SELECT s.shirt_number INTO v_shirt FROM core.squads s
   WHERE s.player_id = v_player AND s.valid_to IS NULL LIMIT 1;

  /* יומיים אחרי: הספק הוריד את השער */
  r := game.ingest_snapshot('testsource', jsonb_build_object(
    'phase','sweep',
    'gameweek', jsonb_build_object('number', 77),
    'stats', jsonb_build_array(jsonb_build_object(
      'matchProviderId','M1',
      'team',   jsonb_build_object('id','S3','nameEn','Maccabi Tel Aviv'),
      'player', jsonb_build_object('id','SP-KNOWN','shirt',v_shirt),
      'minutes',90,'started',TRUE,'goals',0,'assists',1,'goalsConceded',0))));

  SELECT count(*) INTO n_after FROM core.stat_corrections WHERE match_id = v_match;
  IF n_after <= n_before THEN
    RAISE EXCEPTION 'FAIL 6a: שינוי נתון לא נרשם כתיקון';
  END IF;
  IF (SELECT goals FROM core.player_match_stats
       WHERE match_id = v_match AND player_id = v_player) <> 0 THEN
    RAISE EXCEPTION 'FAIL 6b: התיקון לא הוחל';
  END IF;
END $$;
\echo '  ✓ 6  תיקון של הספק מוחל, והערך הקודם נשמר בלוג'

-- =====================================================================
-- 7 — משחק שנדחה חוסם פרסום
-- =====================================================================
DO $$
DECLARE r JSONB; n INT;
BEGIN
  PERFORM game.ingest_snapshot('testsource', jsonb_build_object(
    'phase','final',
    'gameweek', jsonb_build_object('number', 77),
    'fixtures', jsonb_build_array(jsonb_build_object('providerId','M2',
      'home', jsonb_build_object('id','S5','nameEn','Beitar Jerusalem'),
      'away', jsonb_build_object('id','S4','nameEn','Maccabi Haifa'),
      'kickoff',(now() + INTERVAL '2 days')::TEXT,'status','postponed'))));

  SELECT count(*) INTO n FROM game.ingest_alerts
   WHERE gw_code = 'gw-77' AND kind = 'fixture_not_final' AND cleared_at IS NULL;
  IF n = 0 THEN RAISE EXCEPTION 'FAIL 7a: דחייה לא יצרה התרעה'; END IF;

  /* ★ ואין תוצאה. לא תיקו, לא אפס. */
  IF EXISTS (SELECT 1 FROM core.v_team_match_results v
              JOIN core.weekly_matches m ON m.id = v.match_id
              WHERE m.id = core.entity_by_provider('testsource','match','M2'))
  THEN RAISE EXCEPTION 'FAIL 7b: משחק שנדחה נספר כתוצאה'; END IF;
END $$;
\echo '  ✓ 7  משחק שנדחה — התרעה, ובלי תוצאה מומצאת'

-- =====================================================================
-- 8 — מחזור החיים: נפתח לבד, ולא מתפרסם כשיש התרעה
-- =====================================================================
DO $$
DECLARE r JSONB; v_status TEXT; v_holding BOOLEAN := FALSE; a JSONB;
BEGIN
  r := game.auto_advance();

  SELECT status INTO v_status FROM game.gameweeks WHERE code = 'gw-77';
  IF v_status NOT IN ('open','draft') THEN
    RAISE EXCEPTION 'FAIL 8a: סטטוס לא צפוי אחרי auto_advance: %', v_status;
  END IF;

  /* כל המשחקים סופיים? לא — אחד נדחה. לכן אין readyToPublish. */
  IF r->>'readyToPublish' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 8b: מחזור עם משחק שנדחה סומן כבשל לפרסום';
  END IF;
END $$;
\echo '  ✓ 8  auto_advance מקדם סטטוס ולא מפרסם מעל התרעה'

-- =====================================================================
-- 9 — הגולמי אינו ניתן לשינוי
-- =====================================================================
DO $$
BEGIN
  PERFORM game.ingest_snapshot('testsource', jsonb_build_object(
    'gameweek', jsonb_build_object('number', 77),
    'raw', jsonb_build_array(jsonb_build_object(
      'kind','round','externalId','R77','payload', jsonb_build_object('x',1)))));

  BEGIN
    UPDATE core.ingest_raw SET source = 'tampered' WHERE source = 'testsource';
    RAISE EXCEPTION 'FAIL 9a: הגולמי ניתן לעריכה';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%APPEND_ONLY%' THEN RAISE; END IF;
  END;
END $$;
\echo '  ✓ 9  core.ingest_raw דוחה UPDATE ו-DELETE במסד עצמו'

-- =====================================================================
-- 10 — מיפוי ידני סוגר את הפער
-- =====================================================================
SELECT set_config('request.jwt.claims', '', FALSE);
SET dubid.test_uid = 'e2600000-0000-0000-0000-000000000001';

DO $$
DECLARE v_ext TEXT; v_list JSONB;
BEGIN
  SELECT core.ext_code('player', s.player_id) INTO v_ext
    FROM core.squads s
   WHERE s.team_id = core.team_by_ext('3') AND s.valid_to IS NULL AND s.status <> 'left'
   LIMIT 1;

  v_list := game.admin_unmapped(50);
  IF jsonb_array_length(v_list) = 0 THEN
    RAISE EXCEPTION 'FAIL 10a: רשימת המיפוי ריקה למרות שחקן לא מופה';
  END IF;

  PERFORM game.admin_map_player('testsource', 'SP-GHOST', v_ext);

  IF core.entity_by_provider('testsource','player','SP-GHOST') IS NULL THEN
    RAISE EXCEPTION 'FAIL 10b: המיפוי הידני לא נשמר';
  END IF;
  IF EXISTS (SELECT 1 FROM game.ingest_unmapped
              WHERE source='testsource' AND external_id='SP-GHOST' AND resolved_at IS NULL)
  THEN RAISE EXCEPTION 'FAIL 10c: הפריט נשאר פתוח אחרי מיפוי'; END IF;
END $$;
\echo '  ✓ 10 מיפוי בקליק אחד סוגר את הפריט ומקשר את הספק'

\echo ''
\echo '  ══ 14_ingest: כל הבדיקות עברו ══'
