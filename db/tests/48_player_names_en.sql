-- db/tests/48_player_names_en.sql — db/67: זוגות עברית/אנגלית, התאמה ייחודית בלבד
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

-- תחליף ל-pg_net (במסד הבדיקות אין אותו): רק טבלת התשובות
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net._http_response (id BIGINT PRIMARY KEY, status_code INT, content TEXT);

DO $$
DECLARE
  v_league TEXT; v_team UUID; v_ext TEXT; v_season UUID;
  p1 UUID; p2 UUID; p3 UUID; p4 UUID; r JSONB; v_price_before NUMERIC;
BEGIN
  SELECT l.code, se.id INTO v_league, v_season
    FROM core.seasons se JOIN core.leagues l ON l.id = se.league_id WHERE se.is_current LIMIT 1;
  SELECT sq.team_id INTO v_team FROM core.squads sq WHERE sq.season_id = v_season AND sq.valid_to IS NULL LIMIT 1;
  SELECT external_id INTO v_ext FROM core.external_refs WHERE entity_type = 'team' AND entity_id = v_team LIMIT 1;

  -- ארבעה שחקנים בדויים בקבוצה: התאמה, התאמה אחרי נרמול, כפילות, ושם קיים
  INSERT INTO core.players (names, primary_position) VALUES
    ('{"en":{"full":"TBD"},"he":{"full":"טסט אחד"}}', 'MID') RETURNING id INTO p1;
  INSERT INTO core.players (names, primary_position) VALUES
    ('{"en":{"full":"TBD"},"he":{"full":"טסט אבו-שתיים"}}', 'MID') RETURNING id INTO p2;
  INSERT INTO core.players (names, primary_position) VALUES
    ('{"en":{"full":"TBD"},"he":{"full":"טסט כפול"}}', 'MID') RETURNING id INTO p3;
  INSERT INTO core.players (names, primary_position) VALUES
    ('{"en":{"full":"Kept Name"},"he":{"full":"טסט קיים"}}', 'MID') RETURNING id INTO p4;
  INSERT INTO core.squads (season_id, team_id, player_id, valid_from, position)
  SELECT v_season, v_team, x, current_date, 'MID' FROM unnest(ARRAY[p1, p2, p3, p4]) x;

  DELETE FROM game.name_fetch_requests WHERE request_id IN (9480001, 9480002);
  DELETE FROM net._http_response WHERE id IN (9480001, 9480002);
  INSERT INTO game.name_fetch_requests (request_id, league_code, team_id, team_ext, lang) VALUES
    (9480001, v_league, v_team, COALESCE(v_ext, '0'), 1),
    (9480002, v_league, v_team, COALESCE(v_ext, '0'), 2);
  INSERT INTO net._http_response (id, status_code, content) VALUES
    (9480001, 200, '{"squads":[{"athletes":[{"id":1,"name":"Test One"},{"id":2,"name":"Test Abu Two"},{"id":3,"name":"Dup A"},{"id":4,"name":"Dup B"},{"id":5,"name":"Other Name"}]}]}'),
    (9480002, 200, '{"squads":[{"athletes":[{"id":1,"name":"טסט אחד"},{"id":2,"name":"טסט אבו שתיים"},{"id":3,"name":"טסט כפול"},{"id":4,"name":"טסט כפול"},{"id":5,"name":"טסט קיים"}]}]}');

  r := game.names_apply(v_league);
  IF NOT (r->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 0: %', r; END IF;

  IF (SELECT name_en FROM core.players WHERE id = p1) <> 'Test One' THEN RAISE EXCEPTION 'FAIL 1: התאמה ישירה'; END IF;
  IF (SELECT names #>> '{en,full}' FROM core.players WHERE id = p1) <> 'Test One' THEN RAISE EXCEPTION 'FAIL 1b: names.en'; END IF;
  IF (SELECT name_he FROM core.players WHERE id = p1) <> 'טסט אחד' THEN RAISE EXCEPTION 'FAIL 1c: עברית נדרסה'; END IF;
  IF (SELECT name_en FROM core.players WHERE id = p2) <> 'Test Abu Two' THEN RAISE EXCEPTION 'FAIL 2: נרמול מקף'; END IF;
  IF (SELECT name_en FROM core.players WHERE id = p3) <> 'TBD' THEN RAISE EXCEPTION 'FAIL 3: כפילות אצל הספק מולאה בניחוש'; END IF;
  IF (SELECT name_en FROM core.players WHERE id = p4) <> 'Kept Name' THEN RAISE EXCEPTION 'FAIL 4: שם קיים נדרס'; END IF;

  r := game.name_gaps(v_league);
  IF (r->>'missing')::INT < 1 OR jsonb_array_length(r->'rows') < 1
     OR (r->>'missing')::INT <> (SELECT count(*) FROM game.league_active_players(v_league) a WHERE NOT core.usable_en(a.name_en)) THEN
    RAISE EXCEPTION 'FAIL 5: ספירת חוסרים %', r->>'missing'; END IF;

  IF has_function_privilege('anon', 'game.names_apply(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'game.names_fetch(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 6: פונקציה פנימית פתוחה'; END IF;

  DELETE FROM core.squads WHERE player_id IN (p1, p2, p3, p4);
  DELETE FROM core.players WHERE id IN (p1, p2, p3, p4);
  DELETE FROM game.name_fetch_requests WHERE request_id IN (9480001, 9480002);
  DELETE FROM net._http_response WHERE id IN (9480001, 9480002);
  DELETE FROM core.player_name_sources WHERE team_id = v_team AND athlete_id IN ('1','2','3','4','5');
END $$;
\echo '  ✓✓ 48 — שמות באנגלית: זוג מאומת, נרמול, אין ניחוש בכפילות, שם קיים נשמר, דוח חוסרים'
