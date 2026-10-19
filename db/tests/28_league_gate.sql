-- db/tests/28_league_gate.sql — כרטיסי כניסה לליגות + ארכיון מופרד
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;

DO $$
DECLARE s2 UUID; lp JSONB; gr JSONB; il JSONB; h JSONB; n_gr INT;
BEGIN
  SELECT s.id INTO s2 FROM core.seasons s JOIN core.leagues l ON l.id = s.league_id WHERE l.code = 'GR_SUPER';

  /* יוון מופעלת בקליטה, אין לה מחזור נוכחי → כרטיס "בקרוב" */
  UPDATE game.gameweeks SET is_current = FALSE WHERE season_id = s2;
  UPDATE game.ingest_sources s SET enabled = TRUE FROM core.leagues l WHERE l.id = s.league_id AND l.code = 'GR_SUPER';
  lp := game.leagues_public();
  SELECT x INTO gr FROM jsonb_array_elements(lp) x WHERE x->>'code' = 'GR_SUPER';
  IF gr IS NULL THEN RAISE EXCEPTION 'FAIL 1: GR missing %', lp; END IF;
  IF (gr->>'live')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 2: GR should not be live'; END IF;

  /* מכובה בקליטה וללא מחזור נוכחי → לא מופיעה */
  UPDATE game.ingest_sources s SET enabled = FALSE FROM core.leagues l WHERE l.id = s.league_id AND l.code = 'GR_SUPER';
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(game.leagues_public()) x WHERE x->>'code' = 'GR_SUPER') THEN
    RAISE EXCEPTION 'FAIL 3: disabled GR visible';
  END IF;

  /* מחזור נוכחי ביוון → live + round */
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, first_kickoff_at, status, is_current)
  VALUES (s2, 91, 'gr-91', now() + INTERVAL '2 days', now() + INTERVAL '2 days', 'open', TRUE)
  ON CONFLICT (season_id, number) DO UPDATE SET is_current = TRUE, status = 'open';
  lp := game.leagues_public();
  SELECT x INTO gr FROM jsonb_array_elements(lp) x WHERE x->>'code' = 'GR_SUPER';
  IF NOT (gr->>'live')::BOOLEAN OR (gr->>'round')::INT <> 91 OR gr->>'status' <> 'open' THEN
    RAISE EXCEPTION 'FAIL 4: %', gr;
  END IF;
  SELECT x INTO il FROM jsonb_array_elements(lp) x WHERE x->>'code' = 'IL_PREMIER';
  IF il IS NULL OR NOT (il->>'primary')::BOOLEAN THEN RAISE EXCEPTION 'FAIL 5: %', il; END IF;

  /* ארכיון: מחזור יווני שפורסם לא מופיע בהיסטוריה הראשית, ועם GR_SUPER כן */
  INSERT INTO game.gameweeks (season_id, number, code, lock_at, first_kickoff_at, status)
  VALUES (s2, 92, 'gr-92', now() - INTERVAL '3 days', now() - INTERVAL '3 days', 'published')
  ON CONFLICT (season_id, number) DO UPDATE SET status = 'published';
  h := game.history_summary();
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(h) x WHERE x->>'code' LIKE 'gr-%') THEN
    RAISE EXCEPTION 'FAIL 6: GR leaked into primary history';
  END IF;
  h := game.history_summary(NULL, 20, 'GR_SUPER');
  SELECT count(*) INTO n_gr FROM jsonb_array_elements(h) x WHERE x->>'code' = 'gr-92';
  IF n_gr <> 1 THEN RAISE EXCEPTION 'FAIL 7: %', h; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(h) x WHERE x->>'code' LIKE 'gw-%') THEN
    RAISE EXCEPTION 'FAIL 8: IL leaked into GR history';
  END IF;
END $$;
