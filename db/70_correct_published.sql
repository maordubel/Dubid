-- =====================================================================
--  db/70_correct_published.sql — תיקון מחזורים שפורסמו + תמחור שחקנים חדשים
-- =====================================================================
--  החלטת בעלים (27.10):
--   1. מחזורים שפורסמו עם סטטיסטיקה שנרשמה לשחקן הלא נכון (db/69) — מתקנים
--      ומנקדים מחדש. הנתונים עוברים לשחקן הנכון; הניקוד מחושב שוב במנוע
--      הרשמי (dubid-score-gameweek) דרך phase 'rescore' של dubid-ingest.
--      סטטוס המחזור והפרסום לא משתנים — רק lineup_scores.
--   2. עמדות — לפי מה שאצלנו (אין שינוי).
--   3. שחקנים חדשים מ-db/69 — מחיר ודרג "לפי מה שיותר נכון": לפי הביצועים
--      בפועל העונה (דירוג הספק ממוצע משוקלל בדקות, ≥180 דקות), ממופים
--      לאחוזון של אותה עמדה בליגה: מי שבאחוזון 90 בדירוג מקבל את המחיר
--      של אחוזון 90 במחירים הקיימים. בלי מספיק דקות — נשאר החציון.
--      דטרמיניסטי, מוסבר, ונרשם ביומן.
-- =====================================================================
BEGIN;
SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · העברת סטטיסטיקה במחזורים שפורסמו, לפי פריטי ref_fix של ריצה
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.squad_sync_correct_published(p_run BIGINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  it RECORD; v_matches UUID[]; v_n INT; v_moved INT := 0; i INT;
  v_actor TEXT := COALESCE(auth.uid()::TEXT, 'system:correct_published');
  v_gws JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM game.squad_sync_runs WHERE id = p_run AND applied_at IS NOT NULL) THEN
    RAISE EXCEPTION 'RUN_NOT_APPLIED';
  END IF;
  DROP TABLE IF EXISTS _mv, _gw;
  CREATE TEMP TABLE _mv (match_id UUID, gameweek_id UUID, wrong UUID, right_p UUID, done BOOLEAN DEFAULT FALSE) ON COMMIT DROP;
  CREATE TEMP TABLE _gw (gameweek_id UUID PRIMARY KEY) ON COMMIT DROP;

  FOR it IN SELECT * FROM game.squad_sync_items WHERE run_id = p_run AND kind = 'ref_fix' AND applied AND player_id IS NOT NULL LOOP
    SELECT array_agg(DISTINCT xm.entity_id) INTO v_matches
      FROM core.ingest_raw r
      JOIN core.external_refs xm ON xm.provider = 'scores365' AND xm.entity_type = 'match' AND xm.external_id = r.external_id
     WHERE r.kind = 'game' AND r.source = 'scores365'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.payload #> '{game,members}', '[]'::jsonb)) m WHERE m->>'id' = it.detail->>'member');
    IF v_matches IS NULL THEN CONTINUE; END IF;
    INSERT INTO _mv (match_id, gameweek_id, wrong, right_p)
    SELECT wm.id, wm.gameweek_id, (it.detail->>'wrongPlayer')::UUID, it.player_id
      FROM core.weekly_matches wm JOIN game.gameweeks g ON g.id = wm.gameweek_id
     WHERE wm.id = ANY (v_matches) AND g.status IN ('published','archived');
  END LOOP;

  FOR i IN 1..10 LOOP
    WITH m AS (
      UPDATE core.player_match_stats s SET player_id = mv.right_p, updated_at = now()
        FROM _mv mv
       WHERE NOT mv.done AND s.match_id = mv.match_id AND s.player_id = mv.wrong
         AND NOT EXISTS (SELECT 1 FROM core.player_match_stats s2 WHERE s2.match_id = s.match_id AND s2.player_id = mv.right_p)
      RETURNING mv.match_id, mv.wrong, mv.gameweek_id)
    , u AS (UPDATE _mv SET done = TRUE FROM m WHERE _mv.match_id = m.match_id AND _mv.wrong = m.wrong RETURNING _mv.gameweek_id)
    INSERT INTO _gw SELECT DISTINCT gameweek_id FROM u ON CONFLICT DO NOTHING;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM _mv mv JOIN core.player_match_stats s ON s.match_id = mv.match_id AND s.player_id = mv.wrong
                           WHERE NOT mv.done
                             AND NOT EXISTS (SELECT 1 FROM core.player_match_stats s2 WHERE s2.match_id = s.match_id AND s2.player_id = mv.right_p));
  END LOOP;

  INSERT INTO game.audit_logs (actor, entity, entity_id, action, new_value, reason)
  SELECT v_actor, 'player_match_stats', mv.match_id::TEXT, 'correct_published_move',
         jsonb_build_object('from', mv.wrong, 'to', mv.right_p, 'gameweek', mv.gameweek_id), 'db/70 run ' || p_run
    FROM _mv mv WHERE mv.done;

  SELECT COALESCE(jsonb_agg(g.code ORDER BY g.lock_at), '[]'::jsonb) INTO v_gws
    FROM _gw JOIN game.gameweeks g ON g.id = _gw.gameweek_id;
  UPDATE game.squad_sync_runs SET summary = summary || jsonb_build_object('publishedCorrected', v_gws, 'publishedStatsMoved', (SELECT count(*) FROM _mv WHERE done))
   WHERE id = p_run;
  RETURN jsonb_build_object('moved', (SELECT count(*) FROM _mv WHERE done), 'pending', (SELECT count(*) FROM _mv WHERE NOT done
           AND EXISTS (SELECT 1 FROM core.player_match_stats s WHERE s.match_id = _mv.match_id AND s.player_id = _mv.wrong)),
         'rescore', v_gws);
