-- db/tests/50_squad_sync.sql — db/69: יישור סגל מול הספק בליגה מבודדת
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net._http_response (id BIGINT PRIMARY KEY, status_code INT, content TEXT);

DO $$
DECLARE
  v_l UUID; v_s UUID; tA UUID; tB UUID;
  pKeep UUID; pMove UUID; pGone UUID; pDup UUID; pWrong UUID; pRight UUID;
  r JSONB; a JSONB; v_run BIGINT; v_m UUID; v_gw UUID; n INT;
BEGIN
  DELETE FROM game.gameweeks WHERE code = 't50-1';
  DELETE FROM core.leagues WHERE code = 'T50_LG';
  DELETE FROM game.name_fetch_requests WHERE league_code = 'T50_LG';
  DELETE FROM net._http_response WHERE id BETWEEN 9500001 AND 9500004;
  DELETE FROM core.external_refs WHERE external_id IN ('m500','m501') OR (provider = 'scores365' AND entity_type = 'match' AND external_id = 'g500');

  INSERT INTO core.leagues (code, country_code, names) VALUES ('T50_LG', 'IL', '{"he":{"full":"ט"},"en":{"full":"T"}}') RETURNING id INTO v_l;
  INSERT INTO core.seasons (league_id, label, starts_on, ends_on, is_current) VALUES (v_l, 'T50', current_date - 30, current_date + 300, TRUE) RETURNING id INTO v_s;
  INSERT INTO core.teams (country_code, names) VALUES ('IL', '{"he":{"full":"אלף"},"en":{"full":"Alef"}}') RETURNING id INTO tA;
  INSERT INTO core.teams (country_code, names) VALUES ('IL', '{"he":{"full":"בית"},"en":{"full":"Bet"}}') RETURNING id INTO tB;

  INSERT INTO core.players (names, primary_position) VALUES ('{"he":{"full":"דון סדריק"},"en":{"full":"TBD"}}', 'MID') RETURNING id INTO pKeep;
  INSERT INTO core.players (names, primary_position) VALUES ('{"he":{"full":"נייד עובר"},"en":{"full":"Mover Man"}}', 'DEF') RETURNING id INTO pMove;
  INSERT INTO core.players (names, primary_position) VALUES ('{"he":{"full":"עזב מזמן"},"en":{"full":"TBD"}}', 'FWD') RETURNING id INTO pGone;
  INSERT INTO core.players (names, primary_position) VALUES ('{"he":{"full":"כפול כפול"},"en":{"full":"Double Row"}}', 'GK') RETURNING id INTO pDup;
  INSERT INTO core.players (names, primary_position) VALUES ('{"he":{"full":"זוהר טעות"},"en":{"full":"Wrong Guy"}}', 'MID') RETURNING id INTO pWrong;
  INSERT INTO core.players (names, primary_position) VALUES ('{"he":{"full":"אלי נכון"},"en":{"full":"Right Guy"}}', 'DEF') RETURNING id INTO pRight;
  INSERT INTO core.squads (season_id, team_id, player_id, shirt_number, position, fantasy_price, tier, valid_from) VALUES
    (v_s, tA, pKeep, 7, 'MID', 3, 2, current_date - 10),
    (v_s, tA, pMove, 4, 'DEF', 4, 1, current_date - 10),
    (v_s, tA, pGone, 9, 'FWD', 2, 5, current_date - 10),
    (v_s, tB, pDup, 1, 'GK', 2, 3, current_date - 10),
    (v_s, tB, pDup, NULL, 'DEF', 2, 3, current_date - 9),
    (v_s, tB, pWrong, 2, 'MID', 2, 3, current_date - 10),
    (v_s, tB, pRight, 22, 'DEF', 2, 3, current_date - 10);

  -- תשובות הספק: A = סדריק (חולצה 45); B = מעביר, כפול, טעות, נכון, וחדש
  INSERT INTO game.name_fetch_requests (request_id, league_code, team_id, team_ext, lang) VALUES
    (9500001, 'T50_LG', tA, 'cA', 1), (9500002, 'T50_LG', tA, 'cA', 2),
    (9500003, 'T50_LG', tB, 'cB', 1), (9500004, 'T50_LG', tB, 'cB', 2);
  INSERT INTO net._http_response (id, status_code, content) VALUES
    (9500001, 200, '{"squads":[{"athletes":[{"id":11,"name":"Don Cedric","jerseyNum":45,"position":{"name":"Midfielder"}}]}]}'),
    (9500002, 200, '{"squads":[{"athletes":[{"id":11,"name":"סדריק דון"}]}]}'),
    (9500003, 200, '{"squads":[{"athletes":[{"id":12,"name":"Mover Man","jerseyNum":5,"position":{"name":"Defender"}},{"id":13,"name":"Double Row","jerseyNum":1,"position":{"name":"Goalkeeper"}},{"id":14,"name":"Wrong Guy","jerseyNum":8,"position":{"name":"Midfielder"}},{"id":15,"name":"Right Guy","jerseyNum":2,"position":{"name":"Defender"}},{"id":16,"name":"Brand New","jerseyNum":30,"position":{"name":"Attacker"}},{"id":99,"name":"Coach","position":{"id":0}}]}]}'),
    (9500004, 200, '{"squads":[{"athletes":[{"id":12,"name":"נייד עובר"},{"id":13,"name":"כפול כפול"},{"id":14,"name":"זוהר טעות"},{"id":15,"name":"אלי נכון"},{"id":16,"name":"חדש לגמרי"},{"id":99,"name":"מאמן"}]}]}');

  -- הקליטה: member m500 (athlete 15 = Right Guy) מופה בטעות ל-Wrong Guy לפי חולצה 2, ונרשמה לו סטטיסטיקה
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, status) VALUES (v_s, 1, 't50-1', now() - INTERVAL '3 days', 'published') RETURNING id INTO v_gw;
  INSERT INTO core.weekly_matches (gameweek_id, home_team_id, away_team_id, kickoff_at, status)
  VALUES (v_gw, tA, tB, now() - INTERVAL '3 days', 'finished') RETURNING id INTO v_m;
  INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id) VALUES ('scores365', 'match', 'g500', v_m);
  INSERT INTO core.external_refs (provider, entity_type, external_id, entity_id, payload) VALUES ('scores365', 'player', 'm500', pWrong, '{"matchedBy":"shirt"}');
  INSERT INTO core.ingest_raw (source, kind, external_id, payload, sha256)
  VALUES ('scores365', 'game', 'g500', '{"game":{"homeCompetitor":{"id":"cA"},"awayCompetitor":{"id":"cB"},"members":[{"id":"m500","athleteId":"15","name":"Right Guy"}]}}', 't50');
  INSERT INTO core.player_match_stats (match_id, player_id, team_id, minutes, goals) VALUES (v_m, pWrong, tB, 90, 1);

  -- תכנון: לא משנה כלום
  r := game.squad_sync_plan('T50_LG', 1);
  IF NOT (r->>'ok')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 0: %', r; END IF;
  v_run := (r->>'runId')::BIGINT;
  IF (SELECT count(*) FROM core.squads WHERE season_id = v_s AND valid_to IS NULL) <> 7 THEN RAISE EXCEPTION 'FAIL 1: plan כתב לסגל'; END IF;
  IF (r #>> '{items,transfer}')::INT <> 1 OR (r #>> '{items,left}')::INT <> 1 OR (r #>> '{items,new}')::INT <> 1
     OR (r #>> '{items,duplicate}')::INT <> 1 OR (r #>> '{items,ref_fix}')::INT <> 1 THEN RAISE EXCEPTION 'FAIL 2: %', r; END IF;
  IF (r->>'matched')::INT <> 5 THEN RAISE EXCEPTION 'FAIL 2b: התאמות %', r; END IF;

  a := game.squad_sync_apply(v_run);

  -- סדריק זוהה (סדר מילים אחר), חולצה 45 ושם אנגלי
  IF (SELECT shirt_number FROM core.squads WHERE player_id = pKeep AND valid_to IS NULL) <> 45 THEN RAISE EXCEPTION 'FAIL 3: חולצה'; END IF;
  IF (SELECT name_en FROM core.players WHERE id = pKeep) <> 'Don Cedric' THEN RAISE EXCEPTION 'FAIL 3b: שם'; END IF;
  -- מעבר: שורה פעילה אחת, ב-B, עם אותו מחיר ודרג
  IF (SELECT count(*) FROM core.squads WHERE player_id = pMove AND valid_to IS NULL) <> 1
     OR (SELECT team_id FROM core.squads WHERE player_id = pMove AND valid_to IS NULL) <> tB
     OR (SELECT fantasy_price FROM core.squads WHERE player_id = pMove AND valid_to IS NULL) <> 4 THEN RAISE EXCEPTION 'FAIL 4: מעבר'; END IF;
  -- עזב: נסגר, לא נמחק
  IF EXISTS (SELECT 1 FROM core.squads WHERE player_id = pGone AND valid_to IS NULL) OR NOT EXISTS (SELECT 1 FROM core.players WHERE id = pGone) THEN RAISE EXCEPTION 'FAIL 5'; END IF;
  -- כפול: נשארה שורת השוער
  IF (SELECT count(*) FROM core.squads WHERE player_id = pDup AND valid_to IS NULL) <> 1
     OR (SELECT position::TEXT FROM core.squads WHERE player_id = pDup AND valid_to IS NULL) <> 'GK' THEN RAISE EXCEPTION 'FAIL 6: כפול'; END IF;
  -- חדש: שחקן + סגל + מזהה תצוגה
  SELECT count(*) INTO n FROM core.squads s JOIN core.players p ON p.id = s.player_id
   WHERE s.team_id = tB AND s.valid_to IS NULL AND p.name_en = 'Brand New' AND s.tier = 5 AND s.fantasy_price = 1 AND s.position = 'FWD';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM core.external_refs WHERE provider = 'manual_json' AND external_id = '40000016') THEN RAISE EXCEPTION 'FAIL 7: חדש'; END IF;
  -- מאמן לא נוסף
  IF EXISTS (SELECT 1 FROM core.players WHERE name_en = 'Coach') THEN RAISE EXCEPTION 'FAIL 7b: איש צוות נוסף'; END IF;
  -- המיפוי תוקן והסטטיסטיקה עברה לשחקן הנכון; מחזור לניקוד מחדש מדווח
  IF (SELECT entity_id FROM core.external_refs WHERE provider = 'scores365' AND entity_type = 'player' AND external_id = 'm500') <> pRight THEN RAISE EXCEPTION 'FAIL 8: ref'; END IF;
  IF NOT EXISTS (SELECT 1 FROM core.player_match_stats WHERE match_id = v_m AND player_id = pRight AND goals = 1)
     OR EXISTS (SELECT 1 FROM core.player_match_stats WHERE match_id = v_m AND player_id = pWrong) THEN RAISE EXCEPTION 'FAIL 9: stats'; END IF;
  IF (a->>'statsMoved')::INT <> 1 OR a->'rescore'->0->>'code' <> 't50-1' THEN RAISE EXCEPTION 'FAIL 10: %', a; END IF;
  -- פעמיים = שגיאה
  BEGIN PERFORM game.squad_sync_apply(v_run); RAISE EXCEPTION 'FAIL 11'; EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'FAIL 11' THEN RAISE; END IF; END;
  -- ריצה שנייה: אין מה לתקן
  r := game.squad_sync_plan('T50_LG', 1);
  IF jsonb_typeof(r->'items') = 'object' AND (SELECT count(*) FROM jsonb_object_keys(r->'items') k WHERE k NOT IN ('position')) > 0 THEN RAISE EXCEPTION 'FAIL 12: לא אידמפוטנטי %', r; END IF;
  -- הרשאות
  IF has_function_privilege('anon', 'game.admin_squad_sync_plan(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'game.squad_sync_apply(bigint)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL 13'; END IF;

  DELETE FROM core.player_match_stats WHERE match_id = v_m;
  DELETE FROM core.external_refs WHERE external_id IN ('m500', 'g500', '40000016') OR (provider = 'scores365_athlete' AND external_id IN ('11','12','13','14','15','16'));
  DELETE FROM game.name_fetch_requests WHERE league_code = 'T50_LG';
  DELETE FROM net._http_response WHERE id BETWEEN 9500001 AND 9500004;
  DELETE FROM core.players WHERE id IN (SELECT player_id FROM core.squads WHERE season_id = v_s);
  DELETE FROM core.weekly_matches WHERE id = v_m;
  DELETE FROM game.gameweeks WHERE id = v_gw;
  DELETE FROM core.leagues WHERE id = v_l;
  DELETE FROM core.teams WHERE id IN (tA, tB);
END $$;
\echo '  ✓✓ 50 — יישור סגל: תכנון בלי כתיבה, מעבר, עזיבה, כפילות, חדש, חולצה, שם, תיקון מיפוי+סטטיסטיקה, אידמפוטנטי'
