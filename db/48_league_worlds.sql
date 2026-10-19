-- =====================================================================
--  db/48_league_worlds.sql · כל ליגה = עולם משלה
--
--  1. זירות פרטיות שייכות לליגה (world_id). קיימות → הליגה הראשית.
--     create_league / join_league מקבלות p_world (קוד ליגה; NULL = הראשית).
--     join לזירה של עולם אחר נדחה: WRONG_LEAGUE. my_leagues / league_by_code
--     מחזירות world + worldPrimary כדי שהקליינט יציג רק זירות של העולם הנוכחי.
--  2. מחירים זמניים לשחקנים בלי דירוג (rated=false) בליגות הלא-ראשיות:
--     חציון מחירי המדורגים באותה קבוצה ובאותו תפקיד פחות 1 (בין 1 ל-3).
--     דטרמיניסטי, לא נוגע במחיר נעול ולא בליגה הראשית.
--  אידמפוטנטי. additive.
-- =====================================================================
SET search_path = core, game, public;

ALTER TABLE game.leagues ADD COLUMN IF NOT EXISTS world_id UUID REFERENCES core.leagues(id);
UPDATE game.leagues SET world_id = (SELECT id FROM core.leagues ORDER BY created_at, code LIMIT 1)
 WHERE world_id IS NULL;
ALTER TABLE game.leagues ALTER COLUMN world_id SET DEFAULT NULL;
CREATE INDEX IF NOT EXISTS leagues_world_idx ON game.leagues (world_id);

CREATE OR REPLACE FUNCTION game.world_id_of(p_world TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, game, public AS $$
DECLARE v UUID;
BEGIN
  IF p_world IS NULL OR btrim(p_world) = '' THEN
    SELECT id INTO v FROM core.leagues ORDER BY created_at, code LIMIT 1;
  ELSE
    SELECT id INTO v FROM core.leagues WHERE code = p_world;
    IF v IS NULL THEN RAISE EXCEPTION 'UNKNOWN_LEAGUE'; END IF;
  END IF;
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION game.world_id_of(TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS game.create_league(TEXT, TEXT, INT);
CREATE OR REPLACE FUNCTION game.create_league(
  p_name TEXT, p_mode TEXT, p_max_members INT DEFAULT NULL, p_world TEXT DEFAULT NULL
) RETURNS game.leagues
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE
  v_user UUID := auth.uid(); v_league game.leagues; v_code TEXT; v_try INT := 0;
  v_world UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode NOT IN ('five','full') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  v_world := game.world_id_of(p_world);
  LOOP
    v_try := v_try + 1;
    IF v_try > 10 THEN RAISE EXCEPTION 'CODE_GENERATION_FAILED'; END IF;
    SELECT string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (floor(random() * 31) + 1)::INT, 1), '')
      INTO v_code FROM generate_series(1, 6);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM game.leagues WHERE code = v_code);
  END LOOP;
  INSERT INTO game.leagues (name, code, owner_id, mode, max_members, world_id)
  VALUES (btrim(p_name), v_code, v_user, p_mode, p_max_members, v_world)
  RETURNING * INTO v_league;
  INSERT INTO game.league_members (league_id, user_id) VALUES (v_league.id, v_user);
  RETURN v_league;
END $$;
GRANT EXECUTE ON FUNCTION game.create_league(TEXT, TEXT, INT, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS game.join_league(TEXT);
CREATE OR REPLACE FUNCTION game.join_league(p_code TEXT, p_world TEXT DEFAULT NULL)
RETURNS game.leagues
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, game, public
AS $$
DECLARE v_user UUID := auth.uid(); v_league game.leagues; v_count INT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  p_code := regexp_replace(upper(btrim(p_code)), '[^2-9A-HJKMNP-Z]', '', 'g');
  IF length(p_code) <> 6 THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;
  SELECT * INTO v_league FROM game.leagues WHERE code = p_code FOR UPDATE;
  IF v_league.id IS NULL THEN RAISE EXCEPTION 'LEAGUE_NOT_FOUND'; END IF;
  IF v_league.status <> 'active' THEN RAISE EXCEPTION 'LEAGUE_CLOSED'; END IF;
  IF v_league.world_id IS DISTINCT FROM game.world_id_of(p_world) THEN RAISE EXCEPTION 'WRONG_LEAGUE'; END IF;
  IF EXISTS (SELECT 1 FROM game.league_members WHERE league_id = v_league.id AND user_id = v_user) THEN
    RAISE EXCEPTION 'ALREADY_MEMBER';
  END IF;
  IF v_league.max_members IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM game.league_members WHERE league_id = v_league.id;
    IF v_count >= v_league.max_members THEN RAISE EXCEPTION 'LEAGUE_FULL'; END IF;
  END IF;
  INSERT INTO game.league_members (league_id, user_id) VALUES (v_league.id, v_user);
  RETURN v_league;
END $$;
GRANT EXECUTE ON FUNCTION game.join_league(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION game.my_leagues()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
DECLARE v_user UUID := auth.uid(); v_primary UUID;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('leagues', '[]'::jsonb, 'members', '[]'::jsonb);
  END IF;
  SELECT id INTO v_primary FROM core.leagues ORDER BY created_at, code LIMIT 1;
  RETURN jsonb_build_object(
    'leagues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'name', l.name, 'code', l.code, 'kind', l.kind, 'mode', l.mode,
        'status', l.status, 'ownerId', l.owner_id, 'maxMembers', l.max_members,
        'world', cl.code, 'worldPrimary', (l.world_id = v_primary),
        'createdAt', to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) ORDER BY l.created_at)
      FROM game.leagues l LEFT JOIN core.leagues cl ON cl.id = l.world_id
      WHERE EXISTS (SELECT 1 FROM game.league_members m WHERE m.league_id = l.id AND m.user_id = v_user)
    ), '[]'::jsonb),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'leagueId', m.league_id, 'userId', m.user_id,
        'displayName', COALESCE(u.display_name, 'אלמוני'),
        'joinedAt', to_char(m.joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) ORDER BY m.joined_at)
      FROM game.league_members m LEFT JOIN game.users u ON u.id = m.user_id
      WHERE m.league_id IN (SELECT league_id FROM game.league_members WHERE user_id = v_user)
    ), '[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION game.my_leagues() TO authenticated;