END;
$$;
REVOKE ALL ON FUNCTION game.squad_sync_correct_published(BIGINT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- §2 · ניקוד מחדש — בקשה לקליטה (phase 'rescore') + יומן תוצאה
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game.rescore_log (
  id         BIGSERIAL PRIMARY KEY,
  gw_code    TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id BIGINT,
  done_at    TIMESTAMPTZ,
  ok         BOOLEAN,
  report     JSONB
);
ALTER TABLE game.rescore_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game.rescore_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION game.request_rescore(p_gw_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_url TEXT; v_token TEXT; v_req BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM game.gameweeks WHERE code = p_gw_code) THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND'; END IF;
  SELECT function_url, token INTO v_url, v_token FROM game.ingest_secrets WHERE id;
  IF v_url IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'ingest_secrets missing'); END IF;
  SELECT net.http_post(url := v_url,
                       headers := jsonb_build_object('content-type', 'application/json', 'x-ingest-token', v_token),
                       body := jsonb_build_object('phase', 'rescore', 'gameweekCode', p_gw_code),
                       timeout_milliseconds := 55000) INTO v_req;
  INSERT INTO game.rescore_log (gw_code, request_id) VALUES (p_gw_code, v_req);
  RETURN jsonb_build_object('ok', TRUE, 'requestId', v_req, 'code', p_gw_code);
END;
$$;
REVOKE ALL ON FUNCTION game.request_rescore(TEXT) FROM PUBLIC, anon, authenticated;

/** הקליטה מדווחת בסוף הניקוד מחדש (service role בלבד). */
CREATE OR REPLACE FUNCTION game.rescore_record(p_gw_code TEXT, p_ok BOOLEAN, p_report JSONB)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = game, public
AS $$
  UPDATE game.rescore_log SET done_at = now(), ok = p_ok,
         report = jsonb_build_object('scored', p_report->'scored', 'entries', p_report->'entries',
                                     'failures', p_report->'failures', 'error', p_report->'error')
   WHERE id = (SELECT id FROM game.rescore_log WHERE gw_code = p_gw_code AND done_at IS NULL ORDER BY id DESC LIMIT 1);
  INSERT INTO game.audit_logs (actor, entity, entity_id, action, new_value, reason)
  VALUES ('system:rescore', 'gameweek', p_gw_code, 'rescore', jsonb_build_object('ok', p_ok, 'scored', p_report->'scored'), 'db/70');
