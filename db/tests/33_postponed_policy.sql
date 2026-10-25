-- db/tests/33_postponed_policy.sql
DO $$
DECLARE v_sev TEXT;
BEGIN
  INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
  VALUES ('t-policy', 'fixture_not_final', 'block', '{"match":"x","status":"postponed"}'::jsonb)
  RETURNING severity INTO v_sev;
  IF v_sev <> 'warn' THEN RAISE EXCEPTION 'postponed alert must not block, got %', v_sev; END IF;
  INSERT INTO game.ingest_alerts (gw_code, kind, severity, detail)
  VALUES ('t-policy', 'unmapped_in_lineup', 'block', '{"count":1}'::jsonb)
  RETURNING severity INTO v_sev;
  IF v_sev <> 'block' THEN RAISE EXCEPTION 'other blocks must stay block'; END IF;
  DELETE FROM game.ingest_alerts WHERE gw_code = 't-policy';
END $$;
