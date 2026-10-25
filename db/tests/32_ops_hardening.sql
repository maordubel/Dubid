-- db/tests/32_ops_hardening.sql
DO $$
DECLARE v_gw UUID; v_n INT; v_open INT;
BEGIN
  SELECT id INTO v_gw FROM game.gameweeks WHERE status='published' LIMIT 1;
  IF v_gw IS NULL THEN RAISE NOTICE 'skip: no published gw'; RETURN; END IF;
  INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
  SELECT code, 'source_disagreement', 'warn', '{"t":1}'::jsonb FROM game.gameweeks WHERE id=v_gw;
  INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
  VALUES (NULL, 'unknown_event', 'warn', '{"kinds":["Goal Disallowed/Var"]}'::jsonb);
  PERFORM game.ingest_housekeeping();
  SELECT count(*) INTO v_open FROM game.ingest_alerts
   WHERE cleared_at IS NULL AND (detail::text LIKE '%Goal Disallowed/Var%' OR detail = '{"t":1}'::jsonb);
  IF v_open <> 0 THEN RAISE EXCEPTION 'housekeeping left % alerts', v_open; END IF;
  IF (SELECT proconfig::text FROM pg_proc WHERE proname='ingest_snapshot' AND pronamespace='game'::regnamespace) NOT LIKE '%statement_timeout=60s%'
  THEN RAISE EXCEPTION 'timeout not set'; END IF;
END $$;
