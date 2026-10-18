-- db/tests/27_league_safe_readers.sql — שתי ליגות עם מחזור נוכחי לא שוברות קוראים
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DO $$
DECLARE s2 UUID; g UUID; il_code TEXT; v RECORD; pb JSONB; n INT;
BEGIN
  SELECT s.id INTO s2 FROM core.seasons s JOIN core.leagues l ON l.id = s.league_id WHERE l.code = 'GR_SUPER';
  SELECT g1.code INTO il_code FROM game.gameweeks g1 JOIN core.leagues l ON l.id=g1.league_id
   WHERE g1.is_current AND l.code='IL_PREMIER';

  /* מחזור יווני נוכחי */
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, first_kickoff_at, status, is_current)
  VALUES (s2, 90, 'gr-90', now() + INTERVAL '2 days', now() + INTERVAL '2 days', 'open', TRUE)
  ON CONFLICT (season_id, number) DO UPDATE SET is_current = TRUE, status = 'open';

  /* v_ingest_health לא נופל ומחזיר את הראשית */
  SELECT * INTO v FROM game.v_ingest_health;
  IF v.current_gw IS DISTINCT FROM il_code THEN RAISE EXCEPTION 'FAIL 1: current_gw=% expected %', v.current_gw, il_code; END IF;
  IF NOT (v.current_gw_by_league ? 'GR_SUPER') THEN RAISE EXCEPTION 'FAIL 2: %', v.current_gw_by_league; END IF;

  /* public_board בלי קוד = ראשית */
  pb := game.public_board();
  IF pb->'gameweek'->>'code' IS DISTINCT FROM il_code AND pb->'gameweek'->>'id' IS DISTINCT FROM il_code THEN
    RAISE EXCEPTION 'FAIL 3: board gw %', pb->'gameweek';
  END IF;
  /* עם קוד יווני */
  pb := game.public_board('gr-90');
  IF pb->'gameweek' IS NULL THEN RAISE EXCEPTION 'FAIL 4: no board for gr-90'; END IF;

  /* current_gameweek בלי פרמטר = ראשית, עם GR = יוון */
  IF game.current_gameweek() IS DISTINCT FROM il_code THEN RAISE EXCEPTION 'FAIL 5'; END IF;
END $$;
