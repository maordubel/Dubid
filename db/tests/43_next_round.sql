-- db/tests/43_next_round.sql — המחזור הבא (db/61)
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DO $$
DECLARE v_season UUID; v JSONB; v_lock TIMESTAMPTZ;
BEGIN
  SELECT season_id, lock_at INTO v_season, v_lock FROM game.gameweeks WHERE code = 'gw-2';
  DELETE FROM game.gameweeks WHERE season_id = v_season AND number IN (3, 4, 1);
  -- זומבי: מספר קטן, נעילה רחוקה — לא נבחר
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, status) VALUES
    (v_season, 1, 'gw-1z', v_lock + INTERVAL '300 days', 'draft'),
    (v_season, 4, 'gw-4t', v_lock + INTERVAL '14 days', 'draft'),
    (v_season, 3, 'gw-3t', v_lock + INTERVAL '7 days', 'draft');
  v := game.next_round('gw-2');
  IF v->>'code' <> 'gw-3t' THEN RAISE EXCEPTION 'FAIL 1: %', v; END IF;
  UPDATE game.gameweeks SET status = 'published' WHERE code = 'gw-3t';
  v := game.next_round('gw-2');
  IF v->>'code' <> 'gw-4t' THEN RAISE EXCEPTION 'FAIL 2: פורסם נבחר %', v; END IF;
  IF game.next_round('nope') IS NOT NULL THEN RAISE EXCEPTION 'FAIL 3'; END IF;
  IF NOT has_function_privilege('anon', 'game.next_round(text)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL 4'; END IF;
  DELETE FROM game.gameweeks WHERE code IN ('gw-1z','gw-3t','gw-4t');
END $$;
\echo '  ✓✓ 43 — המחזור הבא: לא +1, לא זומבי, לא פורסם'
