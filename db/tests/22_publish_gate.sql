-- =====================================================================
--  db/tests/22_publish_gate.sql — שער הפרסום, דחיות והשלמה חלקית
-- =====================================================================
--
--  ★ מה הבדיקה הזו מגנה עליו (ביקורת האוטומציה 17.10.2026)
--
--  · A01 — ניקוד שנכשל לא הופך ל«פורסם». כל סירוב נבדק כ**ערך**
--    ולא כשגיאה, וגם שהמחזור באמת נשאר ב-`scoring`.
--  · A03 — מחזור חלקי חוזר לתור; מחזור שהדדליין שלו עבר בטיוטה
--    מתקדם; משחק שנדחה לא חוסם.
--
--  כל בדיקה כאן מריצה את המצב עצמו ובודקת את התוצאה בטבלאות.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

\ir _shared_gameweek.sql

DELETE FROM auth.users WHERE id::TEXT LIKE 'f3600000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('f3600000-0000-0000-0000-000000000001', 'gate@dubid.test', FALSE);
SET dubid.test_uid = 'f3600000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('בודק שער הפרסום');
SELECT game.claim_admin('hapoelTA14!');

UPDATE game.ingest_config SET enabled = TRUE, auto_publish = TRUE,
                              auto_open_next = TRUE, stable_minutes = 45;

/* מאפסים את מצב gw-2 */
DO $$
DECLARE v_gw UUID;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  DELETE FROM game.lineup_scores WHERE gameweek_id = v_gw;
  DELETE FROM game.user_lineups WHERE gameweek_id = v_gw;
  DELETE FROM game.ingest_alerts WHERE gw_code = 'gw-2';
  DELETE FROM game.audit_logs WHERE action = 'lifecycle_backfill' AND entity_id = 'gw-2';
  DELETE FROM core.player_match_stats s USING core.weekly_matches m
   WHERE m.id = s.match_id AND m.gameweek_id = v_gw;
END $$;

-- =====================================================================
-- 1 — ★ משחק שנדחה לא חוסם את המחזור (מדיניות: מתפרסם בלעדיו)
-- =====================================================================
DO $$
DECLARE v_gw UUID; v_match UUID; v_status TEXT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  UPDATE game.gameweeks SET status = 'live', lock_at = now() - INTERVAL '2 days'
   WHERE id = v_gw;
  UPDATE core.weekly_matches
     SET status = 'finished', kickoff_at = now() - INTERVAL '2 days',
         home_goals = 1, away_goals = 0
   WHERE gameweek_id = v_gw;
  SELECT id INTO v_match FROM core.weekly_matches WHERE gameweek_id = v_gw LIMIT 1;
  UPDATE core.weekly_matches SET status = 'postponed', home_goals = NULL, away_goals = NULL
   WHERE id = v_match;

  PERFORM game.auto_advance();

  SELECT status INTO v_status FROM game.gameweeks WHERE id = v_gw;
  IF v_status <> 'scoring' THEN
    RAISE EXCEPTION 'FAIL 1: מחזור עם משחק שנדחה נשאר % ולא scoring', v_status;
  END IF;
  IF (SELECT status FROM core.weekly_matches WHERE id = v_match) <> 'postponed' THEN
    RAISE EXCEPTION 'FAIL 1b: המשחק שנדחה שונה';
  END IF;
  IF (SELECT home_goals FROM core.weekly_matches WHERE id = v_match) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 1c: למשחק שנדחה נכתבה תוצאה (אין תוצאה אינה תיקו)';
  END IF;
END $$;
\echo '  ✓ 1  משחק שנדחה לא חוסם, ולא מקבל תוצאה בדויה'

