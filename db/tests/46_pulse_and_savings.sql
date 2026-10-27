-- db/tests/46_pulse_and_savings.sql — db/65
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DELETE FROM auth.users WHERE id::TEXT LIKE 'd4600000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('d4600000-0000-0000-0000-000000000001', 'admin46@x.test', FALSE);
SET dubid.test_uid = 'd4600000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('מנהל 46');
SELECT game.claim_admin('test-admin-pass');

DO $$
DECLARE r JSONB; p JSONB; n INT; e JSONB; v0 BIGINT; v1 BIGINT;
BEGIN
  DELETE FROM game.user_lineups ul USING game.gameweeks g WHERE g.id = ul.gameweek_id AND g.code = 'gw-2'
     AND ul.user_id IN (SELECT user_id FROM game.house_players);
  DELETE FROM game.house_schedule hs USING game.gameweeks g WHERE g.id = hs.gameweek_id AND g.code = 'gw-2';

  -- 1. ידני מפוזר: מתוכנן, לא מוגש באותה שנייה
  r := game.admin_add_bots('gw-2', 'five', 4);
  IF (r->>'added')::INT <> 4 OR NOT (r->>'spread')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 1: %', r; END IF;
  SELECT count(*) INTO n FROM game.house_schedule hs JOIN game.gameweeks g ON g.id = hs.gameweek_id
   WHERE g.code = 'gw-2' AND hs.mode = 'five' AND hs.done_at IS NULL AND hs.due_at > now();
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL 1b: % מתוכננים', n; END IF;
  IF (SELECT count(DISTINCT date_trunc('minute', due_at)) FROM game.house_schedule hs JOIN game.gameweeks g ON g.id = hs.gameweek_id
       WHERE g.code = 'gw-2' AND hs.mode = 'five') < 3 THEN RAISE EXCEPTION 'FAIL 1c: לא מפוזר'; END IF;

  -- 2. מיידי — לבדיקות/חירום
  r := game.admin_add_bots('gw-2', 'full', 2, FALSE);
  IF (r->>'added')::INT <> 2 THEN RAISE EXCEPTION 'FAIL 2: %', r; END IF;

  -- 3. דופק: ספירה לפי מצב, ואין הרכב
  p := game.round_pulse('gw-2');
  IF (p->>'full')::INT < 2 OR (p->>'total')::INT < 2 THEN RAISE EXCEPTION 'FAIL 3: %', p; END IF;
  IF p::TEXT ~* 'slots|playerId|formation|userId' THEN RAISE EXCEPTION 'FAIL 3b: דליפה %', p; END IF;
  IF game.round_pulse('nope') IS NOT NULL THEN RAISE EXCEPTION 'FAIL 3c'; END IF;

  -- 4. entries לפני נעילה: בלי מערך ובלי שחקנים של אחרים
  e := game.entries('gw-2');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(e) x
              WHERE (x->>'hidden')::BOOLEAN AND (x #>> '{lineup,formation}' IS NOT NULL
                                                 OR jsonb_array_length(x #> '{lineup,slots}') > 0)) THEN
    RAISE EXCEPTION 'FAIL 4: הרכב/מערך דלף לפני נעילה';
  END IF;

  -- 5. המונה: רצף באותה שנייה = עלייה אחת
  SELECT revision INTO v0 FROM game.data_revision WHERE id = 1;
  UPDATE game.mode_config SET updated_at = now() WHERE mode = 'five';
  UPDATE game.mode_config SET updated_at = now() WHERE mode = 'full';
  UPDATE game.mode_config SET updated_at = now() WHERE mode = 'five';
  SELECT revision INTO v1 FROM game.data_revision WHERE id = 1;
  IF v1 - v0 > 1 THEN RAISE EXCEPTION 'FAIL 5: % העלאות לרצף אחד', v1 - v0; END IF;

  -- 6. דוח אחסון
  r := game.admin_storage_report();
  IF (r->>'databaseBytes')::BIGINT <= 0 OR jsonb_array_length(r->'tables') < 1 THEN RAISE EXCEPTION 'FAIL 6'; END IF;
END $$;

-- 7. יומן: עדכון מערכת ל-player_match_stats לא נרשם ב-audit_logs
RESET dubid.test_uid;
DO $$
DECLARE n0 INT; n1 INT; v_m UUID; v_p UUID;
BEGIN
  SELECT count(*) INTO n0 FROM game.audit_logs WHERE entity = 'player_match_stats';
  SELECT match_id, player_id INTO v_m, v_p FROM core.player_match_stats LIMIT 1;
  IF v_m IS NOT NULL THEN
    UPDATE core.player_match_stats SET minutes = COALESCE(minutes, 0) + 1 WHERE match_id = v_m AND player_id = v_p;
    UPDATE core.player_match_stats SET minutes = minutes - 1 WHERE match_id = v_m AND player_id = v_p;
  END IF;
  SELECT count(*) INTO n1 FROM game.audit_logs WHERE entity = 'player_match_stats';
  IF n1 <> n0 THEN RAISE EXCEPTION 'FAIL 7: עדכון מערכת נרשם % פעמים', n1 - n0; END IF;
END $$;

DELETE FROM game.house_schedule hs USING game.gameweeks g WHERE g.id = hs.gameweek_id AND g.code = 'gw-2';
DELETE FROM game.user_lineups ul USING game.gameweeks g WHERE g.id = ul.gameweek_id AND g.code = 'gw-2'
   AND ul.user_id IN (SELECT user_id FROM game.house_players);
\echo '  ✓✓ 46 — דופק, מערך מוסתר, מונה מרוסן, יומן בלי כפילות, בוטים מפוזרים'
