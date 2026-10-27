-- db/tests/47_honest_counts.sql — db/66: מונים מוגדרים + next_round באותה עונה
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DO $$
DECLARE
  v_season UUID; v_league UUID; v_lock TIMESTAMPTZ; v_gw UUID; v_s2 UUID;
  a UUID; b UUID; h UUID; p JSONB; s JSONB;
BEGIN
  SELECT season_id, lock_at INTO v_season, v_lock FROM game.gameweeks WHERE code = 'gw-2';
  SELECT league_id INTO v_league FROM core.seasons WHERE id = v_season;
  DELETE FROM game.gameweeks WHERE code IN ('gw-47', 'gw-47n', 'gw-47x');
  DELETE FROM core.seasons WHERE label = 'T47';

  INSERT INTO game.gameweeks (season_id, number, code, lock_at, first_kickoff_at, status)
  VALUES (v_season, 47, 'gw-47', v_lock + INTERVAL '100 days', v_lock + INTERVAL '100 days', 'open')
  RETURNING id INTO v_gw;

  INSERT INTO game.users (display_name) VALUES ('A47') RETURNING id INTO a;
  INSERT INTO game.users (display_name) VALUES ('B47') RETURNING id INTO b;
  INSERT INTO game.users (display_name) VALUES ('H47') RETURNING id INTO h;
  UPDATE game.users SET is_bot = TRUE WHERE id = h;

  -- P01: A בשני המצבים = מנהל אחד, שני הרכבים
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, status, submitted_at) VALUES
    (a, v_gw, 'five', 'submitted', now()), (a, v_gw, 'full', 'submitted', now());
  p := game.round_pulse('gw-47');
  IF (p #>> '{overall,managers}')::INT <> 1 OR (p #>> '{overall,lineups}')::INT <> 2 THEN
    RAISE EXCEPTION 'FAIL 1: %', p->'overall'; END IF;
  IF (p->>'schemaVersion')::INT <> 2 OR (p->>'total')::INT <> 2 THEN RAISE EXCEPTION 'FAIL 1b: v1 נשבר %', p; END IF;

  -- A + B; ומשתתף נוסף (בית) נספר כמו כל אחד — בלי הבחנה בציבור
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, status, submitted_at) VALUES
    (b, v_gw, 'five', 'submitted', now()), (h, v_gw, 'five', 'submitted', now());
  p := game.round_pulse('gw-47');
  IF (p #>> '{overall,managers}')::INT <> 3 OR (p #>> '{byMode,five,managers}')::INT <> 3
     OR (p #>> '{byMode,full,lineups}')::INT <> 1 THEN RAISE EXCEPTION 'FAIL 2: %', p; END IF;
  IF p::TEXT ~* 'house|human|is_bot|bot|userId|slots|formation' THEN RAISE EXCEPTION 'FAIL 2b: דליפה %', p; END IF;

  -- P03: טיוטה / הגשה שנמשכה לא נספרות
  INSERT INTO game.user_lineups (user_id, gameweek_id, mode, status) VALUES (b, v_gw, 'full', 'draft');
  UPDATE game.user_lineups SET status = 'draft' WHERE user_id = b AND gameweek_id = v_gw AND mode = 'five';
  p := game.round_pulse('gw-47');
  IF (p #>> '{overall,managers}')::INT <> 2 OR (p #>> '{overall,lineups}')::INT <> 3 THEN
    RAISE EXCEPTION 'FAIL 3: %', p->'overall'; END IF;

  -- gameweek_state / leagues_public: אותה הגדרה
  s := game.gameweek_state('gw-47');
  IF (s->>'managers')::INT <> 2 OR (s->>'lineups')::INT <> 3 THEN RAISE EXCEPTION 'FAIL 4: %', s; END IF;
  IF s::TEXT ~* 'house' THEN RAISE EXCEPTION 'FAIL 4b'; END IF;

  -- H05/P18: next_round לא קופץ לעונה אחרת
  INSERT INTO core.seasons (league_id, label, starts_on, ends_on, is_current)
  VALUES (v_league, 'T47', current_date + 400, current_date + 700, FALSE) RETURNING id INTO v_s2;
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, status)
  VALUES (v_s2, 48, 'gw-47x', v_lock + INTERVAL '120 days', 'draft');
  IF game.next_round('gw-47') IS NOT NULL THEN RAISE EXCEPTION 'FAIL 5: עונה אחרת נבחרה %', game.next_round('gw-47'); END IF;
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, status)
  VALUES (v_season, 48, 'gw-47n', v_lock + INTERVAL '110 days', 'draft');
  IF game.next_round('gw-47')->>'code' <> 'gw-47n' THEN RAISE EXCEPTION 'FAIL 6'; END IF;

  IF has_function_privilege('anon', 'game.round_counts(uuid,text)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL 7: round_counts פתוח'; END IF;

  DELETE FROM game.gameweeks WHERE code IN ('gw-47', 'gw-47n', 'gw-47x');
  DELETE FROM core.seasons WHERE id = v_s2;
  DELETE FROM game.users WHERE id IN (a, b, h);
END $$;
\echo '  ✓✓ 47 — מונים: managers ייחודיים, lineups, טיוטה לא נספרת, next_round באותה עונה'