CREATE OR REPLACE FUNCTION game.league_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, core, public AS $$
DECLARE v JSONB; v_primary UUID;
BEGIN
  IF NOT game.rate_ok('league_code', 30, INTERVAL '1 minute') THEN RETURN NULL; END IF;
  SELECT id INTO v_primary FROM core.leagues ORDER BY created_at, code LIMIT 1;
  SELECT jsonb_build_object(
    'name', l.name, 'mode', l.mode, 'kind', l.kind, 'status', l.status,
    'members', (SELECT count(*) FROM game.league_members WHERE league_id = l.id),
    'maxMembers', l.max_members,
    'world', cl.code, 'worldPrimary', (l.world_id = v_primary)
  ) INTO v
  FROM game.leagues l LEFT JOIN core.leagues cl ON cl.id = l.world_id
  WHERE l.code = upper(btrim(p_code));
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION game.league_by_code(TEXT) TO anon, authenticated;

/* ───── מחירים זמניים לשחקנים בלי דירוג, בליגות הלא-ראשיות ───── */
UPDATE core.squads s
   SET fantasy_price = x.np
  FROM (
    SELECT u.id,
           GREATEST(1, LEAST(3, COALESCE((
             SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY r.fantasy_price)::INT
               FROM core.squads r
              WHERE r.season_id = u.season_id AND r.team_id = u.team_id
                AND r.position = u.position AND r.rated AND r.valid_to IS NULL
           ), 2) - 1)) AS np
      FROM core.squads u
      JOIN core.seasons se ON se.id = u.season_id
     WHERE NOT u.rated AND NOT u.price_locked AND u.valid_to IS NULL AND u.fantasy_price = 1
       AND se.league_id <> (SELECT id FROM core.leagues ORDER BY created_at, code LIMIT 1)
  ) x
 WHERE s.id = x.id AND x.np <> s.fantasy_price;

/* ───── רשימת המחזורים באדמין: מציינת לאיזו ליגה כל מחזור שייך ───── */
CREATE OR REPLACE FUNCTION game.gameweeks_list()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = game, core, public
AS $$
  SELECT COALESCE(jsonb_agg(g ORDER BY (g->>'number')::INT DESC, g->>'code'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'code',      gw.code,
      'number',    gw.number,
      'label',     CASE WHEN lg.id = (SELECT id FROM core.leagues ORDER BY created_at, code LIMIT 1) THEN '' ELSE '[' || lg.code || '] ' END
                   || COALESCE(gw.names #>> '{he,full}', 'מחזור ' || gw.number),
      'league',    lg.code,
      'status',    gw.status,
      'isCurrent', gw.is_current,
      'lockAt',    to_char(gw.lock_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'fixtures',  (SELECT count(*) FROM core.weekly_matches m WHERE m.gameweek_id = gw.id),
      'entries',   (SELECT count(*) FROM game.user_lineups ul
                     WHERE ul.gameweek_id = gw.id AND ul.status <> 'draft'),
      'published', (gw.status = 'published'),
      -- ★ חדש
      'locked',        (now() >= gw.lock_at),
      'fixturesFinal', (SELECT count(*) FROM core.weekly_matches m
                         WHERE m.gameweek_id = gw.id AND m.status = 'finished'),
      'fixturesLive',  (SELECT count(*) FROM core.weekly_matches m
                         WHERE m.gameweek_id = gw.id AND m.status = 'live'),
      'lastEventAt',   to_char(game.gameweek_last_event(gw.id) AT TIME ZONE 'UTC',
                                'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ) AS g
    FROM game.gameweeks gw
    LEFT JOIN core.leagues lg ON lg.id = gw.league_id
    WHERE gw.code IS NOT NULL
  ) q;
$$;
GRANT EXECUTE ON FUNCTION game.gameweeks_list() TO anon, authenticated;
