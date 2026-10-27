-- db/tests/49_previous_lineup.sql — db/68: ההרכב הקודם שלי בלבד, אותה עונה/מצב, לקריאה
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DELETE FROM auth.users WHERE id::TEXT LIKE 'd4900000-%';
INSERT INTO auth.users (id, email, is_anonymous) VALUES
  ('d4900000-0000-0000-0000-000000000001', 'a49@x.test', FALSE),
  ('d4900000-0000-0000-0000-000000000002', 'b49@x.test', FALSE);
SET dubid.test_uid = 'd4900000-0000-0000-0000-000000000002';
SELECT game.ensure_profile('B49');
SET dubid.test_uid = 'd4900000-0000-0000-0000-000000000001';
SELECT game.ensure_profile('A49');

DO $$
DECLARE
  v_season UUID; v_lock TIMESTAMPTZ; g_old UUID; g_mid UUID; g_tgt UUID; g_other UUID; v_s2 UUID; v_league UUID;
  a UUID := 'd4900000-0000-0000-0000-000000000001'; b UUID := 'd4900000-0000-0000-0000-000000000002';
  l UUID; p1 UUID; t1 UUID; p2 UUID; t2 UUID; r JSONB; n0 INT; n1 INT;
BEGIN
  SELECT season_id, lock_at INTO v_season, v_lock FROM game.gameweeks WHERE code = 'gw-2';
  SELECT league_id INTO v_league FROM core.seasons WHERE id = v_season;
  DELETE FROM game.gameweeks WHERE code LIKE 'gw-49%';
  DELETE FROM core.seasons WHERE label = 'T49';
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, status) VALUES
    (v_season, 490, 'gw-49o', v_lock + INTERVAL '200 days', 'published') RETURNING id INTO g_old;
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, status) VALUES
    (v_season, 491, 'gw-49m', v_lock + INTERVAL '207 days', 'published') RETURNING id INTO g_mid;
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, status) VALUES
    (v_season, 492, 'gw-49t', v_lock + INTERVAL '214 days', 'open') RETURNING id INTO g_tgt;

  SELECT s.player_id, s.team_id INTO p1, t1 FROM core.squads s WHERE s.season_id = v_season AND s.valid_to IS NULL LIMIT 1;
  SELECT s.player_id, s.team_id INTO p2, t2 FROM core.squads s WHERE s.season_id = v_season AND s.valid_to IS NULL AND s.team_id <> t1 LIMIT 1;

  -- A: הרכב ישן (five) + הרכב אחרון (five) + טיוטה במחזור האמצעי ב-full (לא נספרת)
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, status, submitted_at, formation)
  VALUES (a, g_old, 'five', 'scored', now(), '2-1-1') RETURNING id INTO l;
  INSERT INTO game.user_lineup_slots (lineup_id, slot_no, player_id, team_id, position) VALUES (l, 1, p2, t2, 'DEF');
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, status, submitted_at, formation)
  VALUES (a, g_mid, 'five', 'scored', now(), '1-2-1') RETURNING id INTO l;
  INSERT INTO game.user_lineup_slots (lineup_id, slot_no, player_id, team_id, position, is_captain) VALUES
    (l, 1, p1, t1, 'GK', TRUE), (l, 2, p2, t2, 'DEF', FALSE);
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, status, formation) VALUES (a, g_mid, 'full', 'draft', '4-3-3');

  -- P09: המקור הוא האחרון לפני היעד, באותו מצב
  r := game.my_previous_lineup('gw-49t', 'five');
  IF r->>'sourceCode' <> 'gw-49m' OR r->>'formation' <> '1-2-1' THEN RAISE EXCEPTION 'FAIL 1: %', r; END IF;
  IF jsonb_array_length(r->'slots') <> 2 OR NOT (r #>> '{slots,0,isCaptain}')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 1b: %', r; END IF;
  -- טיוטה אינה מקור
  IF game.my_previous_lineup('gw-49t', 'full') IS NOT NULL THEN RAISE EXCEPTION 'FAIL 2: טיוטה הועתקה'; END IF;
  -- אין מקור לפני המחזור הראשון
  IF game.my_previous_lineup('gw-49o', 'five') IS NOT NULL THEN RAISE EXCEPTION 'FAIL 3'; END IF;

  -- P13: משתמש אחר לא מקבל את ההרכב של A
  PERFORM set_config('dubid.test_uid', b::TEXT, TRUE);
  IF game.my_previous_lineup('gw-49t', 'five') IS NOT NULL THEN RAISE EXCEPTION 'FAIL 4: הרכב של אחר נחשף'; END IF;
  PERFORM set_config('dubid.test_uid', a::TEXT, TRUE);

  -- מעבר עונה: מחזור בעונה אחרת לא מקבל מקור מהעונה הקודמת
  INSERT INTO core.seasons (league_id, label, starts_on, ends_on) VALUES (v_league, 'T49', current_date + 800, current_date + 1100) RETURNING id INTO v_s2;
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, status) VALUES
    (v_s2, 493, 'gw-49x', v_lock + INTERVAL '900 days', 'open') RETURNING id INTO g_other;
  IF game.my_previous_lineup('gw-49x', 'five') IS NOT NULL THEN RAISE EXCEPTION 'FAIL 5: עונה קודמת הועתקה'; END IF;

  -- קריאה בלבד: המקור לא השתנה
  SELECT count(*) INTO n0 FROM game.user_lineup_slots s JOIN game.user_lineups u ON u.id = s.lineup_id WHERE u.gameweek_id = g_mid;
  PERFORM game.my_previous_lineup('gw-49t', 'five');
  SELECT count(*) INTO n1 FROM game.user_lineup_slots s JOIN game.user_lineups u ON u.id = s.lineup_id WHERE u.gameweek_id = g_mid;
  IF n0 <> n1 THEN RAISE EXCEPTION 'FAIL 6'; END IF;

  IF has_function_privilege('anon', 'game.my_previous_lineup(text,text)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL 7: anon'; END IF;
  IF NOT has_function_privilege('authenticated', 'game.my_previous_lineup(text,text)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL 8'; END IF;

  DELETE FROM game.gameweeks WHERE code LIKE 'gw-49%';
  DELETE FROM core.seasons WHERE id = v_s2;
END $$;
RESET dubid.test_uid;
DELETE FROM auth.users WHERE id::TEXT LIKE 'd4900000-%';
\echo '  ✓✓ 49 — הרכב קודם: האחרון שלי, אותה עונה ומצב, לא טיוטה, לא של אחר, בלי כתיבה'