$$;
REVOKE ALL ON FUNCTION game.rescore_record(TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION game.rescore_record(TEXT, BOOLEAN, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION game.admin_request_rescore(p_gw_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = game, core, public AS $$
BEGIN IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF; RETURN game.request_rescore(p_gw_code); END; $$;
REVOKE ALL ON FUNCTION game.admin_request_rescore(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION game.admin_request_rescore(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §3 · תמחור שחקנים חדשים לפי ביצועים
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.squad_sync_price_new(p_run BIGINT, p_min_minutes INT DEFAULT 180)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_season UUID; it RECORD; v_idx NUMERIC; v_pct NUMERIC; v_price NUMERIC; v_tier SMALLINT; v_old core.squads;
  v_out JSONB := '[]'::jsonb; v_pos core.position;
  v_actor TEXT := COALESCE(auth.uid()::TEXT, 'system:price_new');
BEGIN
  SELECT se.id INTO v_season FROM core.seasons se JOIN core.leagues l ON l.id = se.league_id
    JOIN game.squad_sync_runs r ON r.league_code = l.code WHERE r.id = p_run AND se.is_current;

  -- מדד: דירוג הספק (ranking) ממוצע משוקלל בדקות, מתוך משחקי העונה הגולמיים של הספק.
  -- ★ מאותו מקור לכל השחקנים (גם מי שעוד לא היה ממופה אצלנו) — השוואה הוגנת.
  DROP TABLE IF EXISTS _idx;
  CREATE TEMP TABLE _idx ON COMMIT DROP AS
  WITH g AS (
    SELECT DISTINCT ON (r.external_id) r.payload
      FROM core.ingest_raw r
      JOIN core.external_refs xm ON xm.provider = 'scores365' AND xm.entity_type = 'match' AND xm.external_id = r.external_id
      JOIN core.weekly_matches wm ON wm.id = xm.entity_id
      JOIN game.gameweeks gw ON gw.id = wm.gameweek_id AND gw.season_id = v_season
     WHERE r.kind = 'game' AND r.source = 'scores365'
     ORDER BY r.external_id, r.fetched_at DESC),
  mem AS (SELECT DISTINCT m->>'id' AS mid, m->>'athleteId' AS aid
            FROM g CROSS JOIN LATERAL jsonb_array_elements(COALESCE(g.payload #> '{game,members}', '[]'::jsonb)) m),
  lu AS (SELECT l->>'id' AS mid, NULLIF(l->>'ranking', '')::NUMERIC AS rating,
                (SELECT NULLIF(regexp_replace(st->>'value', '[^0-9]', '', 'g'), '')::INT
                   FROM jsonb_array_elements(COALESCE(l->'stats', '[]'::jsonb)) st WHERE (st->>'type') = '30' LIMIT 1) AS mins
           FROM g CROSS JOIN LATERAL (
             SELECT * FROM jsonb_array_elements(COALESCE(g.payload #> '{game,homeCompetitor,lineups,members}', '[]'::jsonb))
             UNION ALL
             SELECT * FROM jsonb_array_elements(COALESCE(g.payload #> '{game,awayCompetitor,lineups,members}', '[]'::jsonb))) AS x(l))
  SELECT x.entity_id AS player_id, sq.position, sq.fantasy_price, sq.tier, sq.value_source,
         sum(lu.mins) AS mins,
         sum(lu.rating * lu.mins) / NULLIF(sum(lu.mins) FILTER (WHERE lu.rating IS NOT NULL), 0) AS idx
    FROM lu
    JOIN mem ON mem.mid = lu.mid
    JOIN core.external_refs x ON x.provider = 'scores365_athlete' AND x.entity_type = 'player' AND x.external_id = mem.aid
    JOIN core.squads sq ON sq.player_id = x.entity_id AND sq.season_id = v_season AND sq.valid_to IS NULL
   WHERE lu.mins > 0 AND lu.rating IS NOT NULL
   GROUP BY 1, 2, 3, 4, 5;

  FOR it IN SELECT * FROM game.squad_sync_items WHERE run_id = p_run AND kind = 'new' AND applied AND player_id IS NOT NULL LOOP
    SELECT * INTO v_old FROM core.squads WHERE season_id = v_season AND player_id = it.player_id AND valid_to IS NULL LIMIT 1;
    IF v_old.id IS NULL OR COALESCE(v_old.price_locked, FALSE) THEN CONTINUE; END IF;
    v_pos := v_old.position;
    SELECT idx INTO v_idx FROM _idx WHERE player_id = it.player_id AND mins >= p_min_minutes;
    IF v_idx IS NULL THEN
      v_out := v_out || jsonb_build_object('player', it.detail->>'en', 'price', v_old.fantasy_price, 'tier', v_old.tier, 'basis', 'median (not enough minutes)');
      CONTINUE;
    END IF;
    -- אחוזון בין שחקני אותה עמדה (לא כולל שחקנים חדשים)
    SELECT avg((x.idx <= v_idx)::INT) INTO v_pct
      FROM _idx x WHERE x.position = v_pos AND x.mins >= p_min_minutes
       AND x.player_id NOT IN (SELECT player_id FROM game.squad_sync_items WHERE run_id = p_run AND kind = 'new' AND player_id IS NOT NULL);
    SELECT percentile_disc(v_pct) WITHIN GROUP (ORDER BY sq.fantasy_price),
           percentile_disc(1 - v_pct) WITHIN GROUP (ORDER BY sq.tier)
      INTO v_price, v_tier
      FROM core.squads sq
     WHERE sq.season_id = v_season AND sq.valid_to IS NULL AND sq.position = v_pos
       AND sq.fantasy_price IS NOT NULL AND sq.tier IS NOT NULL AND COALESCE(sq.value_source, '') NOT LIKE 'squad_sync%';
    IF v_price IS NULL THEN CONTINUE; END IF;
    UPDATE core.squads SET fantasy_price = v_price, tier = v_tier, value_source = 'squad_sync_perf', value_at = now()
     WHERE id = v_old.id;
    INSERT INTO game.audit_logs (actor, entity, entity_id, action, old_value, new_value, reason)
    VALUES (v_actor, 'player', it.player_id::TEXT, 'price_new_player',
            jsonb_build_object('price', v_old.fantasy_price, 'tier', v_old.tier),
            jsonb_build_object('price', v_price, 'tier', v_tier, 'rating', round(v_idx, 2), 'percentile', round(v_pct, 2)),
            'db/70 run ' || p_run);
    v_out := v_out || jsonb_build_object('player', it.detail->>'en', 'price', v_price, 'tier', v_tier,
                                         'rating', round(v_idx, 2), 'percentile', round(v_pct, 2));
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION game.squad_sync_price_new(BIGINT, INT) FROM PUBLIC, anon, authenticated;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('70', 'תיקון מחזורים שפורסמו (סטטיסטיקה לשחקן הנכון + ניקוד מחדש), תמחור שחקנים חדשים לפי ביצועים')
ON CONFLICT (version) DO NOTHING;

COMMIT;