-- =====================================================================
-- 2 — ★ מחזור שהדדליין שלו עבר בטיוטה נועל ומתקדם
-- =====================================================================
DO $$
DECLARE v_gw UUID; v_status TEXT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  UPDATE game.gameweeks SET status = 'draft', lock_at = now() - INTERVAL '1 hour'
   WHERE id = v_gw;
  UPDATE core.weekly_matches SET status = 'scheduled', home_goals = NULL, away_goals = NULL,
         kickoff_at = now() + INTERVAL '1 hour'
   WHERE gameweek_id = v_gw;

  PERFORM game.auto_advance();

  SELECT status INTO v_status FROM game.gameweeks WHERE id = v_gw;
  IF v_status <> 'locked' THEN
    RAISE EXCEPTION 'FAIL 2: טיוטה שהדדליין שלה עבר נשארה %', v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM game.audit_logs
                  WHERE action = 'auto_lock_gameweek' AND entity_id = 'gw-2'
                    AND (new_value->>'missedOpen')::BOOLEAN) THEN
    RAISE EXCEPTION 'FAIL 2b: הנעילה לא נרשמה כ«לא נפתח»';
  END IF;
END $$;
\echo '  ✓ 2  טיוטה שהדדליין שלה עבר נועלת ומתקדמת, וזה נרשם'

-- =====================================================================
-- 3 — ★ כיסוי חלקי חוזר לתור
-- =====================================================================
DO $$
DECLARE v_gw UUID; v_match UUID; v_other UUID; v_player UUID; v_team UUID;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  UPDATE game.gameweeks SET status = 'live', lock_at = now() - INTERVAL '2 days'
   WHERE id = v_gw;
  UPDATE core.weekly_matches
     SET status = 'finished', kickoff_at = now() - INTERVAL '2 days',
         home_goals = 1, away_goals = 0
   WHERE gameweek_id = v_gw;

  /* שורת נתונים לכל משחק חוץ מאחד */
  FOR v_match, v_team IN
    SELECT id, home_team_id FROM core.weekly_matches WHERE gameweek_id = v_gw ORDER BY id
  LOOP
    SELECT player_id INTO v_player FROM core.squads
     WHERE team_id = v_team AND valid_to IS NULL LIMIT 1;
    IF v_other IS NULL THEN v_other := v_match; CONTINUE; END IF;
    INSERT INTO core.player_match_stats (match_id, player_id, team_id, minutes)
    VALUES (v_match, v_player, v_team, 90) ON CONFLICT DO NOTHING;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM game.gameweek_needs_backfill() WHERE code = 'gw-2') THEN
    RAISE EXCEPTION 'FAIL 3: מחזור עם משחק שנגמר בלי נתונים לא חזר לתור';
  END IF;

  /* משלימים את המשחק החסר — יוצא מהתור */
  SELECT home_team_id INTO v_team FROM core.weekly_matches WHERE id = v_other;
  SELECT player_id INTO v_player FROM core.squads
   WHERE team_id = v_team AND valid_to IS NULL LIMIT 1;
  INSERT INTO core.player_match_stats (match_id, player_id, team_id, minutes)
  VALUES (v_other, v_player, v_team, 90) ON CONFLICT DO NOTHING;

  IF EXISTS (SELECT 1 FROM game.gameweek_needs_backfill() WHERE code = 'gw-2') THEN
    RAISE EXCEPTION 'FAIL 3b: מחזור שהושלם נשאר בתור';
  END IF;
END $$;
\echo '  ✓ 3  משחק שנגמר בלי נתונים מחזיר את המחזור לתור, והשלמה מוציאה אותו'

-- =====================================================================
-- 4 — סטטוס ישן מחזיר לתור; ותקרה של עשרה ניסיונות
-- =====================================================================
DO $$
DECLARE v_gw UUID; v_match UUID; i INT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  SELECT id INTO v_match FROM core.weekly_matches WHERE gameweek_id = v_gw LIMIT 1;
  UPDATE core.weekly_matches SET status = 'live', kickoff_at = now() - INTERVAL '5 hours'
   WHERE id = v_match;

  IF NOT EXISTS (SELECT 1 FROM game.gameweek_needs_backfill() WHERE code = 'gw-2') THEN
    RAISE EXCEPTION 'FAIL 4: משחק שנתקע ב-live שעות לא החזיר את המחזור לתור';
  END IF;

  FOR i IN 1..10 LOOP
    INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
    VALUES ('test', 'lifecycle_backfill', 'gameweek', 'gw-2', '{}'::jsonb);
  END LOOP;

  IF EXISTS (SELECT 1 FROM game.gameweek_needs_backfill() WHERE code = 'gw-2') THEN
    RAISE EXCEPTION 'FAIL 4b: התקרה של 10 ניסיונות ב-24 שעות לא נאכפה';
  END IF;

  DELETE FROM game.audit_logs WHERE action = 'lifecycle_backfill' AND entity_id = 'gw-2';
  UPDATE core.weekly_matches SET status = 'finished', home_goals = 1, away_goals = 0
   WHERE id = v_match;
