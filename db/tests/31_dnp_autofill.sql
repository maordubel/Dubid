-- db/tests/31_dnp_autofill.sql — שחקן שלא שיחק לא חוסם; שחקן לא ממופה כן
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DELETE FROM auth.users WHERE id::TEXT LIKE 'f5000000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('f5000000-0000-0000-0000-000000000001', 'dnp1@dubid.test', FALSE),
  ('f5000000-0000-0000-0000-000000000002', 'dnp2@dubid.test', FALSE);
SET dubid.test_uid = 'f5000000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('dnp1');
SET dubid.test_uid = 'f5000000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('dnp2');

DO $$
DECLARE
  v_gw UUID; v_m UUID; v_team UUID; v_mapped UUID; v_unmapped UUID; v_l1 UUID; v_l2 UUID;
  n INT; r INT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  SELECT m.id, m.home_team_id INTO v_m, v_team FROM core.weekly_matches m WHERE m.gameweek_id = v_gw LIMIT 1;
  UPDATE core.weekly_matches SET status = 'finished', home_goals = 1, away_goals = 0 WHERE id = v_m;

  /* 11 שורות לקבוצה (דף משחק נקלט) + שני שחקנים נוספים שנעדרים */
  INSERT INTO core.player_match_stats (match_id, player_id, team_id, minutes, started)
  SELECT v_m, s.player_id, v_team, 90, TRUE FROM (
    SELECT player_id FROM core.squads WHERE team_id = v_team AND valid_to IS NULL
     ORDER BY player_id LIMIT 11) s;
  SELECT s.player_id INTO v_mapped FROM core.squads s WHERE s.team_id = v_team AND s.valid_to IS NULL
     AND s.player_id NOT IN (SELECT player_id FROM core.player_match_stats WHERE match_id = v_m)
   ORDER BY s.player_id LIMIT 1;
  SELECT s.player_id INTO v_unmapped FROM core.squads s WHERE s.team_id = v_team AND s.valid_to IS NULL
     AND s.player_id NOT IN (SELECT player_id FROM core.player_match_stats WHERE match_id = v_m)
     AND s.player_id <> v_mapped ORDER BY s.player_id LIMIT 1;
  IF v_mapped IS NULL OR v_unmapped IS NULL THEN RAISE EXCEPTION 'FAIL 0: אין מספיק שחקנים בסגל'; END IF;

  DELETE FROM core.external_refs WHERE provider = 'scores365' AND entity_type = 'player'
     AND entity_id IN (v_mapped, v_unmapped);
  INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id, payload)
  VALUES ('scores365', 'player', 'dnp-test-1', v_mapped, '{}'::jsonb);

  /* הרכב א: שחקן ממופה שנעדר. הרכב ב: שחקן לא ממופה שנעדר */
  INSERT INTO game.user_lineups (user_id, gameweek_id, status)
  VALUES ('f5000000-0000-0000-0000-000000000001', v_gw, 'submitted') RETURNING id INTO v_l1;
  INSERT INTO game.user_lineup_slots (lineup_id, slot_no, player_id, team_id, position)
  SELECT v_l1, 1, v_mapped, v_team, position FROM core.squads WHERE player_id = v_mapped AND valid_to IS NULL LIMIT 1;
  INSERT INTO game.user_lineups (user_id, gameweek_id, status)
  VALUES ('f5000000-0000-0000-0000-000000000002', v_gw, 'submitted') RETURNING id INTO v_l2;
  INSERT INTO game.user_lineup_slots (lineup_id, slot_no, player_id, team_id, position)
  SELECT v_l2, 1, v_unmapped, v_team, position FROM core.squads WHERE player_id = v_unmapped AND valid_to IS NULL LIMIT 1;

  /* 1. הלא-ממופה חוסם; הממופה מקבל DNP */
  r := game.ingest_check_coverage('gw-2');
  IF r <> 1 THEN RAISE EXCEPTION 'FAIL 1a: צפוי 1 חוסם, קיבלתי %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM core.player_match_stats WHERE match_id = v_m AND player_id = v_mapped
                  AND minutes = 0 AND extra->>'auto_dnp' = 'true') THEN RAISE EXCEPTION 'FAIL 1b: אין DNP לממופה'; END IF;
  IF EXISTS (SELECT 1 FROM core.player_match_stats WHERE match_id = v_m AND player_id = v_unmapped)
  THEN RAISE EXCEPTION 'FAIL 1c: נוצר DNP לשחקן לא ממופה'; END IF;
  IF NOT EXISTS (SELECT 1 FROM game.ingest_alerts WHERE gw_code='gw-2' AND kind='unmapped_in_lineup' AND cleared_at IS NULL)
  THEN RAISE EXCEPTION 'FAIL 1d: אין התרעה לשחקן הלא ממופה'; END IF;

  /* 2. אידמפוטנטי */
  r := game.ingest_check_coverage('gw-2');
  IF r <> 1 THEN RAISE EXCEPTION 'FAIL 2: %', r; END IF;

  /* 3. אחרי מיפוי הלא-ממופה — הכול נסגר אוטומטית */
  INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id, payload)
  VALUES ('scores365', 'player', 'dnp-test-2', v_unmapped, '{}'::jsonb);
  r := game.ingest_check_coverage('gw-2');
  IF r <> 0 THEN RAISE EXCEPTION 'FAIL 3a: %', r; END IF;
  IF EXISTS (SELECT 1 FROM game.ingest_alerts WHERE gw_code='gw-2' AND kind='unmapped_in_lineup' AND cleared_at IS NULL)
  THEN RAISE EXCEPTION 'FAIL 3b: ההתרעה לא נסגרה'; END IF;

  /* 4. דף משחק לא נקלט (פחות מ-11 שורות) — לא ממלאים DNP, ממשיך לחסום */
  DELETE FROM core.player_match_stats WHERE match_id = v_m;
  r := game.ingest_check_coverage('gw-2');
  IF r <> 2 THEN RAISE EXCEPTION 'FAIL 4: צפוי 2 חוסמים בלי דף משחק, קיבלתי %', r; END IF;

  /* ניקוי */
  DELETE FROM game.user_lineups WHERE id IN (v_l1, v_l2);
  DELETE FROM core.external_refs WHERE provider = 'scores365' AND external_id IN ('dnp-test-1','dnp-test-2');
  UPDATE game.ingest_alerts SET cleared_at = now(), cleared_by = 'test' WHERE gw_code = 'gw-2' AND cleared_at IS NULL;
  UPDATE core.weekly_matches SET status = 'scheduled', home_goals = NULL, away_goals = NULL WHERE id = v_m;
END $$;
