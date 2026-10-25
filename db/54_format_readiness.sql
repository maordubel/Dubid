-- =====================================================================
--  db/54_format_readiness.sql · כשירות ליגה לכל פורמט (D04 / F06)
--
--  עד כה שער הליגות הניח "יש מחזור נוכחי = אפשר לשחק". עכשיו leagues_public
--  מחזיר לכל ליגה `formats.{five,full}` = {state, canSubmit, reasons[],
--  checkedAt, dataUpdatedAt}, מחושב מהנתונים:
--   · מחזור נוכחי + לוח משחקים
--   · סגל זכאי (לא left/loaned_out) ועמדות מינימליות (GK + שחקני שדה)
--   · מחירים (לפורמט התקציבי = חמישייה)
--   · מספר מועדונים זכאי מול מכסת המחזור (ceil(size / cap))
--   · רעננות הקליטה (חלון מוגדר בטבלת קונפיגורציה)
--   · התראות חוסמות פתוחות
--  state: ready | degraded | blocked  (unknown = רק בלקוח, כשהקריאה נכשלה)
--  canSubmit = הנתונים כשירים ∧ המחזור open ∧ הדדליין לא עבר. מחזור נעול עם
--  נתונים תקינים נשאר ready (צפייה) עם canSubmit=false.
--  ★ מדד תצוגה בלבד — השרת ממשיך לאמת הגשה בעצמו (submit_lineup).
-- =====================================================================
SET search_path = game, core, public;

CREATE TABLE IF NOT EXISTS game.readiness_config (
  id                  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  fresh_live_minutes  INT NOT NULL DEFAULT 60,
  fresh_idle_hours    INT NOT NULL DEFAULT 36
);
INSERT INTO game.readiness_config (id) VALUES (TRUE) ON CONFLICT DO NOTHING;
ALTER TABLE game.readiness_config ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION game.format_readiness(p_gw UUID, p_mode TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  g RECORD; cfg game.readiness_config%ROWTYPE;
  reasons TEXT[] := '{}'; warns TEXT[] := '{}';
  v_size INT; v_cap INT; v_squad INT; v_gk INT; v_field INT; v_teams INT; v_priced INT;
  v_fx INT; v_last TIMESTAMPTZ; v_blocks INT; v_state TEXT; v_can BOOLEAN; v_fresh INTERVAL;
BEGIN
  SELECT * INTO cfg FROM game.readiness_config WHERE id;
  SELECT gw.id, gw.code, gw.status, gw.lock_at, gw.season_id, COALESCE(gw.max_players_per_team, 1) cap
    INTO g FROM game.gameweeks gw WHERE gw.id = p_gw;
  IF g.id IS NULL THEN
    RETURN jsonb_build_object('mode', p_mode, 'state', 'blocked', 'canSubmit', false,
             'reasons', jsonb_build_array('no_current_round'), 'checkedAt', now(), 'dataUpdatedAt', NULL);
  END IF;
  v_cap := g.cap;
  v_size := COALESCE((SELECT lineup_size FROM game.mode_config WHERE mode = p_mode), CASE p_mode WHEN 'five' THEN 5 ELSE 11 END);

  SELECT count(*), count(*) FILTER (WHERE position = 'GK'), count(*) FILTER (WHERE position <> 'GK'),
         count(DISTINCT team_id), count(*) FILTER (WHERE COALESCE(fantasy_price, 0) > 0)
    INTO v_squad, v_gk, v_field, v_teams, v_priced
    FROM core.squads
   WHERE season_id = g.season_id AND valid_to IS NULL AND COALESCE(status, 'active') NOT IN ('left', 'loaned_out');

  SELECT count(*) INTO v_fx FROM core.weekly_matches WHERE gameweek_id = g.id;
  SELECT max(finished_at) INTO v_last FROM game.ingest_runs WHERE status IN ('ok', 'partial');
  SELECT count(*) INTO v_blocks FROM game.ingest_alerts
   WHERE gw_code = g.code AND cleared_at IS NULL AND severity = 'block';

  IF v_fx = 0 THEN reasons := array_append(reasons, 'no_fixtures'); END IF;
  IF v_gk < 1 OR v_field < v_size - 1 THEN reasons := array_append(reasons, 'squad_too_small'); END IF;
  IF v_teams * v_cap < v_size THEN reasons := array_append(reasons, 'not_enough_clubs'); END IF;
  IF p_mode = 'five' AND (v_squad = 0 OR v_priced < v_squad) THEN reasons := array_append(reasons, 'missing_prices'); END IF;

  v_fresh := CASE WHEN g.status IN ('open', 'locked', 'live', 'scoring')
                  THEN make_interval(mins => cfg.fresh_live_minutes)
                  ELSE make_interval(hours => cfg.fresh_idle_hours) END;
  IF v_last IS NULL OR now() - v_last > v_fresh THEN warns := array_append(warns, 'stale_data'); END IF;
  IF v_blocks > 0 THEN warns := array_append(warns, 'blocking_alerts'); END IF;

  v_state := CASE WHEN array_length(reasons, 1) > 0 THEN 'blocked'
                  WHEN array_length(warns, 1) > 0 THEN 'degraded' ELSE 'ready' END;
  v_can := v_state <> 'blocked' AND g.status = 'open' AND g.lock_at > now();

  RETURN jsonb_build_object('mode', p_mode, 'state', v_state, 'canSubmit', v_can,
           'reasons', to_jsonb(array_cat(reasons, warns)), 'checkedAt', now(), 'dataUpdatedAt', v_last);
END;
$$;
REVOKE ALL ON FUNCTION game.format_readiness(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION game.leagues_public()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'primary') DESC, x->>'code'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'code',     l.code,
      'country',  l.country_code,
      'locale',   l.default_locale,
      'dir',      l.text_direction,
      'timezone', l.timezone,
      'names',    l.names,
      'primary',  (l.id = (SELECT id FROM core.leagues ORDER BY created_at, code LIMIT 1)),
      'currentGameweek', cur.code,
      'live',     (cur.code IS NOT NULL),
      'round',    cur.number,
      'status',   cur.status,
      'lockAt',   to_char(cur.lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'entrants', CASE WHEN cur.id IS NULL THEN 0 ELSE
                    (SELECT count(*) FROM game.user_lineups ul
                      WHERE ul.gameweek_id = cur.id AND ul.status <> 'draft') END,
      'formats',  CASE WHEN cur.id IS NULL THEN NULL ELSE jsonb_build_object(
                    'five', game.format_readiness(cur.id, 'five'),
                    'full', game.format_readiness(cur.id, 'full')) END
    ) AS x
    FROM core.leagues l
    LEFT JOIN LATERAL (SELECT gw.id, gw.code, gw.number, gw.status, gw.lock_at
                         FROM game.gameweeks gw
                        WHERE gw.league_id = l.id AND gw.is_current
                        LIMIT 1) cur ON TRUE
   WHERE l.is_active
     AND (cur.id IS NOT NULL
          OR EXISTS (SELECT 1 FROM game.ingest_sources s
                      WHERE s.league_id = l.id AND s.enabled))
  ) q;
$$;
GRANT EXECUTE ON FUNCTION game.leagues_public() TO anon, authenticated;