END $$;
\echo '  ✓ 4  סטטוס ישן חוזר לתור, ויש תקרה שלא מפציצה את הספק'

-- =====================================================================
-- 5 — ★ שער הפרסום: כל סירוב הוא ערך, והמחזור לא זז
-- =====================================================================
DO $$
DECLARE
  v_gw UUID; r RECORD; i INT := 0; slots JSONB := '[]'::jsonb;
  v JSONB; v_lineup UUID; v_fp TEXT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  UPDATE game.gameweeks SET status = 'open', lock_at = now() + INTERVAL '1 day'
   WHERE id = v_gw;

  FOR r IN
    SELECT ext FROM (
      SELECT DISTINCT ON (sq.team_id)
             xp.external_id AS ext, COALESCE(sq.fantasy_price, 0) AS price
        FROM core.squads sq
        JOIN core.v_ext xp ON xp.entity_type='player' AND xp.entity_id=sq.player_id
       WHERE sq.valid_to IS NULL AND sq.status = 'active'
       ORDER BY sq.team_id, COALESCE(sq.fantasy_price, 0), xp.external_id
    ) q ORDER BY q.price, q.ext LIMIT 5
  LOOP
    i := i + 1;
    slots := slots || jsonb_build_array(jsonb_build_object(
      'slot_no', i, 'ext_player_id', r.ext,
      'is_captain', i = 1, 'is_vice', i = 2, 'is_bench', FALSE));
  END LOOP;
  PERFORM game.submit_entry('gw-2', 'five', '2-1-1', slots, 'בודק', 'שער');

  SELECT id INTO v_lineup FROM game.user_lineups WHERE gameweek_id = v_gw LIMIT 1;
  UPDATE game.gameweeks SET status = 'scoring', lock_at = now() - INTERVAL '2 days'
   WHERE id = v_gw;
  UPDATE game.user_lineups SET status = 'locked' WHERE id = v_lineup;
  v_fp := game.gameweek_fingerprint('gw-2');

  /* א. מי שאינו מערכת — לא נכנס, גם לא אדמין אנושי */
  BEGIN
    PERFORM game.publish_scored_gameweek('gw-2', 1, v_fp, 0);
    RAISE EXCEPTION 'FAIL 5a: אדמין אנושי הצליח לפרסם דרך שער המערכת';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SYSTEM_REQUIRED' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', FALSE);

  /* ב. אפס ציונים להרכב אחד — «קריאה שנכשלה» נראית כמו אפס */
  v := game.publish_scored_gameweek('gw-2', 0, v_fp, 0);
  IF (v->>'ok')::BOOLEAN OR v->>'reason' <> 'SCORE_COUNT_MISMATCH' THEN
    RAISE EXCEPTION 'FAIL 5b: אפס ציונים פורסם (%)', v;
  END IF;

  /* ג. כשל ולידציה */
  v := game.publish_scored_gameweek('gw-2', 1, v_fp, 1);
  IF (v->>'ok')::BOOLEAN OR v->>'reason' <> 'LINEUP_FAILURES' THEN
    RAISE EXCEPTION 'FAIL 5c: כשל ולידציה פורסם (%)', v;
  END IF;

  /* ד. ציון שלא נכתב למסד */
  v := game.publish_scored_gameweek('gw-2', 1, v_fp, 0);
  IF (v->>'ok')::BOOLEAN OR v->>'reason' <> 'STORED_COUNT_MISMATCH' THEN
    RAISE EXCEPTION 'FAIL 5d: ציון שלא נשמר פורסם (%)', v;
  END IF;

  INSERT INTO game.lineup_scores (lineup_id, gameweek_id, total_points)
  VALUES (v_lineup, v_gw, 12);

  /* ה. הנתונים זזו בין החישוב לפרסום */
  v := game.publish_scored_gameweek('gw-2', 1, 'stale-fingerprint', 0);
  IF (v->>'ok')::BOOLEAN OR v->>'reason' <> 'DATA_MOVED' THEN
    RAISE EXCEPTION 'FAIL 5e: טביעת אצבע ישנה פורסמה (%)', v;
  END IF;

  /* ו. התרעה חוסמת */
  INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
  VALUES ('gw-2', 'var', 'block', '{"t":1}'::jsonb);
  v := game.publish_scored_gameweek('gw-2', 1, v_fp, 0);
  IF (v->>'ok')::BOOLEAN OR v->>'reason' <> 'BLOCKING_ALERTS' THEN
    RAISE EXCEPTION 'FAIL 5f: פורסם למרות התרעה חוסמת (%)', v;
  END IF;
  UPDATE game.ingest_alerts SET cleared_at = now() WHERE gw_code = 'gw-2' AND kind = 'var';

  /* אף סירוב לא הזיז את המחזור */
  IF (SELECT status FROM game.gameweeks WHERE id = v_gw) <> 'scoring' THEN
    RAISE EXCEPTION 'FAIL 5g: סירוב שינה את סטטוס המחזור';
  END IF;
  /* ...וכל סירוב נרשם, ולא התגלגל אחורה */
  IF (SELECT count(*) FROM game.audit_logs
       WHERE action = 'publish_refused' AND entity_id = 'gw-2') < 5 THEN
    RAISE EXCEPTION 'FAIL 5h: סירובים לא נרשמו ביומן';
  END IF;

  /* ז. הכל תקין — מתפרסם, וההתרעות על סירוב משתחררות מעצמן */
  v := game.publish_scored_gameweek('gw-2', 1, v_fp, 0);
  IF NOT (v->>'ok')::BOOLEAN THEN
    RAISE EXCEPTION 'FAIL 5i: מחזור תקין לא פורסם (%)', v;
  END IF;
  IF (SELECT status FROM game.gameweeks WHERE id = v_gw) <> 'published' THEN
    RAISE EXCEPTION 'FAIL 5j: הסטטוס לא published';
  END IF;
  IF EXISTS (SELECT 1 FROM game.ingest_alerts
              WHERE gw_code = 'gw-2' AND kind = 'publish_refused' AND cleared_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL 5k: התרעת סירוב נשארה פתוחה אחרי פרסום';
  END IF;

  /* ח. פרסום חוזר אינו תקין — המחזור כבר לא ב-scoring */
  v := game.publish_scored_gameweek('gw-2', 1, v_fp, 0);
  IF (v->>'ok')::BOOLEAN OR v->>'reason' <> 'NOT_IN_SCORING' THEN
    RAISE EXCEPTION 'FAIL 5l: פרסום כפול התקבל (%)', v;
  END IF;

  PERFORM set_config('request.jwt.claims', '', FALSE);
END $$;
\echo '  ✓ 5  שער הפרסום: שבעה סירובים כערך, פרסום אחד תקין, ופרסום כפול נדחה'

-- =====================================================================
-- 6 — מחזור בלי הגשות מתפרסם במפורש; הפונקציה סגורה ל-anon
-- =====================================================================
DO $$
DECLARE v_gw UUID; v JSONB;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  DELETE FROM game.lineup_scores WHERE gameweek_id = v_gw;
  DELETE FROM game.user_lineups WHERE gameweek_id = v_gw;
  UPDATE game.gameweeks SET status = 'scoring' WHERE id = v_gw;

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', FALSE);
  v := game.publish_scored_gameweek('gw-2', 0, game.gameweek_fingerprint('gw-2'), 0);
  PERFORM set_config('request.jwt.claims', '', FALSE);

  IF NOT (v->>'ok')::BOOLEAN OR NOT (v->>'noEntries')::BOOLEAN THEN
    RAISE EXCEPTION 'FAIL 6: מחזור בלי הגשות לא פורסם במפורש (%)', v;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'game' AND p.proname = 'publish_scored_gameweek'
          AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'FAIL 6b: שער הפרסום פתוח ל-anon/authenticated';
  END IF;
END $$;
\echo '  ✓ 6  מחזור בלי הגשות מתפרסם במפורש, והשער סגור לדפדפן'

\echo ''
\echo '  ✔ 22_publish_gate — הכל עבר'
