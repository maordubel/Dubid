-- db/tests/35_history_by_mode.sql — history_summary לפי פורמט (db/53)
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql

DO $$
DECLARE v JSONB; r JSONB;
BEGIN
  v := game.history_summary('five', 5, NULL);
  IF jsonb_typeof(v) <> 'array' THEN RAISE EXCEPTION 'FAIL 1: צפוי מערך'; END IF;
  v := game.history_summary(NULL, 5, NULL);
  FOR r IN SELECT * FROM jsonb_array_elements(v) LOOP
    IF r->'topScore' <> 'null'::jsonb OR r->'myPoints' <> 'null'::jsonb OR r->'myRank' <> 'null'::jsonb
    THEN RAISE EXCEPTION 'FAIL 2: p_mode=NULL לא אמור למזג פורמטים בשורה העליונה'; END IF;
    IF NOT (r->'byMode' ? 'five' AND r->'byMode' ? 'full')
    THEN RAISE EXCEPTION 'FAIL 3: חסר byMode'; END IF;
  END LOOP;
  BEGIN
    PERFORM game.history_summary('bogus', 5, NULL);
    RAISE EXCEPTION 'FAIL 4: mode שגוי התקבל';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'BAD_MODE%' THEN RAISE; END IF;
  END;
END $$;
