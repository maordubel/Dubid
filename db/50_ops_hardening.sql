-- =====================================================================
--  db/50_ops_hardening.sql · עבודה רציפה בלי תקלות רעש
--
--  1. statement_timeout ברמת הפונקציה: PostgREST מגביל ל-8s, ו-
--     ingest_snapshot / auto_advance נחתכו תחת עומס (המסד משותף ל-OFFSIDES
--     עם עשרות cron בדקה). 60s לפונקציות הכבדות בלבד.
--  2. game.ingest_housekeeping(): ניקוי אוטומטי של התרעות מיושנות —
--       · כל התראה פתוחה של מחזור שפורסם או שעדיין draft (נקלט מחדש כשייפתח)
--       · 'Goal Disallowed/Var' (אירוע מוכר, נשאר בהיסטוריה של התראות ישנות)
--       · source_down ישן מ-3 שעות (אם עדיין למטה — הקליטה הבאה מעלה שוב)
--     לעולם לא נוגעת בהתראת block של מחזור פעיל.
--  3. lifecycle_tick קורא לניקוי בכל טיק (כל 5 דקות). אידמפוטנטי.
-- =====================================================================
SET search_path = game, core, public;

ALTER FUNCTION game.ingest_snapshot(text, jsonb)  SET statement_timeout = '60s';
ALTER FUNCTION game.auto_advance()                SET statement_timeout = '60s';
ALTER FUNCTION game.ingest_check_coverage(text)   SET statement_timeout = '60s';
ALTER FUNCTION game.publish_scored_gameweek(text, integer, text, integer) SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION game.ingest_housekeeping()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_n INT;
BEGIN
  UPDATE game.ingest_alerts a
     SET cleared_at = now(), cleared_by = 'auto:housekeeping'
   WHERE a.cleared_at IS NULL
     AND (
          (a.gw_code IS NOT NULL AND EXISTS (
             SELECT 1 FROM game.gameweeks g
              WHERE g.code = a.gw_code AND g.status IN ('published','finished','draft')))
       OR (a.kind = 'unknown_event' AND a.severity <> 'block'
           AND a.detail::text LIKE '%Goal Disallowed/Var%')
       OR (a.kind = 'source_down' AND a.severity <> 'block'
           AND a.created_at < now() - INTERVAL '3 hours')
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION game.ingest_housekeeping() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION game.lifecycle_tick()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public, extensions
AS $$
DECLARE
  v        JSONB;
  v_ready  TEXT;
  v_url    TEXT;
  v_token  TEXT;
  v_req    BIGINT;
  v_gap    TIMESTAMPTZ;
  v_fill   RECORD;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

  BEGIN PERFORM game.ingest_housekeeping();
  EXCEPTION WHEN OTHERS THEN NULL; END;

  v := game.auto_advance();
  v_ready := v->>'readyToPublish';

  SELECT function_url, token INTO v_url, v_token FROM game.ingest_secrets WHERE id;
  IF v_url IS NULL OR v_token IS NULL THEN
    RETURN v || jsonb_build_object('dispatch', 'endpoint_not_configured');
  END IF;

  IF v_ready IS NOT NULL THEN
    BEGIN
      SELECT net.http_post(
               url     := v_url,
               headers := jsonb_build_object('content-type','application/json',
                                             'x-ingest-token', v_token),
               body    := jsonb_build_object('phase','auto'),
               timeout_milliseconds := 55000) INTO v_req;
    EXCEPTION WHEN undefined_function OR undefined_table OR invalid_schema_name THEN
      RETURN v || jsonb_build_object('publish', 'pg_net_missing');
    END;

    INSERT INTO game.ingest_dispatches (request_id, origin)
    VALUES (v_req, 'lifecycle') ON CONFLICT DO NOTHING;

    RETURN v || jsonb_build_object('publish', jsonb_build_object('requested', v_req));
  END IF;

  SELECT * INTO v_fill FROM game.gameweek_needs_backfill() LIMIT 1;
  IF v_fill.code IS NULL THEN
    RETURN v;
  END IF;

  SELECT max(requested_at) INTO v_gap
    FROM game.ingest_dispatches WHERE origin = 'backfill';
  IF v_gap IS NOT NULL AND v_gap > now() - INTERVAL '30 minutes' THEN
    RETURN v || jsonb_build_object('backfill',
             jsonb_build_object('gw', v_fill.code, 'held', 'throttled'));
  END IF;

  BEGIN
    SELECT net.http_post(
             url     := v_url,
             headers := jsonb_build_object('content-type','application/json',
                                           'x-ingest-token', v_token),
             body    := jsonb_build_object('phase','sweep','round', v_fill.number),
             timeout_milliseconds := 55000) INTO v_req;
  EXCEPTION WHEN undefined_function OR undefined_table OR invalid_schema_name THEN
    RETURN v || jsonb_build_object('backfill', 'pg_net_missing');
  END;

  INSERT INTO game.ingest_dispatches (request_id, origin)
  VALUES (v_req, 'backfill') ON CONFLICT DO NOTHING;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (game.actor_label(), 'lifecycle_backfill', 'gameweek', v_fill.code,
          jsonb_build_object('round', v_fill.number, 'request', v_req));

  RETURN v || jsonb_build_object('backfill',
           jsonb_build_object('gw', v_fill.code, 'round', v_fill.number,
                              'requested', v_req));
END;
$$;
