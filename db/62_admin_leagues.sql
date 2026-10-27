-- =====================================================================
--  db/62_admin_leagues.sql — לוח הניהול מכיר ארבע ליגות
-- =====================================================================
--  ★ תקלות שנמצאו בבדיקת הלוח מול ריבוי הליגות:
--    1. `admin_set_current_gameweek` כיבה את "המחזור הנוכחי" בכל הליגות —
--       הגדרת מחזור נוכחי ביוון הייתה מכבה את ישראל, אנגליה וספרד.
--    2. `admin_create_gameweek` יצר תמיד `gw-N` בעונה הראשונה שנמצאה —
--       אי אפשר היה ליצור מחזור לליגה אחרת, וקוד היה עלול להתנגש.
--  ★ חדש: `admin_leagues_overview()` — מצב כל הליגות בשורה אחת לכל ליגה:
--    מחזור, נעילה, משחקים, הגשות (אנשים / בית), התראות, טבלה, קליטה אחרונה.
-- =====================================================================
BEGIN;
SET search_path = game, core, public;

-- ---------------------------------------------------------------------
-- §1 · מחזור נוכחי — רק בליגה של המחזור
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.admin_set_current_gameweek(p_gw_code TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_id UUID; v_league UUID; v_fixtures INT;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;

  SELECT g.id, COALESCE(g.league_id, s.league_id) INTO v_id, v_league
    FROM game.gameweeks g JOIN core.seasons s ON s.id = g.season_id
   WHERE g.code = p_gw_code;
  IF v_id IS NULL THEN RAISE EXCEPTION 'GAMEWEEK_NOT_FOUND: %', p_gw_code; END IF;

  SELECT count(*) INTO v_fixtures FROM core.weekly_matches WHERE gameweek_id = v_id;
  IF v_fixtures = 0 THEN RAISE EXCEPTION 'NO_FIXTURES'; END IF;

  -- ★ רק באותה ליגה. האינדקס `gameweeks_one_current_per_league` הוא לפי ליגה.
  UPDATE game.gameweeks g SET is_current = FALSE
    FROM core.seasons s
   WHERE s.id = g.season_id AND g.is_current
     AND COALESCE(g.league_id, s.league_id) = v_league;
  UPDATE game.gameweeks SET is_current = TRUE WHERE id = v_id;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (COALESCE(auth.uid()::TEXT, 'admin'), 'admin_set_current_gameweek', 'gameweek', p_gw_code,
          jsonb_build_object('code', p_gw_code));
END;
$$;

-- ---------------------------------------------------------------------
-- §2 · יצירת מחזור — לליגה מפורשת, עם הקידומת שלה
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS game.admin_create_gameweek(SMALLINT, TIMESTAMPTZ, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION game.admin_create_gameweek(
  p_number       SMALLINT,
  p_lock_at      TIMESTAMPTZ DEFAULT NULL,
  p_label        TEXT DEFAULT NULL,
  p_make_current BOOLEAN DEFAULT FALSE,
  p_league       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE
  v_league UUID; v_primary UUID; v_season UUID; v_prefix TEXT; v_code TEXT; v_id UUID; v_lock TIMESTAMPTZ;
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_number IS NULL OR p_number < 1 OR p_number > 60 THEN RAISE EXCEPTION 'BAD_NUMBER: %', p_number; END IF;

  SELECT id INTO v_primary FROM core.leagues ORDER BY created_at, code LIMIT 1;
  IF p_league IS NULL THEN
    v_league := v_primary;
  ELSE
    SELECT id INTO v_league FROM core.leagues WHERE code = p_league;
    IF v_league IS NULL THEN RAISE EXCEPTION 'LEAGUE_NOT_FOUND: %', p_league; END IF;
  END IF;

  SELECT s.id INTO v_season FROM core.seasons s
   WHERE s.league_id = v_league ORDER BY s.is_current DESC, s.starts_on DESC NULLS LAST LIMIT 1;
  IF v_season IS NULL THEN RAISE EXCEPTION 'NO_SEASON'; END IF;

  v_prefix := COALESCE((SELECT gw_prefix FROM game.ingest_sources WHERE league_id = v_league),
                       CASE WHEN v_league = v_primary THEN 'gw-' END);
  IF v_prefix IS NULL THEN RAISE EXCEPTION 'NO_PREFIX_FOR_LEAGUE'; END IF;
  v_code := v_prefix || p_number::TEXT;

  IF EXISTS (SELECT 1 FROM game.gameweeks WHERE code = v_code AND season_id <> v_season) THEN
    RAISE EXCEPTION 'CODE_TAKEN: %', v_code;
  END IF;

  v_lock := COALESCE(p_lock_at, now() + INTERVAL '365 days');

  INSERT INTO game.gameweeks (season_id, league_id, number, code, names, lock_at, first_kickoff_at, status)
  VALUES (v_season, v_league, p_number, v_code,
          jsonb_build_object(
            'he', jsonb_build_object('full', COALESCE(NULLIF(btrim(p_label), ''), 'מחזור ' || p_number)),
            'en', jsonb_build_object('full', 'Round ' || p_number)),
          v_lock, v_lock, 'draft')
  ON CONFLICT (season_id, number) DO UPDATE
    SET code = EXCLUDED.code, names = EXCLUDED.names
  RETURNING id INTO v_id;

  IF p_make_current THEN PERFORM game.admin_set_current_gameweek(v_code); END IF;

  INSERT INTO game.audit_logs (actor, action, entity, entity_id, new_value)
  VALUES (COALESCE(auth.uid()::TEXT, 'admin'), 'admin_create_gameweek', 'gameweek', v_code,
          jsonb_build_object('number', p_number, 'lockAt', v_lock, 'league', p_league));

  RETURN jsonb_build_object('code', v_code, 'number', p_number, 'lockAt', v_lock);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_create_gameweek(SMALLINT, TIMESTAMPTZ, TEXT, BOOLEAN, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- §3 · מבט על כל הליגות
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION game.admin_leagues_overview()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
BEGIN
  IF NOT game.is_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY ord, code)
    FROM (
      SELECT l.code,
             l.created_at AS ord,
             jsonb_build_object(
               'league',   l.code,
               'name',     COALESCE(l.names #>> '{en,full}', l.code),
               'ingest',   COALESCE((SELECT enabled FROM game.ingest_sources i WHERE i.league_id = l.id), FALSE),
               'round', (
                 SELECT jsonb_build_object(
                   'code', g.code, 'number', g.number, 'status', g.status, 'lockAt', g.lock_at,
                   'fixtures', (SELECT count(*) FROM core.weekly_matches m WHERE m.gameweek_id = g.id),
                   'fixturesFinal', (SELECT count(*) FROM core.weekly_matches m WHERE m.gameweek_id = g.id AND m.status = 'finished'),
                   'entries', (SELECT jsonb_build_object(
                       'fiveHuman', count(*) FILTER (WHERE ul.mode = 'five' AND NOT u.is_bot),
                       'fiveHouse', count(*) FILTER (WHERE ul.mode = 'five' AND u.is_bot),
                       'fullHuman', count(*) FILTER (WHERE ul.mode = 'full' AND NOT u.is_bot),
                       'fullHouse', count(*) FILTER (WHERE ul.mode = 'full' AND u.is_bot))
                     FROM game.user_lineups ul JOIN game.users u ON u.id = ul.user_id
                    WHERE ul.gameweek_id = g.id AND ul.status <> 'draft'),
                   'housePlanned', (SELECT count(*) FROM game.house_schedule hs WHERE hs.gameweek_id = g.id),
                   'alertsBlock', (SELECT count(*) FROM game.ingest_alerts a WHERE a.gw_code = g.code AND a.cleared_at IS NULL AND a.severity = 'block'),
                   'alertsWarn',  (SELECT count(*) FROM game.ingest_alerts a WHERE a.gw_code = g.code AND a.cleared_at IS NULL AND a.severity <> 'block'))
                   FROM game.gameweeks g JOIN core.seasons s ON s.id = g.season_id
                  WHERE COALESCE(g.league_id, s.league_id) = l.id
                  ORDER BY g.is_current DESC,
                           (g.status IN ('open','locked','live','scoring')) DESC,
                           g.number DESC
                  LIMIT 1),
               'standings', (SELECT jsonb_build_object('rows', count(*), 'updatedAt', max(updated_at))
                               FROM core.league_standings st WHERE st.league_id = l.id),
               'lastRun', (SELECT jsonb_build_object('at', r.finished_at, 'status', r.status, 'gw', r.gw_code)
                             FROM game.ingest_runs r
                            WHERE r.gw_code LIKE COALESCE((SELECT gw_prefix FROM game.ingest_sources i WHERE i.league_id = l.id), 'gw-') || '%'
                            ORDER BY r.started_at DESC LIMIT 1)
             ) AS row
        FROM core.leagues l
    ) q), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION game.admin_leagues_overview() TO authenticated;

INSERT INTO game.schema_migrations (version, note) VALUES
  ('62', 'לוח ניהול לארבע ליגות: מחזור נוכחי לפי ליגה, יצירת מחזור לליגה, מבט-על')
ON CONFLICT (version) DO NOTHING;

COMMIT;
