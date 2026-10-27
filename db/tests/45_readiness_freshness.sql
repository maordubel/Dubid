-- db/tests/45_readiness_freshness.sql — db/63
\set ON_ERROR_STOP on
SET client_min_messages = WARNING;
\ir _shared_gameweek.sql
DO $$
DECLARE v_gw UUID; r JSONB; v_live INT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE code = 'gw-2';
  SELECT fresh_live_minutes INTO v_live FROM game.readiness_config WHERE id;
  -- סף "חי" אפסי: כל ריצה נחשבת ישנה אם הסף החי חל; הסף השקט (36 ש׳) לא.
  UPDATE game.readiness_config SET fresh_live_minutes = 0 WHERE id;
  INSERT INTO game.ingest_runs (source, phase, gw_code, started_at, finished_at, status)
  VALUES ('test45', 'auto', 'gw-2', now() - INTERVAL '1 minute', now() - INTERVAL '1 minute', 'ok');

  r := game.format_readiness(v_gw, 'five');
  IF r->'reasons' ? 'stale_data' THEN RAISE EXCEPTION 'FAIL 1: פתוח בלי משחק שהתחיל סומן באיחור %', r; END IF;

  UPDATE core.weekly_matches SET kickoff_at = now() - INTERVAL '30 minutes'
   WHERE id = (SELECT id FROM core.weekly_matches WHERE gameweek_id = v_gw ORDER BY id LIMIT 1);
  r := game.format_readiness(v_gw, 'five');
  IF NOT (r->'reasons' ? 'stale_data') THEN RAISE EXCEPTION 'FAIL 2: משחק התחיל — הסף החי לא חל %', r; END IF;

  UPDATE game.readiness_config SET fresh_live_minutes = v_live WHERE id;
END $$;
\ir _shared_gameweek.sql
\echo '  ✓✓ 45 — "נתונים באיחור" רק כשהקליטה אמורה לרוץ צפוף'
